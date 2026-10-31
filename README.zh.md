# dsh-batch-review

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 用的「逐条批阅」工具：复用宿主**原生提问卡片**，一次调用收齐一批结论。

agent 调一次 `batch_review`，把清单交给 Web UI 变成原生卡片；用户逐条表态后，工具返回一份结构化结果：每条一个结论 + 备注，外加一段可直接贴进回复的 `report_text`。**零新增 UI、无浏览器页、无本地服务**，而且「没表态」永远不会被当成「通过」。

```text
agent → batch_review({ title, items: [6 条] })
      → 一屏面板（≥5 条且面板在线）或原生卡片
      → { items:[{verdict,note,filled}], summary, report_text }
```

## 解决什么问题

agent 要对 6 条验收项逐一要结论时，现在只有两个坏选择：

- 连发 6 次 `ask_user_question`——打断 6 次，agent 还得自己把答案拼回去；
- 用文字问——用户回「1 过了，2 过了，4 挂了」，模型再从文本里反解状态。

`batch_review` 是第三种：一次调用、宿主自己的卡片、一份机器可读的结果。它专门防一种沉默的失败：**用户没答的那一条，被模型顺手当成通过**。

## 它做什么

- **`batch_review` 工具**：agent 一次传 3 条以上；每条映射为宿主原生卡片上的一道题；返回 `items[].{id,title,type,verdict,note,filled}` + `summary` + `report_text`。
- **未填 = 未通过（fail-closed）**：跳过或留空的条目返回 `filled: false`，报告里单列「未填：…（没填不代表通过，需要单独追问）」。会话中断则返回 `cancelled: true`、`items: []`——不会静默通过。
- **五种条目类型**：`confirm`（通过 / 不通过 / 未测）、`bool`、`choice`、`text`、`scale`。
- **内置技能**：包内同时注册 `batch-review-table` 技能（决策通道路由：`ask_user_question` / `batch_review` / HTML 表格怎么选），装插件即装技能。
- **HTML 回退**：条目多或需要落盘时，技能自带 `review.html` + `build_review.py` + `collect_server.py`。

## 两个界面，同一份结果

| 规模 | 界面 | 你看到的 |
|---|---|---|
| 1–4 条 | 原生卡片（与 `ask_user_question` 同一个组件） | 一次一题，翻页作答 |
| ≥5 条且面板在线 | **一屏面板**（输入框上方） | 全部条目一次列出：逐条点结论 + 独立备注框，一次提交 |
| ≥5 条但面板不在 | 退回原生卡片 | 翻页作答，不会等一个不存在的面板 |

面板只在挂载期间轮询 `GET /api/batch-review/state`；不在线（用户不在会话页、客户端未加载、宿主没有 webServer）时，`batch_review` 自动降级为原生卡片，不会卡住。返回里的 `surface` 字段写明这次是 `panel` 还是 `cards`。

两种界面返回**同一份契约**——`items[].{verdict,note,filled}`、`summary`、`report_text`——所以技能和 agent 都不需要关心走的是哪一种。

## 安装

```sh
# 直接从仓库装
dsh plugin --profile <profile> add github:palx666/dsh-batch-review

# 或钉住某个 tag（推荐，可复现）
dsh plugin --profile <profile> add https://github.com/palx666/dsh-batch-review/archive/refs/tags/v1.0.0.tar.gz

# 发布到 npm 之后
dsh plugin --profile <profile> add dsh-batch-review
```

重启宿主（`dsh web` 或桌面端）让插件加载。验证：agent 的工具列表里应出现 `batch_review`。

要求：DeepSeek Harness `>=0.2.1-rc.3 <0.3.0-0`。零运行时依赖、无构建步骤（纯 ESM）。

## 用法

```json
{
  "title": "验收：文件复制 / 下载按钮",
  "persist": "review/acceptance.json",
  "items": [
    { "id": 1, "type": "confirm", "op": "重启 DSH、刷新页面", "expect": "界面正常，不白屏" },
    { "id": 2, "type": "choice", "label": "接入方式", "options": [{ "v": "A", "t": "直连 18080" }, { "v": "B", "t": "走 DSH subagent" }] },
    { "id": 3, "type": "bool", "label": "网关计划任务常驻", "boolDesc": "接受" },
    { "id": 4, "type": "scale", "label": "整体评分", "min": 1, "max": 5 },
    { "id": 5, "type": "text", "label": "有没有看着不对的地方" }
  ]
}
```

