# dsh-batch-review

[![ci](https://github.com/palx666/dsh-batch-review/actions/workflows/ci.yml/badge.svg)](https://github.com/palx666/dsh-batch-review/actions/workflows/ci.yml)

[English](README.en.md) | [中文](README.md)

## Overview

Multi-item review for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): one interaction, a whole batch of answers. When the agent needs the user to confirm, choose, or approve several things at once, it opens the panel; the user clicks through item by item and submits once, and structured results come back to the agent — without breaking the workflow.

## Hard rule: if the user owes a decision, call `batch_review`

**The plugin injects this rule automatically — no setup needed.** It registers a `dsh-batch-review:routing` section in the system prompt (present on every request) and ships a `batch-review-table` skill carrying the same judgement.

- **Whenever the user owes an answer** — a confirmation, a choice, an approval, a rejection, a rating, a comment — give them a clickable surface instead of asking in prose.
- **2+ items that need independent verdicts** → `batch_review`; **a single question or plan approval** → `ask_user_question`.
- **An unanswered item is not an approval**: `filled: false` must be followed up, never assumed passed.

**Prefer not to have it injected?** Settings → left-nav Batch review → Advanced, clear "Inject the routing rule into the system prompt" (equivalently `injectRoutingRule: false`); it takes effect after a **restart**. Nothing is written to the system prompt then — and you should **keep the rule yourself**: state in your own `AGENTS.md` **when `batch_review` should be used** (which cases take the batch form, which take a single `ask_user_question`), otherwise the agent will not reach for the tool on its own (it still works when you name it explicitly).

## How it works

One `batch_review` tool call hands the agent's checklist to the Web UI — native question cards for a single item, a one-screen panel in the input dock at or above the panel threshold (2 items by default) — and returns one structured result: a verdict and a note per item, plus a ready-to-read report. The panel is served by the host's own web server under `/api/batch-review/*`, so there is no separate app to open and no extra port — and a blank item never counts as approved.

```text
agent → batch_review({ title, items: [6 items] })
      → one-screen panel (at/above the threshold, panel mounted) or native cards
      → { items:[{verdict,note,filled}], summary, report_text }
```

## What it does

- **`batch_review` tool.** The agent sends the whole batch in one call. Each item becomes one `AskUserQuestionItem` on the host's native card; the answers come back as `items[].{id,title,type,verdict,note,filled}` plus `summary` and a `report_text` the model can paste into its reply.
- **Fail-closed blanks.** An item the user skipped or left blank returns `filled: false`. The report lists it under "未填" with the explicit note that it is not a pass. A cancelled session returns `cancelled: true` and no items at all — never a silent pass.
- **Five item types.** `confirm` (通过 / 不通过 / 待定), `bool`, `choice`, `text`, `scale`.
- **Multi-select on request.** Set `multiSelect: true` on any item that accepts more than one label; the answer keeps every label in `verdict` (joined with `、`) and in the new `selected[]` array.
- **Bundled skill.** The package also registers the `batch-review-table` skill (decision-channel routing: when to use `ask_user_question` vs `batch_review` vs a full HTML page) so one install covers both halves.
- **HTML fallback.** For large reviews or when a persisted result is needed, the skill ships a self-contained `review.html` + `build_review.py` + `collect_server.py`.

## Relationship to native cards

`batch_review` builds on DSH's native question cards: a small batch uses the card directly, and from the threshold up it becomes a one-screen panel above the input box — both return the same result shape.

**The threshold is configurable**: `panelThreshold` (default 2, range 1–100) is the number of items from which the panel takes over — **set it to 1 to always use the panel** (a single item goes to the panel too, never the native card). See [Settings](#settings) for how to change it.

| Review size | Surface | What you see |
|---|---|---|
| Below the threshold (1 item by default) | Native card (same component `ask_user_question` uses) | One question at a time, paged |
| At or above the threshold, panel mounted (2+ items by default) | **One-screen panel** in the composer dock | The whole batch at once: every item, verdict buttons, its own note field, one submit |
| At or above the threshold, no client | Native card fallback | Paged, never waits for a panel that cannot answer |

The panel polls `GET /api/batch-review/state` only while it is mounted; if it is not (the user is on another page, the client bundle is not loaded, or the host has no web server), `batch_review` degrades to the native card instead of blocking. The returned `surface` field says which one answered.

Both surfaces return the same contract — `items[].{verdict,note,filled}`, `summary`, `report_text` — so the skill and the agent do not care which one was used.

## Settings

Settings → left-nav Batch review has three basic settings:

| Setting | Default | Range | What it does |
|---|---|---|---|
| Panel threshold | 2 | 1–100 | Item count at which the native card becomes the panel; set to 1 to always use the panel |
| Item cap | 100 | 1–500 | Most items in one review; above that the call is rejected with a split-the-batch message and nothing renders |
| Timeout (ms) | 15 min | 1 s – 24 h | How long to wait for the user; a timeout comes back as cancelled |

Under **Advanced** there are also `virtualThreshold`, `maxBodyBytes`, `allowExternalPersist` and `injectRoutingRule` (whether the routing rule is injected into the system prompt). These **rarely need changing**; check the effect before you touch them.

## Install

**Requirements**: DeepSeek Harness `>=0.2.1-rc.3 <=0.2.1-rc.5` (only rc.3–rc.5 have been verified), Node.js `>=20`. No runtime dependencies, no build step — plain ESM.

```sh
# from the repository
dsh plugin --profile <profile> add github:palx666/dsh-batch-review

# or a pinned tag (recommended for reproducibility)
dsh plugin --profile <profile> add https://github.com/palx666/dsh-batch-review/archive/refs/tags/v1.0.0.tar.gz
```

Restart the host (`dsh web` / the desktop app) so the plugin loads. To verify, check that the agent's tool list contains `batch_review`.

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

A relative `persist` path lands under the **host process cwd** (not your workspace); to write elsewhere, enable `allowExternalPersist` in Settings.

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

Three channels, one per size range: **panel → HTML review page → Excel sheet**.

- The panel groups **consecutive** items by `group` (falling back to `header`), and every group heading carries 全通过 / 全待定 batch buttons. A 100-item batch is workable when the agent sorts it into groups first; a flat 100-item list is not.
- **From 50 items up** the panel shows a hint pointing at the Excel sheet. `build_review.py --format xlsx` writes a sheet whose status column already has a dropdown (通过 / 不通过 / 待定 / 跳过), which suits dozens to a thousand rows — clicking through the HTML page a thousand times is not viable, while Excel takes a dropdown plus a drag-fill.
- xlsx needs `openpyxl`; without it the script says so and **falls back to csv** automatically (fillable, just no dropdown).
- Item `group` is optional and free-form; the agent decides the split.

## What ships in the package

| Path | Purpose |
|---|---|
| `index.js` | Host plugin: registers the tool, the skill provider and the panel routes |
| `lib/tool.js` | Item validation, `AskUserQuestionItem` mapping, answer folding, report, panel/card routing |
| `lib/panel.js` | Panel channel: one waiting review, `/api/batch-review` routes, presence |
| `lib/client.js` | Browser half: the one-screen review panel in `conversation.input.dock` |
| `lib/prompt.js` | System-prompt routing section (batch_review vs ask_user_question) |
| `lib/skill.js` | Skill provider for the bundled `batch-review-table` skill |
| `lib/config.js` | Three-layer config parsing and validation (defaults / cordis / settings file) |
| `lib/i18n.js` | English/Chinese dictionaries, placeholder substitution, error localisation |
| `skills/batch-review-table/SKILL.md` | Decision-channel routing rules and the HTML fallback workflow |
| `skills/batch-review-table/SKILL.en.md` | English skill (same judgement as `SKILL.md`) |
| `skills/batch-review-table/references/html-fallback.md` | HTML fallback details (protocol, result contract, xlsx/csv export) — read only when needed |
| `skills/batch-review-table/assets/review.html` | Self-contained review page (progress, paging, “only unfinished”, copy/download JSON) |
| `skills/batch-review-table/scripts/build_review.py` | Render a review page (or an xlsx/csv sheet) from an items JSON |
| `skills/batch-review-table/scripts/collect_server.py` | Local 127.0.0.1 collector: page → `POST /submit` → result file + stdout |
| `locale/zh.json`, `locale/en.json` | Dictionaries for the host locale service (used when the client switches language) |
| `cordis.patch.yml` | Plugin declaration (bundle patch, read at install time) |

## Languages

English and Chinese are both supported, defaulting to the GUI language and switching without a reload. The skill ships `SKILL.md` (Chinese) and `SKILL.en.md` (English).

## Known limitations

- **The panel needs its client half.** It lives in `conversation.input.dock` and only polls while mounted. A host without `webServer`, a client build that does not load the bundle, or a user on another page all mean “no panel”, and the tool degrades to the native card rather than waiting forever.
- **The panel only accepts a loopback Host.** Its routes refuse any `Host` that is not `localhost` / `127.0.0.1` / `::1` (or the address the socket itself is bound to), so a GUI reached through a reverse proxy or tunnel gets no panel — the tool falls back to the native card and no verdict is lost. The browser console says so once.
- **On the native card, the explanation is part of the title.** `expect` / `boolDesc` / `detail` are appended to the title with an em dash (“重启 — 不白屏”) rather than sent as the card's own `detail` row: that row is indented 2px against the title's 24px header padding and keeps the primary colour, so it read as a line sticking out to the left of the title. The panel still shows the explanation on its own indented, secondary-coloured line.
- **Native cards are root-agent only.** `userQuestions.ask()` accepts only the live runtime root, so a subagent that lands on the native card fails with `DELEGATED_CALLER`. The panel path does not go through that host call, so a subagent can still ask through the panel while it is mounted.
- **Persistence is opt-in.** Nothing about a review is written to disk by default; pass `persist: "<path>"` and the verdicts are saved as UTF-8 JSON (the returned `persisted` field is the absolute path actually written). `persist` is confined to the host process cwd unless the profile sets `allowExternalPersist: true`. Without `persist`, a session that ends mid-review returns `cancelled: true` and the batch must be asked again. The Settings section keeps its own config file (see the cap entry below).
- **Item cap (100 by default).** A review above it is **rejected** with a message telling the caller to split the batch; nothing renders. To change the cap, see [Settings](#settings).
- **Large batches skip off-screen paint.** Above `virtualThreshold` rows the panel applies `content-visibility: auto`, so the browser skips layout and paint for rows outside the viewport while every row keeps its real height — no fixed row height, nothing clipped. The defaults (`maxItems: 100`, `virtualThreshold: 500`) keep this path off; lower `virtualThreshold` in Settings → 高级设置 to exercise it.
- **Chinese is only the fallback.** With no panel report and no explicit `lang`, option labels (`confirm`: 通过 / 不通过 / 待定, `bool`: 是 / 否) and `report_text` fall back to Chinese. Anywhere else they follow the UI language, or the `lang` argument.
- **Theme tokens only.** Native cards are styled entirely by DSH; the panel's own CSS uses `--dsw-*` theme tokens exclusively (no literal colors), so it follows the host's light/dark switch. Verified readable on DSH `0.2.1-rc.5` with orca-maid 0.1.1, maid-atelier 0.1.9, orca-link 0.1.9 and deep-whale-manager 0.1.8, plus the built-in DeepSeek Cloud Paper theme.

## Development

```sh
node --test     # mapping, folding, report and plugin registration
```

The HTML fallback has its own smoke path:

```sh
python skills/batch-review-table/scripts/build_review.py --data examples/items.json --out review/demo.html
python skills/batch-review-table/scripts/build_review.py --data examples/items.json --format xlsx --out review/demo.xlsx
python skills/batch-review-table/scripts/collect_server.py   # then open review/demo.html
```

## License

MIT — see [LICENSE](LICENSE).

## Built with

Built with [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh): the tool, the panel and the skill are written against its host APIs.

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
