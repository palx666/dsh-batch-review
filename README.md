# dsh-batch-review

[![ci](https://github.com/palx666/dsh-batch-review/actions/workflows/ci.yml/badge.svg)](https://github.com/palx666/dsh-batch-review/actions/workflows/ci.yml)

[English](README.en.md) | [中文](README.md)

## 简介

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 用的多条批阅工具：一次交互收齐反馈。Agent 在向用户询问、确认或申请批复多个问题时，直接呼出面板；用户逐条点完、一次提交，结论以结构化数据回到 Agent，不打断工作流。

## 硬规则：凡需用户表态，一律调用 `batch_review`

**这条规则随插件自动注入，不需要额外配置**：插件在 system prompt 注册 `dsh-batch-review:routing` 段（每次请求生效），并内置 `batch-review-table` 技能覆盖同一套判据。

- **凡需要用户给出反馈**——确认、选择、批准、驳回、评分、评论——就给可点界面，不要用文字问［要不要 / 行不行］。
- **2 条以上需要独立结论** → `batch_review`；**单条问题或计划批准** → `ask_user_question`。
- **未表态 ≠ 通过**：`filled: false` 必须追问，不能当成已通过。

**不想自动注入？** 设置 → 左侧导航［批阅面板］→ 高级设置，取消［注入路由规则到 system prompt］（等价于配置 `injectRoutingRule: false`），**重启 DSH 后生效**。关闭后插件不再往 system prompt 写任何东西；此时**推荐自己维护规则**：在你的 `AGENTS.md` 里写清楚**什么时候该调用 `batch_review`**（哪些场景用批量、哪些用单条 `ask_user_question`），否则 Agent 不会主动想到它（工具还在，但只能靠你点名）。

## 实现形式

Agent 调一次 `batch_review`，把清单交给 Web UI——单条用原生提问卡片，达到面板阈值（默认 2 条）及以上走输入框上方的一屏面板；用户逐条表态后，工具返回一份结构化结果：每条一个结论 + 备注，外加一段可直接贴进回复的 `report_text`。面板由 DSH 自带的 web server 经 `/api/batch-review/*` 提供，**无需另开应用、不占额外端口**，而且［没表态］永远不会被当成［通过］。

```text
Agent → batch_review({ title, items: [6 条] })
      → 一屏面板（达到阈值且面板在线）或原生卡片
      → { items:[{verdict,note,filled}], summary, report_text }
```

## 它做什么

- **`batch_review` 工具**：Agent 一次传入全部条目；每条映射为一道题（原生卡片或面板条目）；返回 `items[].{id,title,type,verdict,note,filled}` + `summary` + `report_text`。
- **未填 = 未通过（fail-closed）**：跳过或留空的条目返回 `filled: false`，报告里单列［未填：…（没填不代表通过，需要单独追问）］。会话中断则返回 `cancelled: true`、`items: []`——不会静默通过。
- **五种条目类型**：`confirm`（通过 / 不通过 / 待定）、`bool`、`choice`、`text`、`scale`。
- **按需多选**：条目设 `multiSelect: true` 即可多选；结果里 `verdict` 用顿号拼接所有选项，同时新增 `selected[]` 数组保留完整选择。
- **内置技能**：包内同时注册 `batch-review-table` 技能（决策通道路由：`ask_user_question` / `batch_review` / HTML 表格怎么选），装插件即装技能。
- **HTML 回退**：条目多或需要落盘时，技能自带 `review.html` + `build_review.py` + `collect_server.py`。

## 和原生卡片的关系

`batch_review` 建立在 DSH 原生提问卡片之上：条数少时直接用它，达到阈值时换成输入框上方的一屏面板，两者返回同一份结果。

**阈值可设置**：`panelThreshold`（默认 2，范围 1–100）决定［多少条起走面板］，**想全部走面板就设为 1**（单条也用面板，不再走原生卡片）。设置方法见[设置说明](#设置说明)。

| 规模 | 界面 | 你看到的 |
|---|---|---|
| 低于阈值（默认 1 条） | 原生卡片（与 `ask_user_question` 同一个组件） | 一次一题，翻页作答 |
| 达到阈值且面板在线（默认 ≥2 条） | **一屏面板**（输入框上方） | 全部条目一次列出：逐条点结论 + 独立备注框，一次提交 |
| 达到阈值但面板不在 | 退回原生卡片 | 翻页作答，不会等一个不存在的面板 |

面板只在挂载期间轮询 `GET /api/batch-review/state`；不在线（用户不在会话页、客户端未加载、DSH 没有 webServer）时，`batch_review` 自动降级为原生卡片，不会卡住。返回里的 `surface` 字段写明这次是 `panel` 还是 `cards`。

两种界面返回**同一份契约**——`items[].{verdict,note,filled}`、`summary`、`report_text`——所以技能和 Agent 都不需要关心走的是哪一种。

## 设置说明

设置 → 左侧导航［批阅面板］里有 3 项基本设置：

| 设置 | 默认 | 范围 | 作用 |
|---|---|---|---|
| Panel threshold（面板阈值） | 2 | 1–100 | 达到多少条时从原生卡片换成面板；设为 1 则全部走面板 |
| Item cap（条目上限） | 100 | 1–500 | 一次批阅最多几条；超过直接驳回并提示拆批，不渲染 |
| Timeout (ms)（超时） | 15 分钟 | 1 秒–24 小时 | 等用户回答的最长时间；超时按取消返回 |

［高级设置］里另有：`virtualThreshold`（虚拟滚动阈值）、`maxBodyBytes`（请求体上限）、`allowExternalPersist`（允许持久化到工作目录外）、`injectRoutingRule`（是否把路由规则注入 system prompt）。这些**一般不需要改**，调整前请确认影响。

## 安装

**要求**：DeepSeek Harness `>=0.2.1-rc.3 <=0.2.1-rc.5`（当前只在 rc.3–rc.5 上验证过）、Node.js `>=20`。零运行时依赖、无构建步骤（纯 ESM）。

```sh
# 直接从仓库装
dsh plugin --profile <profile> add github:palx666/dsh-batch-review

# 或钉住某个 tag（推荐，可复现）
dsh plugin --profile <profile> add https://github.com/palx666/dsh-batch-review/archive/refs/tags/v1.0.0.tar.gz
```

重启 DSH（`dsh web` 或桌面端）让插件加载。验证：Agent 的工具列表里应出现 `batch_review`。

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

`persist` 用相对路径时，实际会落在**宿主进程的 cwd** 下（不是你的工作区）；要写到别处，需在设置里打开 `allowExternalPersist`。

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

三个通道各管一段：**面板 → HTML 批阅页 → Excel 表**，条数越多越往后。

- 面板按 `group`（缺省用 `header`）把**连续**条目分组，每个组头带［全通过 / 全待定］批量按钮。100 条只要 Agent 先分类，是可操作的；平铺的 100 条不是。
- **50 条及以上**时面板顶部提示改用 Excel 表。`build_review.py --format xlsx` 生成的表自带［状态］列下拉（通过 / 不通过 / 待定 / 跳过），适合几十到上千条——逐条点选在 HTML 页里要点上千次，Excel 里可以下拉 + 拖动批量填。
- xlsx 需要 `openpyxl`；没装时脚本会提示并**自动降级为 csv**（同样能填，只是没有下拉）。
- `group` 是可选自由文本，分几类由 Agent 决定。

## 包内有什么

| 路径 | 作用 |
|---|---|
| `index.js` | 宿主插件：注册工具、技能 provider、面板路由 |
| `lib/tool.js` | 条目校验、`AskUserQuestionItem` 映射、答案折叠、报告、面板/卡片路由 |
| `lib/panel.js` | 面板通道：单条等待中的批阅、`/api/batch-review` 路由、在线判定 |
| `lib/client.js` | 浏览器半区：`conversation.input.dock` 里的一屏批阅面板 |
| `lib/prompt.js` | systemPrompt 路由段（batch_review vs ask_user_question） |
| `lib/skill.js` | 内置 `batch-review-table` 技能的 provider |
| `lib/config.js` | 三层配置解析与校验（默认值 / cordis / 设置文件） |
| `lib/i18n.js` | 中英词典、占位符替换、错误本地化 |
| `skills/batch-review-table/SKILL.md` | 决策通道路由规则 + HTML 回退流程 |
| `skills/batch-review-table/SKILL.en.md` | 英文版技能（与 `SKILL.md` 同一套判据） |
| `skills/batch-review-table/references/html-fallback.md` | HTML 回退细节（协议、结果契约、xlsx/csv 导出）——按需读 |
| `skills/batch-review-table/assets/review.html` | 单文件批阅页（进度条、翻页、只看未完成、复制/下载 JSON） |
| `skills/batch-review-table/scripts/build_review.py` | 从 items JSON 渲染批阅页（或 xlsx/csv 表） |
| `skills/batch-review-table/scripts/collect_server.py` | 本机 127.0.0.1 回传服务：页面 → `POST /submit` → 结果文件 + stdout |
| `locale/zh.json`、`locale/en.json` | 给宿主 locale 服务的词典（客户端切语言用） |
| `cordis.patch.yml` | 插件声明（bundle patch，安装时读取） |

## 语言

支持中文和英文，默认跟随 GUI 语言，切换立即生效、无需刷新。技能同时提供 `SKILL.md`（中文）与 `SKILL.en.md`（英文）。

## 已知限制

- **面板依赖客户端半区**：面板挂在 `conversation.input.dock`，只在挂载时轮询。宿主没有 `webServer`、客户端没加载 bundle、或用户不在会话页，都等于［面板不在线］，工具会降级到原生卡片而不是一直等。
- **面板只接受回环 Host**：接口拒绝 `localhost` / `127.0.0.1` / `::1`（或 socket 自身绑定地址）以外的 `Host`，所以经反代、隧道访问 GUI 时面板不会出现，工具退回原生卡片、结论不丢；浏览器控制台会提示一次。
- **原生卡片上说明文字并入标题**：`expect` / `boolDesc` / `detail` 会用破折号接在标题后（如［重启 — 不白屏］），不再作为宿主卡片的 `detail` 行下发——那一行的左边距只有 2px（标题所在的 header 是 24px）且继承主色，看起来像顶到标题左侧外的一条线。面板仍把说明作为独立的、缩进且灰色的说明行显示。
- **原生卡片只认 root Agent**：`userQuestions.ask()` 只接受 live runtime root，子代理走到卡片路径会拿到 `DELEGATED_CALLER`。面板路径不经过这个宿主调用，所以面板在线时子代理仍能通过面板提问。
- **持久化需显式开启**：批阅结果默认不落盘；传 `persist: "<路径>"` 才会把结论写成 UTF-8 JSON（返回的 `persisted` 是实际写入的绝对路径）。`persist` 默认只能写宿主进程 cwd 子树，写到别处需在配置里设 `allowExternalPersist: true`。不传的话，会话中途结束就是 `cancelled: true`，需要重新问一遍。设置页会单独写自己的配置文件（见下一条）。
- **条数上限（默认 100）**：超过即**驳回**并提示调用方拆成多批，不渲染。要调上限见[设置说明](#设置说明)。
- **大批次跳过屏外绘制**：超过 `virtualThreshold` 条时面板给行加 `content-visibility: auto`，浏览器跳过视口外的布局与绘制，但每行保留真实高度——没有固定行高，不会裁切内容。默认值（`maxItems: 100`、`virtualThreshold: 500`）下这条路径不触发；要验证就在［设置 → 高级设置］里调低 `virtualThreshold`。
- **中文只是兜底**：既无面板上报、也无显式 `lang` 时，选项标签（`confirm`：［通过 / 不通过 / 待定］，`bool`：［是 / 否］）与 `report_text` 回退中文；其余情况跟随界面语言或 `lang` 参数。
- **样式只用 DSH 主题变量**：原生卡片的外观完全由 DSH 提供；面板的 CSS 全部使用 `--dsw-*` 主题变量（无硬编码颜色），跟随 DSH 亮色/暗色切换。已在 DSH `0.2.1-rc.5` 下实测 orca-maid 0.1.1、maid-atelier 0.1.9、orca-link 0.1.9、deep-whale-manager 0.1.8、maid-whale-webui 0.1.1（DeepSeek Cloud Paper）可读。

## 开发

```sh
node --test     # 映射、折叠、报告、插件注册
```

HTML 回退有自己的冒烟路径：

```sh
python skills/batch-review-table/scripts/build_review.py --data examples/items.json --out review/demo.html
python skills/batch-review-table/scripts/build_review.py --data examples/items.json --format xlsx --out review/demo.xlsx
python skills/batch-review-table/scripts/collect_server.py   # 然后用浏览器打开 review/demo.html
```

## 许可

MIT，见 [LICENSE](LICENSE)。

## 制作

使用 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）制作：工具、面板与技能均基于其 API 编写。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
