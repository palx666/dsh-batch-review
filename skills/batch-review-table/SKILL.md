---
name: batch-review-table
description: Use whenever the user owes a decision — anything where they must confirm, choose, approve, reject, rate, or comment, on one item or many. Skip only when the user owes no decision (pure information, authoring, or explanation requests).
---

# 批阅表格

把「需要用户表态」变成可点界面：**能点鼠标就不打字**。

> 本技能随 `dsh-batch-review` 插件内置安装，不需要手动复制到 `~/.dsh/skills/`。

## 何时用

任何需要用户表态的请求：确认、选择、批准、驳回、评分、评论——一条或多条。

## 何时不用

用户不欠你决定时：纯信息查询、写文档、解释代码、总结内容。

## 通道分工

**前提：凡是要用户表态，都必须给可点界面，不许用文字问「要不要 / 行不行」。** 下面的分工只是为了选更轻的形态，不是「轻的场景可以打字」。

| 判据 | `ask_user_question` | `batch_review` |
|---|---|---|
| 条数 | 1–2 条 | 3 条以上 |
| 条目关系 | 选一个/几个（并列或互斥选项） | 每条要**独立结论** |
| 结论形态 | `selected[]` | 通过 / 不通过 / 未测 + 备注 |
| 多选 | ✅ 支持 | ❌ 不支持 |
| 计划批准（plan-review） | ✅ 支持 | ❌ 不支持 |
| 汇总文本 | ❌ 无 | ✅ `report_text` |
| 结果契约 | `answers[]` | `items[].filled/verdict/note` |

判定顺序（先命中先用）：

```
1. 需要多选，或需要批准计划        → ask_user_question
2. 条目 3 条以上且每条要独立结论    → batch_review
3. 条目 1–2 条的普通选择/确认      → ask_user_question
4. 条目很多（十几条以上）、要一屏总览、要留档 → HTML 批阅页（见「回退」）
5. 以上都不适合                      → 见「都不适合时」
```

两个工具在 Web UI 上是同一套原生卡片（`batch_review` 底层也走 `userQuestions.ask`），差别只在数据契约，不在外观。

**注意卡片的真实形态**：一条 `batch_review` 调用会把全部条目排进同一张卡片，但界面**一次只显示一道题**，靠「上一题 / 下一题」逐页作答。条目越多翻页越久——它是「一次问完、逐页回答」，不是「一屏总览」。十几条以上请直接走 HTML 页。

## `batch_review` 用法

一次调用传全部条目：

```json
{
  "title": "验收：link-test 复制/下载按钮",
  "items": [
    { "id": 1, "type": "confirm", "op": "重启 DSH、刷新页面", "expect": "界面正常，不白屏" },
    { "id": 2, "type": "choice", "label": "接入方式", "options": [{ "v": "A", "t": "直连 18080" }, { "v": "B", "t": "走 DSH subagent" }] },
    { "id": 3, "type": "bool", "label": "网关计划任务常驻", "boolDesc": "接受" }
  ],
  "persist": "review/acceptance.json"
}
```

- `type`: `confirm`（通过/不通过/未测）、`choice`、`bool`、`text`、`scale`；
- `id` 必须唯一：答案按 id 回填，重复的 id 会被工具直接拒绝；
- `persist`（可选）：把结果另存为 UTF-8 JSON，会话结束后仍可查；返回里 `persisted` 是实际写入的绝对路径，写失败时 `persist_error` 有原因（不影响批阅结果本身）；
- 工具会挂起等用户点，**不要重复调用**，一次传完所有条目；
- 返回 `items[].filled`：`false` = 用户没表态，**必须追问，不能当通过**；
- 返回 `cancelled: true`：会话中断/取消，**没有任何结论**，必须重新发起。

## 都不适合时

| 情况 | 做法 |
|---|---|
| 用户要写长文本（描述现象、提需求） | 直接对话，但先给一份可参照的结构（列表/模板） |
| 需要用户操作外部程序（重启、点浏览器） | 文字说明 + 用 `batch_review` 一条 confirm 收确认 |
| 需要上传文件/截图 | 走附件，不要塞进选项 |
| 需要用户看长文档后再表态 | 先给文档/路径，再用 `batch_review` 收结论 |

## 铁律

1. **先想界面，再想措辞**：凡是需要用户表态，先给可点控件，不得用文字问「要不要 / 行不行」。
2. **确认必须点击**：勾选框、按钮、选项。自由文本只用于文字反馈。
3. **未表态 ≠ 通过**：没点过的一律视为未知，必须追问。
4. **不替用户表态**：用户没回应就不要往下推进，也不要用「应该没问题」代替确认。
5. **顺序清单有依赖**：从中间开始时提醒；跳过的步骤要在回执里注明。