返回（截断）：

```json
{
  "cancelled": false,
  "items": [
    { "id": "1", "type": "confirm", "verdict": "通过", "note": "", "filled": true },
    { "id": "3", "type": "bool", "verdict": "", "note": "", "filled": false }
  ],
  "summary": { "total": 5, "filled": 4 },
  "persisted": "/abs/path/review/acceptance.json",
  "report_text": "【批阅】验收：文件复制 / 下载按钮\n共 5 条 · 已填 4 条 · 未填 1 条\n…\n未填：3（没填不代表通过，需要单独追问）"
}
```

工具对模型的硬约束：

- `items` 必须非空，`id` 必须唯一——答案按 id 回填，重复 id 会被直接拒绝，不会互相覆盖；
- `persist`（可选）把结果另存为 UTF-8 JSON，会话结束后仍可查；返回的 `persisted` 是实际绝对路径，写失败时 `persist_error` 有原因（不影响批阅结果）；
- 工具会挂起等用户作答，同一批**不要调两次**；
- `filled: false` 必须追问，不能当通过；
- `cancelled: true` 表示没有任何结论，必须重新发起。

## 包内有什么

| 路径 | 作用 |
|---|---|
| `index.js` | 宿主插件：注册工具、技能 provider、面板路由 |
| `lib/tool.js` | 条目校验、`AskUserQuestionItem` 映射、答案折叠、报告、面板/卡片路由 |
| `lib/panel.js` | 面板通道：单条等待中的批阅、`/api/batch-review` 路由、在线判定 |
| `lib/client.js` | 浏览器半区：`conversation.input.dock` 里的一屏批阅面板 |
| `lib/skill.js` | 内置 `batch-review-table` 技能的 provider |
| `skills/batch-review-table/SKILL.md` | 决策通道路由规则 + HTML 回退流程 |
| `skills/batch-review-table/assets/review.html` | 单文件批阅页（进度条、翻页、只看未完成、复制/下载 JSON） |
| `skills/batch-review-table/scripts/build_review.py` | 从 items JSON 渲染批阅页（或 CSV） |
| `skills/batch-review-table/scripts/collect_server.py` | 本机 127.0.0.1 回传服务：页面 → `POST /submit` → 结果文件 + stdout |

## 已知限制

- **一次只显示一道题——阈值以下**：1–4 条走原生卡片，逐页作答；从 5 条起，面板在线时自动换成**一屏面板**，面板不在线时仍退回卡片。
- **面板依赖客户端半区**：面板挂在 `conversation.input.dock`，只在挂载时轮询。宿主没有 `webServer`、客户端没加载 bundle、或用户不在会话页，都等于「面板不在线」，工具会降级到原生卡片而不是一直等。
- **只有 root agent 能调**：`userQuestions.ask()` 只接受 live runtime root，子代理调用会拿到 `DELEGATED_CALLER`。这是宿主边界，不是插件缺陷。
- **无持久化**：不落盘；会话中途结束就是 `cancelled: true`，需要重新问一遍。
- **默认中文选项**：`confirm` 渲染「通过 / 不通过 / 未测」，`bool` 渲染「是 / 否」；要换语言改 `lib/tool.js` 顶部常量。
- **样式归宿主**：卡片外观、键盘行为、无障碍都由 DSH 提供，本包不加任何 CSS。

## 开发

```sh
npm test        # node --test：映射、折叠、报告、插件注册
```

HTML 回退有自己的冒烟路径：

```sh
python skills/batch-review-table/scripts/build_review.py --data examples/items.json --out review/demo.html
python skills/batch-review-table/scripts/collect_server.py   # 然后用浏览器打开 review/demo.html
```

## 许可

MIT，见 [LICENSE](LICENSE)。
