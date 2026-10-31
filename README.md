# dsh-batch-review

Per-item review cards for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), built on the host's own question UI.

One `batch_review` tool call hands the agent's checklist to the Web UI as native question cards and returns one structured result: a verdict and a note per item, plus a ready-to-read report. No added UI, no browser page, no local server — and a blank item never counts as approved.

```text
agent → batch_review({ title, items: [6 items] }) → native cards → { items:[{verdict,note,filled}], report_text }
```

## Why

An agent that needs a verdict on six checklist items has two bad options today:

- six `ask_user_question` calls — six interruptions, and the agent must stitch the answers back together;
- asking in prose — the user replies "1 ok, 2 ok, 4 broken", and the model re-parses text into state.

`batch_review` is the third option: one call, the host's own cards, one machine-readable result. The failure mode it exists to prevent is the quiet one — an unanswered item being treated as "approved".

## What it does

- **`batch_review` tool.** The agent sends 3+ items in one call. Each item becomes one `AskUserQuestionItem` on the host's native card; the answers come back as `items[].{id,title,type,verdict,note,filled}` plus `summary` and a `report_text` the model can paste into its reply.
- **Fail-closed blanks.** An item the user skipped or left blank returns `filled: false`. The report lists it under "未填" with the explicit note that it is not a pass. A cancelled session returns `cancelled: true` and no items at all — never a silent pass.
- **Five item types.** `confirm` (通过 / 不通过 / 未测), `bool`, `choice`, `text`, `scale`.
- **Bundled skill.** The package also registers the `batch-review-table` skill (decision-channel routing: when to use `ask_user_question` vs `batch_review` vs a full HTML page) so one install covers both halves.
- **HTML fallback.** For large reviews or when a persisted result is needed, the skill ships a self-contained `review.html` + `build_review.py` + `collect_server.py`.

## Install

```sh
# from the repository
dsh plugin --profile <profile> add github:palx666/dsh-batch-review

# or a pinned tag (recommended for reproducibility)
dsh plugin --profile <profile> add https://github.com/palx666/dsh-batch-review/archive/refs/tags/v1.0.0.tar.gz

# or from npm once published
dsh plugin --profile <profile> add dsh-batch-review
```

Restart the host (`dsh web` / the desktop app) so the plugin loads. To verify, check that the agent's tool list contains `batch_review`.

Requirements: DeepSeek Harness `>=0.2.1-rc.3 <0.3.0-0`. No runtime dependencies, no build step — plain ESM.

## Usage

```json
{
  "title": "Acceptance: file copy / download buttons",
  "persist": "review/acceptance.json",
  "items": [
    { "id": 1, "type": "confirm", "op": "Restart DSH and reload the page", "expect": "No white screen" },
    { "id": 2, "type": "choice", "label": "Connection mode", "options": [{ "v": "A", "t": "Direct 18080" }, { "v": "B", "t": "Via DSH subagent" }] },
    { "id": 3, "type": "bool", "label": "Keep the gateway task resident", "boolDesc": "Accept" },
    { "id": 4, "type": "scale", "label": "Overall rating", "min": 1, "max": 5 },
    { "id": 5, "type": "text", "label": "Describe anything that looked off" }
  ]
}
```

Result (truncated):

```json
{
  "cancelled": false,
  "items": [
    { "id": "1", "type": "confirm", "verdict": "通过", "note": "", "filled": true },
    { "id": "3", "type": "bool", "verdict": "", "note": "", "filled": false }
  ],
  "summary": { "total": 5, "filled": 4 },
  "persisted": "/abs/path/review/acceptance.json",
  "report_text": "【批阅】Acceptance: file copy / download buttons\n共 5 条 · 已填 4 条 · 未填 1 条\n…\n未填：3（没填不代表通过，需要单独追问）"
}
```

Rules the tool enforces for the model:

- `items` must be a non-empty array and `id`s must be unique — answers are folded back by id, so a duplicate is rejected instead of silently overwriting;
- `persist` (optional) writes the result as UTF-8 JSON so the verdicts survive the session; the returned `persisted` field holds the absolute path, and a write failure lands in `persist_error` without affecting the review result;
- the tool suspends until the user answers; the model must not call it twice for the same batch;
- `filled: false` must be followed up, never read as approval;
- `cancelled: true` means there is no verdict at all — re-ask.

## What ships in the package

| Path | Purpose |
|---|---|
| `index.js` | Host plugin: registers the tool and the skill provider |
| `lib/tool.js` | Item validation, `AskUserQuestionItem` mapping, answer folding, report |
| `lib/skill.js` | Skill provider for the bundled `batch-review-table` skill |
| `skills/batch-review-table/SKILL.md` | Decision-channel routing rules and the HTML fallback workflow |
| `skills/batch-review-table/assets/review.html` | Self-contained review page (progress, paging, “only unfinished”, copy/download JSON) |
| `skills/batch-review-table/scripts/build_review.py` | Render a review page (or CSV) from an items JSON |
| `skills/batch-review-table/scripts/collect_server.py` | Local 127.0.0.1 collector: page → `POST /submit` → result file + stdout |

## Known limitations

- **One card, one question at a time.** The native card pages through the batch (“1 / 6”, previous / next) rather than showing all items at once. That is fine for a handful of items; for a long checklist use the bundled HTML page, which shows everything in one scrollable list.
- **Root agent only.** `userQuestions.ask()` accepts only the live runtime root, so a subagent cannot call `batch_review`; the call fails with `DELEGATED_CALLER`. This is a host boundary, not a plugin bug.
- **No persistence.** Nothing is written to disk; if the session ends mid-review the result is `cancelled: true` and the batch must be asked again.
- **Chinese option labels by default.** `confirm` renders 通过 / 不通过 / 未测 and `bool` renders 是 / 否. Edit the constants in `lib/tool.js` if you need another language.
- **Host-owned styling.** The card look, keyboard behavior and accessibility come from DSH; this package adds no CSS.

## Development

```sh
npm test        # node --test — mapping, folding, report and plugin registration
```

The HTML fallback has its own smoke path:

```sh
python skills/batch-review-table/scripts/build_review.py --data examples/items.json --out review/demo.html
python skills/batch-review-table/scripts/collect_server.py   # then open review/demo.html
```

## License

MIT — see [LICENSE](LICENSE).
