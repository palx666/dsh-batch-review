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
| 条数 | 1 条 | 2 条及以上 |
| 条目关系 | 选一个/几个（并列或互斥选项） | 每条要**独立结论** |
| 结论形态 | `selected[]` | 通过 / 不通过 / 待定 + 备注 |
| 多选 | ✅ 支持 | ✅ 支持（条目设 `multiSelect: true`） |
| 计划批准（plan-review） | ✅ 支持 | ❌ 不支持 |
| 汇总文本 | ❌ 无 | ✅ `report_text` |
| 结果契约 | `answers[]` | `items[].filled/verdict/note` |

判定顺序（先命中先用）：

```
1. 需要批准计划（plan-review）      → ask_user_question
2. 条目 2 条及以上且每条要独立结论  → batch_review
3. 单条的普通选择/确认              → ask_user_question
4. 条目很多（十几条以上）、要一屏总览、要留档 → HTML 批阅页（见「回退」）
5. 以上都不适合                      → 见「都不适合时」
```

两个工具在 Web UI 上是同一套原生卡片（`batch_review` 底层也走 `userQuestions.ask`），差别只在数据契约，不在外观。

**注意卡片的真实形态**：一条 `batch_review` 调用会把全部条目排进同一张卡片，但界面**一次只显示一道题**，靠「上一题 / 下一题」逐页作答。条目越多翻页越久——它是「一次问完、逐页回答」，不是「一屏总览」。

**条目 ≥2 时会自动换成一屏面板**：`dsh-batch-review` 装好后，输入框上方会有一个批阅面板；条目 ≥2 且面板在线时，`batch_review` 自动走面板（一屏列全部条目、逐条点结论 + 备注、提交即回传），你**不需要**为此换工具或加参数。面板不在线（用户不在会话页/客户端未加载）时自动退回原生卡片。返回里的 `surface` 字段会写明这次走的是 `panel` 还是 `cards`。

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

- `type`: `confirm`（通过/不通过/待定）、`choice`、`bool`、`text`、`scale`；
- `multiSelect`（可选）：条目加 `"multiSelect": true` 时同题可选多个；结果 `verdict` 用「、」拼接、`selected[]` 保留数组，报告里同样显示多个；
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

以下任一情况走 HTML，不要硬塞进原生卡片：

- `batch_review` 不在工具列表里、调用失败或面板超时（`PANEL_TIMEOUT`）；
- 条目很多且面板不可用（客户端未加载 / 用户不在会话页）；
- 需要把结果落盘留档（JSON / CSV / Excel）。

```sh
python scripts/build_review.py --data items.json --out review/<slug>.html
python scripts/collect_server.py
```

告诉用户用浏览器打开；提交失败就用「复制结果」把 JSON 贴回。

> 详细的生命周期警告、回传协议、结果契约、CSV 导出见
> [references/html-fallback.md](references/html-fallback.md)，需要排错时再读。

## 结果怎么用

| 状态 | 处理 |
|---|---|
| 通过 / 已填 | 照做 |
| 不通过 | 当缺陷修；有备注按备注 |
| 被阻塞 | 等前一条修好再验，不要追问 |
| 待定 | 问一句怎么验 |
| 未表态 | **必须追问，不能默认通过** |
| cancelled | **没有任何结论，重新发起** |

## 开工前自检

- 先看工具列表：有 `batch_review` 走批阅通道，没有就退回 `ask_user_question` 或 HTML；
- 面板不在线 / 需要落盘留档 / 条目数超过 `maxItems` → 直接走 HTML，不要硬塞卡片；
- HTML 路径需要四个文件齐全：`SKILL.md`、`assets/review.html`、`scripts/build_review.py`、`scripts/collect_server.py`。