## 回退：HTML 批阅页

以下任一情况走 HTML 页面，不要硬塞进原生卡片：

- `batch_review` 不在工具列表里（`UNKNOWN_TOOL`）或调用失败；
- 条目很多（十几条以上）或需要**一屏总览**、进度条、只看未完成；
- 需要把结果持久化成文件（JSON/CSV）留档。

### 动手前先告诉用户（一次性说清）

1. **页面要用浏览器打开**（「在应用中打开」），不要用应用内预览；
2. **别把页面放临时目录**：宿主重启会清空它，重启后表就没了——要留档就 `--out` 到工作区；
3. **「提交给我」失败不丢数据**：页面自带「复制结果」「下载 JSON」，把 JSON 贴回聊天即可；
4. 回传服务是**一次性的**：提交后 10 秒内可改可重交，之后进程退出；提交前关掉服务就没有回传通道。

### 步骤（脚本随插件安装，位于本技能目录）

```sh
python scripts/build_review.py --data items.json --out review/<slug>.html
python scripts/collect_server.py
```

- 输出 `WARNING` 说明 `--out` 写不了、回退到了临时目录（重启即清空），按上面第 2 条处理；
- 收集器启动后打印 `listening 127.0.0.1:<port>`，页面会自动探测同一组端口；
- 提交失败就让用户用页面上的「复制结果」把 JSON 贴回来。

### 离线导出（不开浏览器）

用户更愿意在文件里改时，直接导 CSV（UTF-8 BOM，Excel 可直接打开）：

```sh
python scripts/build_review.py --data items.json --format csv --out review/<slug>.csv
```

填完把 CSV 内容发回来即可。CSV 没有进度条/阻塞联动，适合条数多但逐条独立的场景。

### 回传协议（排错用）

| 项 | 行为 |
|---|---|
| 端口 | `REVIEW_PORTS`，默认 `8777,8778,8779,8780`，按序取第一个可绑的；页面用同一组端口探测 |
| `GET /health` | `200 {"ok":true,"service":"review-collect","version":"2"}` |
| `POST /submit` | body 必须含 `items[]`；返回 `200 {"ok":true,"received":<n>,"version":"2"}` |
| `OPTIONS *` | `204` + CORS 头（含 `Access-Control-Allow-Private-Network: true`，否则 Chrome 会拦 `file://` 页面访问 127.0.0.1） |
| 收尾 | 首次提交后再等 `REVIEW_GRACE`（默认 10s），只保留最后一次；结果写 `REVIEW_OUT`（默认 `<temp>/review-l2-result.json`） |
| 超时 | `REVIEW_TIMEOUT`（默认 900s）内没有提交 → 打印 `timeout`，退出码 1 |

### 结果契约（HTML 回退提交的 JSON）

```json
{
  "title": "验收：…", "id": "slug", "mode": "sequential | independent",
  "generated_at": "ISO-8601",
  "items": [
    { "id": 1, "type": "confirm", "title": "…", "state": "pass | fail | skip | block | open",
      "answer": "用户选/填的文本", "blocked_by": 2, "assumed_pass": false, "note": "备注" }
  ],
  "summary": { "pass": 0, "fail": 0, "skip": 0, "block": 0, "open": 0, "assumed": 0 },
  "report_text": "【批阅】…可直接贴回聊天"
}
```

- `state`：`pass` 通过 / `fail` 不通过 / `skip` 未测 / `block` 被前一条阻塞 / `open` 未表态；
- `assumed_pass: true` = 用户点了「全部通过」但没实测，转述时必须说明；
- `blocked_by`：顺序模式下被哪条阻塞（1-based id）；
- 最省事的是直接读 `report_text`；需要逐条处理再读 `items`。

## 结果怎么用

| 状态 | 处理 |
|---|---|
| 通过 / 已填 | 照做 |
| 不通过 | 当缺陷修；有备注按备注 |
| 被阻塞 | 等前一条修好再验，不要追问 |
| 未测 | 问一句怎么验 |
| 未表态 | **必须追问，不能默认通过** |
| cancelled | **没有任何结论，重新发起** |

## 开工前自检

- 先看工具列表：有 `batch_review` 走批阅通道，没有就退回 `ask_user_question` 或 HTML；
- 条目十几条以上、要一屏总览或要留档 → 直接走 HTML，不要硬塞卡片；
- HTML 路径需要四个文件齐全：`SKILL.md`、`assets/review.html`、`scripts/build_review.py`、`scripts/collect_server.py`。
