# dsh-batch-review

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 用的「逐条批阅」工具：复用宿主**原生提问卡片**，一次调用收齐一批结论。

agent 调一次 `batch_review`，把清单交给 Web UI——单条用原生提问卡片，2 条及以上走输入框上方的一屏面板；用户逐条表态后，工具返回一份结构化结果：每条一个结论 + 备注，外加一段可直接贴进回复的 `report_text`。面板由宿主自带的 web server 经 `/api/batch-review/*` 提供，**无需另开应用、不占额外端口**，而且「没表态」永远不会被当成「通过」。

```text
agent → batch_review({ title, items: [6 条] })
      → 一屏面板（≥2 条且面板在线）或原生卡片
      → { items:[{verdict,note,filled}], summary, report_text }
```

## 解决什么问题

agent 要对 6 条验收项逐一要结论时，现在只有两个坏选择：

- 连发 6 次 `ask_user_question`——打断 6 次，agent 还得自己把答案拼回去；
- 用文字问——用户回「1 过了，2 过了，4 挂了」，模型再从文本里反解状态。

`batch_review` 是第三种：一次调用、宿主自己的卡片、一份机器可读的结果。它专门防一种沉默的失败：**用户没答的那一条，被模型顺手当成通过**。

## 它做什么

- **`batch_review` 工具**：agent 一次传完整批条目；每条映射为宿主原生卡片上的一道题；返回 `items[].{id,title,type,verdict,note,filled}` + `summary` + `report_text`。
- **未填 = 未通过（fail-closed）**：跳过或留空的条目返回 `filled: false`，报告里单列「未填：…（没填不代表通过，需要单独追问）」。会话中断则返回 `cancelled: true`、`items: []`——不会静默通过。
- **五种条目类型**：`confirm`（通过 / 不通过 / 待定）、`bool`、`choice`、`text`、`scale`。
- **按需多选**：条目设 `multiSelect: true` 即可多选；结果里 `verdict` 用「、」拼接所有选项，同时新增 `selected[]` 数组保留完整选择。
- **内置技能**：包内同时注册 `batch-review-table` 技能（决策通道路由：`ask_user_question` / `batch_review` / HTML 表格怎么选），装插件即装技能。
- **HTML 回退**：条目多或需要落盘时，技能自带 `review.html` + `build_review.py` + `collect_server.py`。

## 两个界面，同一份结果

| 规模 | 界面 | 你看到的 |
|---|---|---|
| 1 条 | 原生卡片（与 `ask_user_question` 同一个组件） | 一次一题，翻页作答 |
| ≥2 条且面板在线 | **一屏面板**（输入框上方） | 全部条目一次列出：逐条点结论 + 独立备注框，一次提交 |
| ≥2 条但面板不在 | 退回原生卡片 | 翻页作答，不会等一个不存在的面板 |

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

要求：DeepSeek Harness `>=0.2.1-rc.3 <0.3.0-0`、Node.js `>=20`。零运行时依赖、无构建步骤（纯 ESM）。

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

## 大数量批阅

- 面板按 `group`（缺省用 `header`）把**连续**条目分组，每个组头带「全通过 / 全待定」批量按钮。100 条只要 agent 先分类，是可操作的；平铺的 100 条不是。
- 超过 50 条时面板顶部提示改用 CSV/Excel。1000 条属于技能里的 CSV 导出（`build_review.py --format csv`，用 Excel 打开可加数据验证下拉），不该硬塞进面板。
- `group` 是可选自由文本，分几类由 agent 决定。

## 路由规则随包分发

`lib/prompt.js` 注册一段很短的 systemPrompt（约 250 字符）：说明 `batch_review` 与 `ask_user_question` 何时用，以及「未填不等于通过」。它每次请求都在，所以其他用户**不需要**手动抄一份 `AGENTS.md` 规则。

如果你想自己管这条规则，照常往 `AGENTS.md` 加即可——插件这段是叠加的，不互斥。

## 包内有什么

| 路径 | 作用 |
|---|---|
| `index.js` | 宿主插件：注册工具、技能 provider、面板路由 |
| `lib/tool.js` | 条目校验、`AskUserQuestionItem` 映射、答案折叠、报告、面板/卡片路由 |
| `lib/panel.js` | 面板通道：单条等待中的批阅、`/api/batch-review` 路由、在线判定 |
| `lib/client.js` | 浏览器半区：`conversation.input.dock` 里的一屏批阅面板 |
| `lib/prompt.js` | systemPrompt 路由段（batch_review vs ask_user_question） |
| `lib/skill.js` | 内置 `batch-review-table` 技能的 provider |
| `skills/batch-review-table/SKILL.md` | 决策通道路由规则 + HTML 回退流程 |
| `skills/batch-review-table/references/html-fallback.md` | HTML 回退细节（协议、结果契约、CSV）——按需读 |
| `skills/batch-review-table/assets/review.html` | 单文件批阅页（进度条、翻页、只看未完成、复制/下载 JSON） |
| `skills/batch-review-table/scripts/build_review.py` | 从 items JSON 渲染批阅页（或 CSV） |
| `skills/batch-review-table/scripts/collect_server.py` | 本机 127.0.0.1 回传服务：页面 → `POST /submit` → 结果文件 + stdout |

## 已知限制

- **一次只显示一道题——阈值以下**：1 条走原生卡片，逐页作答；从 2 条起，面板在线时自动换成**一屏面板**，面板不在线时仍退回卡片。
- **面板依赖客户端半区**：面板挂在 `conversation.input.dock`，只在挂载时轮询。宿主没有 `webServer`、客户端没加载 bundle、或用户不在会话页，都等于「面板不在线」，工具会降级到原生卡片而不是一直等。
- **只有 root agent 能调**：`userQuestions.ask()` 只接受 live runtime root，子代理调用会拿到 `DELEGATED_CALLER`。这是宿主边界，不是插件缺陷。
- **持久化需显式开启**：默认不落盘；传 `persist: "<路径>"` 才会把结论写成 UTF-8 JSON（返回的 `persisted` 是实际写入的绝对路径）。`persist` 默认只能写宿主进程 cwd 子树，写到别处需在配置里设 `allowExternalPersist: true`。不传的话，会话中途结束就是 `cancelled: true`，需要重新问一遍。
- **条数上限（默认 100）**：超过即**驳回**并提示调用方拆成多批，不进入渲染。所有阈值都在 `cordis.patch.yml` 的 `config` 里改：`maxItems`（驳回上限）、`panelThreshold`（几条起用面板）、`virtualThreshold`（几条起用虚拟滚动）、`panelTimeoutMs`（面板等待超时）、`maxBodyBytes`（面板请求体上限）、`allowExternalPersist`（是否允许 `persist` 写到 cwd 之外）。
- **默认配置下虚拟滚动不可达**：超过 `virtualThreshold` 条时面板只渲染可视窗口（固定行高 100px / 组头 30px）。默认 `maxItems: 100`、`virtualThreshold: 500`，条目在到达虚拟滚动前就被驳回；只有把 `maxItems` 调到 `virtualThreshold` 以上，这条路径才会生效。
- **默认中文选项**：`confirm` 渲染「通过 / 不通过 / 待定」，`bool` 渲染「是 / 否」；要换语言改 `lib/tool.js` 顶部常量。
- **样式只用宿主主题变量**：原生卡片的外观完全由 DSH 提供；面板的 CSS 全部使用 `--dsw-*` 主题变量（无硬编码颜色），跟随宿主亮色/暗色切换。

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
