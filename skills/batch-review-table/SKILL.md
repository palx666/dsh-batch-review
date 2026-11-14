---
name: batch-review-table
description: Use whenever the user owes a decision — anything where they must confirm, choose, approve, reject, rate, or comment, on one item or many. Skip only when the user owes no decision (pure information, authoring, or explanation requests).
---

# 批阅表格

把［需要用户表态］变成可点界面：**能点鼠标就不打字**。

> 本技能随 `dsh-batch-review` 插件内置安装，不需要手动复制到 `~/.dsh/skills/`。
> English version: [SKILL.en.md](SKILL.en.md).

## 何时用

任何需要用户表态的请求：确认、选择、批准、驳回、评分、评论——一条或多条。

## 何时不用

用户不欠你决定时：纯信息查询、写文档、解释代码、总结内容。

## 通道分工

**前提：凡是要用户表态，都必须给可点界面，不许用文字问［要不要 / 行不行］。** 下面的分工只是为了选更轻的形态，不是［轻的场景可以打字］。

| 判据 | `ask_user_question` | `batch_review` |
|---|---|---|
| 适用场景 | 计划批准（plan-review）与宿主审批类——只有原生接口能发出这两种 intent | 其余一切需要用户表态的场景：确认、选择、批准、驳回、评分、评论（**单条或多条**） |
| 条数 | 1 条 | 1 条及以上（默认面板阈值 1 = 单条也走面板） |
| 条目关系 | 选一个/几个（并列或互斥选项） | 每条要**独立结论** |
| 结论形态 | `selected[]` | 通过 / 不通过 / 待定 + 备注 |
| 多选 | ✅ 支持 | ✅ 支持（条目设 `multiSelect: true`） |
| 计划批准（plan-review） | ✅ 支持（唯一入口） | ❌ 不支持（items 契约没有 intent / plan 载荷） |
| 汇总文本 | ❌ 无 | ✅ `report_text` |
| 结果契约 | `answers[]` | `items[].filled/verdict/note` |

判定顺序（先命中先用）：

```
1. 计划批准（plan-review）或宿主审批类  → ask_user_question
2. 其余需要用户表态的（含普通单条询问、2+ 条独立结论）→ batch_review
3. 条目很多（十几条以上）、要一屏总览、要留档 → HTML 批阅页（见［回退］）
4. 以上都不适合                          → 见［都不适合时］
```

两个工具在 Web UI 上走同一套原生卡片组件（`batch_review` 底层也走 `userQuestions.ask`），差别只在数据契约。**默认阈值是 1**：普通请求一律 `batch_review`，走一屏面板，不再用原生卡片。

**注意卡片的真实形态**：只有面板不在线时才退到原生卡片，而卡片**一次只显示一道题**，靠［上一题 / 下一题］逐页作答；条目越多翻页越久。默认阈值下应当走一屏面板（见下）。

**默认面板阈值是 1：单条也走一屏面板**：`dsh-batch-review` 装好后，输入框上方会有一个批阅面板；`panelThreshold` 默认 1，即使只有一条条目，`batch_review` 也走面板（一屏列全部条目、逐条点结论 + 备注、提交即回传），你**不需要**为此换工具或加参数。只在两种情况下退回原生卡片：① 面板不在线（用户不在会话页 / 客户端未加载 / 宿主没有 webServer）；② 用户手动把 `panelThreshold` 调高到超过本次条目数。返回里的 `surface` 字段会写明这次走的是 `panel` 还是 `cards`。

