# dsh-batch-review

Per-item review cards for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), built on the host's own question UI.

One `batch_review` tool call hands the agent's checklist to the Web UI — native question cards for a single item, a one-screen panel in the input dock from 2 items up — and returns one structured result: a verdict and a note per item, plus a ready-to-read report. The panel is served by the host's own web server under `/api/batch-review/*`, so there is no separate app to open and no extra port — and a blank item never counts as approved.

```text
agent → batch_review({ title, items: [6 items] })
      → one-screen panel (≥2 items, panel mounted) or native cards
      → { items:[{verdict,note,filled}], summary, report_text }
```

## Why

An agent that needs a verdict on six checklist items has two bad options today:

- six `ask_user_question` calls — six interruptions, and the agent must stitch the answers back together;
- asking in prose — the user replies "1 ok, 2 ok, 4 broken", and the model re-parses text into state.

`batch_review` is the third option: one call, the host's own cards, one machine-readable result. The failure mode it exists to prevent is the quiet one — an unanswered item being treated as "approved".

## What it does

- **`batch_review` tool.** The agent sends the whole batch in one call. Each item becomes one `AskUserQuestionItem` on the host's native card; the answers come back as `items[].{id,title,type,verdict,note,filled}` plus `summary` and a `report_text` the model can paste into its reply.
- **Fail-closed blanks.** An item the user skipped or left blank returns `filled: false`. The report lists it under "未填" with the explicit note that it is not a pass. A cancelled session returns `cancelled: true` and no items at all — never a silent pass.
- **Five item types.** `confirm` (通过 / 不通过 / 待定), `bool`, `choice`, `text`, `scale`.
- **Multi-select on request.** Set `multiSelect: true` on any item that accepts more than one label; the answer keeps every label in `verdict` (joined with `、`) and in the new `selected[]` array.
- **Bundled skill.** The package also registers the `batch-review-table` skill (decision-channel routing: when to use `ask_user_question` vs `batch_review` vs a full HTML page) so one install covers both halves.
- **HTML fallback.** For large reviews or when a persisted result is needed, the skill ships a self-contained `review.html` + `build_review.py` + `collect_server.py`.

## Two surfaces, one result shape

| Review size | Surface | What you see |
|---|---|---|
| 1 item | Native card (same component `ask_user_question` uses) | One question at a time, paged |
| 2+ items, panel mounted | **One-screen panel** in the composer dock | The whole batch at once: every item, verdict buttons, its own note field, one submit |
| 2+ items, no client | Native card fallback | Paged, never waits for a panel that cannot answer |

The panel polls `GET /api/batch-review/state` only while it is mounted; if it is not (the user is on another page, the client bundle is not loaded, or the host has no web server), `batch_review` degrades to the native card instead of blocking. The returned `surface` field says which one answered.

Both surfaces return the same contract — `items[].{verdict,note,filled}`, `summary`, `report_text` — so the skill and the agent do not care which one was used.

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

Requirements: DeepSeek Harness `>=0.2.1-rc.3 <0.3.0-0`, Node.js `>=20`. No runtime dependencies, no build step — plain ESM.

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

## Large batches

- The panel groups **consecutive** items by `group` (falling back to `header`), and every group heading carries 全通过 / 全待定 batch buttons. A 100-item batch is workable when the agent sorts it into groups first; a flat 100-item list is not.
- From 50 items up the panel shows a hint pointing at CSV/Excel. 1000 items belong in the skill's CSV export (`build_review.py --format csv`, opened in Excel with data validation), not in a click-through panel.
- Item `group` is optional and free-form; the agent decides the split.

## Routing rule ships with the plugin

`lib/prompt.js` registers a short system-prompt section (~250 chars) that says when to use `batch_review` versus `ask_user_question`, and that a blank item is never an approval. It is present on every request, so other users do not have to copy an `AGENTS.md` rule by hand.

If you would rather own that rule yourself, add your own `AGENTS.md` entry — the plugin section is additive, not exclusive.

## What ships in the package

| Path | Purpose |
|---|---|
| `index.js` | Host plugin: registers the tool, the skill provider and the panel routes |
| `lib/tool.js` | Item validation, `AskUserQuestionItem` mapping, answer folding, report, panel/card routing |
| `lib/panel.js` | Panel channel: one waiting review, `/api/batch-review` routes, presence |
| `lib/client.js` | Browser half: the one-screen review panel in `conversation.input.dock` |
| `lib/prompt.js` | System-prompt routing section (batch_review vs ask_user_question) |
| `lib/skill.js` | Skill provider for the bundled `batch-review-table` skill |
| `skills/batch-review-table/SKILL.md` | Decision-channel routing rules and the HTML fallback workflow |
| `skills/batch-review-table/references/html-fallback.md` | HTML fallback details (protocol, result contract, CSV) — read only when needed |
| `skills/batch-review-table/assets/review.html` | Self-contained review page (progress, paging, “only unfinished”, copy/download JSON) |
| `skills/batch-review-table/scripts/build_review.py` | Render a review page (or CSV) from an items JSON |
| `skills/batch-review-table/scripts/collect_server.py` | Local 127.0.0.1 collector: page → `POST /submit` → result file + stdout |

## Known limitations

- **One card, one question at a time — below the threshold.** A single item still uses the native card. From 2 items up, the one-screen panel takes over when it is mounted; if it is not, the paged card is still the fallback.
- **The panel needs its client half.** It lives in `conversation.input.dock` and only polls while mounted. A host without `webServer`, a client build that does not load the bundle, or a user on another page all mean “no panel”, and the tool degrades to the native card rather than waiting forever.
- **Root agent only.** `userQuestions.ask()` accepts only the live runtime root, so a subagent cannot call `batch_review`; the call fails with `DELEGATED_CALLER`. This is a host boundary, not a plugin bug.
- **Persistence is opt-in.** Nothing is written to disk by default; pass `persist: "<path>"` and the verdicts are saved as UTF-8 JSON (the returned `persisted` field is the absolute path actually written). `persist` is confined to the host process cwd unless the profile sets `allowExternalPersist: true`. Without `persist`, a session that ends mid-review returns `cancelled: true` and the batch must be asked again.
- **Item cap (100 by default).** A review above it is **rejected** with a message telling the caller to split the batch; nothing renders. Every tunable lives in `cordis.patch.yml` under `config`: `maxItems` (rejection cap), `panelThreshold` (items needed to use the panel), `virtualThreshold` (rows above which the panel virtualizes), `panelTimeoutMs` (panel wait), `maxBodyBytes` (panel request body cap), `allowExternalPersist` (lift the cwd-only rule on `persist`).
- **Virtual scrolling is unreachable with the defaults.** Above `virtualThreshold` rows the panel renders only the visible window (fixed 100px rows / 30px group headers). The defaults are `maxItems: 100` and `virtualThreshold: 500`, so a review is rejected before it is big enough to virtualize; the path only runs if `maxItems` is raised above `virtualThreshold`.
- **Chinese option labels by default.** `confirm` renders 通过 / 不通过 / 待定 and `bool` renders 是 / 否. Edit the constants in `lib/tool.js` if you need another language.
- **Theme tokens only.** Native cards are styled entirely by DSH; the panel's own CSS uses `--dsw-*` theme tokens exclusively (no literal colors), so it follows the host's light/dark switch.

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