**原生卡片是降级路径，而且没有分片/续等**：默认阈值下不要主动往原生卡片上靠。卡片路径被宿主执行预算（例如 `run_code` 默认 2 分钟）掐断时没有 `review_id` 可续，只能重新发起。要稳定长等待，就保持阈值 1 并确保面板在线；面板确实不在线时，宁可先告知用户、等面板可用再发，也不要在卡片上发大清单。

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
- `choice` 的选项按**重要度**排序：**推荐项固定放第一位**（面板按数组顺序自动编号，所以它就是 A），其余依次 B、C…；选项文字（`t`/`label`）里**不要**写字母或数字编号，**也不要写“A+B”这类组合引用**（要表达组合就写“两者都做”）；结果里的 `verdict` 是选项文字本身，别让它和面板编号打架。正文引用时按界面字母说“A（推荐）/B/C”。面板对调用方自己写的编号（`B …`、`1. …`、`2、…`）会原样沿用、不再重复编号，但那只是兼容，不是推荐写法；
- **选项可组合时必须用多选，不要造“组合选项”**：当各方案可以同时采用（例如同时改宿主配置 + 改插件），给条目设 `"multiSelect": true`，把每个可独立勾选的方案各写一条，再加一条“都不做”；用户勾 A+B 就是组合。**禁止**把组合写成单个选项（如“A+B 都做”），也不要给选项写字母编号——面板按数组顺序编号，组合文字会和编号打架。结果 `verdict` 用［、］拼接、`selected[]` 保留数组。**“都不做”这类互斥项**要标 `"exclusive": true`（标签写成“都不做”/“none”也会被自动识别）：勾它会清空其他选项，勾其他会清空它；服务端还会拒绝“互斥项 + 其他项”同时提交。
- `id` 必须唯一：答案按 id 回填，重复的 id 会被工具直接拒绝；
- `persist`（可选）：把结果另存为 UTF-8 JSON，会话结束后仍可查；返回里 `persisted` 是实际写入的绝对路径，写失败时 `persist_error` 有原因（不影响批阅结果本身）；
- 工具会挂起等用户点，**不要重复调用**，一次传完所有条目；
- 返回 `pending: true`：面板还开着，只是这次调用等到的**分片**用完了（约 90 秒）。这不是失败，也不是通过；已经输入的内容不会丢。**必须**再调用一次 `batch_review({ "review_id": "<返回值里的 review_id>" })`（不要重复传 items），直到 `pending` 为 `false`；
- 在 `run_code` 里调用时，把程序的 `timeoutMs` 设为 **≥ 900000**，或让每个程序只调一次 `batch_review`；2 分钟的默认预算会把这次等待提前结束（review 不丢，但要靠续等取回）；
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

1. **先想界面，再想措辞**：凡是需要用户表态，先给可点控件，不得用文字问［要不要 / 行不行］。
2. **确认必须点击**：勾选框、按钮、选项。自由文本只用于文字反馈。
3. **未表态 ≠ 通过**：没点过的一律视为未知，必须追问。
4. **不替用户表态**：用户没回应就不要往下推进，也不要用［应该没问题］代替确认。
5. **顺序清单有依赖**：从中间开始时提醒；跳过的步骤要在回执里注明。

## 回退：HTML 批阅页

以下任一情况走 HTML，不要硬塞进原生卡片：

- `batch_review` 不在工具列表里、调用失败或面板超时（`PANEL_TIMEOUT`）；
- 条目很多且面板不可用（客户端未加载 / 用户不在会话页）；
- 需要把结果落盘留档（JSON / xlsx / CSV）。

```sh
python scripts/build_review.py --data items.json --out review/<slug>.html
python scripts/collect_server.py
```

告诉用户用浏览器打开；提交失败就用［复制结果］把 JSON 贴回。

> 详细的生命周期警告、回传协议、结果契约、xlsx/csv 导出见
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

- 先看工具列表：有 `batch_review` 走批阅通道（**含单条**，默认阈值 1）；只有计划批准 / 宿主审批类才用 `ask_user_question`，两者都没有就退回 HTML；
- 面板不在线 / 需要落盘留档 / 条目数超过 `maxItems` → 直接走 HTML，不要硬塞卡片；
- HTML 路径需要四个文件齐全：`SKILL.md`、`assets/review.html`、`scripts/build_review.py`、`scripts/collect_server.py`。
