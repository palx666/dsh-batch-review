---
name: batch-review-table
description: Use whenever the user owes a decision — anything where they must confirm, choose, approve, reject, rate, or comment, on one item or many. Skip only when the user owes no decision (pure information, authoring, or explanation requests).
---

# Batch review table

Turn "the user must take a position" into something they can click: **ask with a
click, not with a typing prompt**.

> This skill ships inside the `dsh-batch-review` plugin; there is no need to copy
> it into `~/.dsh/skills/` by hand. The Chinese original is `SKILL.md`.

## When to use it

Any request that needs a user position: confirming, choosing, approving,
rejecting, rating, commenting — one item or many.

## When not to use it

When the user owes no decision: pure information lookup, writing documents,
explaining code, summarising content.

## Picking the channel

**Rule zero: whenever the user owes a decision, give them a clickable surface —
never ask "should I / shall I" in prose.** The split below only picks the lighter
shape; it is not a licence to type questions for "small" cases.

| Criterion | `ask_user_question` | `batch_review` |
|---|---|---|
| When | Plan approval (plan-review) and host approval prompts — only the native API can emit those intents | Everything else where the user owes a decision: confirm, choose, approve, reject, rate, comment (**one item or many**) |
| Item count | 1 | 1 or more (default panel threshold 1 = a single item also uses the panel) |
| Item relation | pick one/several (parallel or exclusive options) | each item needs an **independent verdict** |
| Result shape | `selected[]` | pass / fail / pending + note |
| Multi-select | ✅ | ✅ (`multiSelect: true` on an item) |
| Plan approval (plan-review) | ✅ (the only entry) | ❌ (items carry no intent/plan payload) |
| Summary text | ❌ | ✅ `report_text` |
| Result contract | `answers[]` | `items[].filled/verdict/note` |

Decision order (first match wins):

```
1. Plan approval (plan-review) or host approval         → ask_user_question
2. Everything else where the user owes a decision
   (a single ordinary question, 2+ independent items)   → batch_review
3. Many items (a dozen+), one-screen overview, archival  → HTML review page (see "Fallback")
4. None of the above                                     → see "When even this does not fit"
```

Both tools use the same native card component in the Web UI (`batch_review` also
goes through `userQuestions.ask`); the difference is the data contract. **The
default threshold is 1**: ordinary requests always use `batch_review`, which
renders the one-screen panel, and no longer the native card.

**Know the card's real shape**: the native card is only the fallback when the
panel is offline. There the UI shows **one question at a time**, paging with
previous/next; more items means more paging. Under the default threshold the
panel should be used instead (below).

**Default panel threshold is 1: even a single item uses the one-screen panel**:
once `dsh-batch-review` is installed there is a review panel above the composer;
`panelThreshold` defaults to 1, so even a one-item review uses the panel (all
items on one screen, per-item verdict buttons plus a note field, one submit).
You do **not** need a different tool or parameter. The native card is used in
only two cases: ① the panel is offline (the user is on another page, the client
bundle is not loaded, or the host has no webServer); ② the user manually raised
`panelThreshold` above the item count. The returned `surface` field says whether
`panel` or `cards` answered.

**The native card is a degraded path, and it has no slicing/resume**: do not
route to it on purpose under the default threshold. If the host execution budget
(e.g. `run_code`'s 2-minute default) cuts the card path off, there is no
`review_id` to resume with — the review must be restarted. For a stable long
wait, keep the threshold at 1 and keep the panel online; when the panel really is
offline, tell the user and wait until it is available rather than sending a big
batch to the card.

## `batch_review` usage

Pass every item in one call:

```json
{
  "title": "Acceptance: link-test copy/download buttons",
  "items": [
    { "id": 1, "type": "confirm", "op": "Restart DSH and reload the page", "expect": "The UI renders normally, no blank screen" },
    { "id": 2, "type": "choice", "label": "Connection mode", "options": [{ "v": "A", "t": "Direct 18080" }, { "v": "B", "t": "Through a DSH subagent" }] },
    { "id": 3, "type": "bool", "label": "Gateway scheduled task stays resident", "boolDesc": "Accept" }
  ],
  "persist": "review/acceptance.json"
}
```

- `type`: `confirm` (pass/fail/pending), `choice`, `bool`, `text`, `scale`;
- Order a `choice` item's options by importance: **the recommended option
  goes first** (the panel numbers by array order, so it becomes A), the rest
  follow as B, C…; do not write a letter or number prefix — or a combination
  such as "A+B" — in the option text (`t`/`label`); say "both" instead. The
  verdict is the option text itself, so keep it free of numbering. Cite options
  by the panel letter in prose ("A (recommended) / B / C"). A caller-written
  marker (`B …`, `1. …`, `2、…`) is kept verbatim
  instead of being numbered twice, but that is only a compatibility path, not
  the recommended spelling;
- **When the options can be combined, use multi-select — never invent a combined
  option.** If several actions can be adopted together (e.g. change the host config
  *and* the plugin), set `"multiSelect": true` on that item, list each independently
  selectable action as its own option, and add a "none" option (e.g. `A`, `B`,
  `都不做`); ticking A+B is the combination. Do **not** put a combination such as
  "A+B" into a single option, and do not write letter prefixes in option text — the
  panel numbers options by array order, so combination text fights the numbering.
  `verdict` joins the labels with the active language's separator (［、］ in Chinese,
  ", " in English) and `selected[]` keeps the array. Mark a **mutually exclusive**
  option (e.g. "都不做"/"none") with `"exclusive": true` — a label reading 都不做 or
  none is recognised automatically: ticking it clears the others, ticking another
  clears it, and the server rejects a submit that combines both;
- `id` must be unique: answers map back by id, and duplicate ids are rejected by
  the tool;
- `persist` (optional): also writes the result as UTF-8 JSON so it survives the
  session; the returned `persisted` is the absolute path actually written, and a
  failed write lands in `persist_error` (the review itself is still returned);
- the tool waits for the user to click — **do not call it twice**, send every item
  in one call;
- returned `pending: true`: the panel is still open; only this call's **wait
  slice** expired (~90 s). It is neither a failure nor a pass, and nothing the
  user typed is lost. You **must** call `batch_review({ "review_id": "<the returned
  review_id>" })` again (without items) until `pending` is `false`;
- inside `run_code`, set the program `timeoutMs` to **>= 900000**, or make one
  `batch_review` call per program; the default 2-minute budget ends the wait early
  (the review survives and a resumed call collects it);
- returned `items[].filled`: `false` = the user took no position, **ask again; it
  is never a pass**;
- returned `cancelled: true`: the session was interrupted/cancelled, **there are
  no verdicts**, start the review again.

## When even this does not fit

| Situation | What to do |
|---|---|
| The user should write long text (describe a symptom, state a request) | Talk directly, but offer a structure to follow (list/template) |
| The user must operate an external program (restart, click in a browser) | Explain in words, then collect the confirmation with one `confirm` item |
| A file or screenshot must be uploaded | Use attachments, do not stuff them into options |
| The user must read a long document before deciding | Give the document/path first, then collect the verdict with `batch_review` |

## Hard rules

1. **Think surface first, wording second**: whenever the user owes a decision,
   give a clickable control; never ask "should I / shall I" in prose.
2. **Confirmation must be clicked**: checkboxes, buttons, options. Free text is
   only for written feedback.
3. **No answer ≠ pass**: anything not clicked is unknown; ask again.
4. **Never answer for the user**: if they did not respond, do not move on, and do
   not substitute "it should be fine" for a confirmation.
5. **Ordered checklists have dependencies**: when starting in the middle, say so;
   note skipped steps in the receipt.

## Fallback: the HTML review page

Use the HTML page instead of forcing the card when any of these holds:

- `batch_review` is not in the tool list, the call failed, or the panel timed out
  (`PANEL_TIMEOUT`);
- there are many items and the panel is unavailable (client not loaded / the user
  is on another page);
- the result must be archived on disk (JSON / xlsx / CSV).

```sh
python scripts/build_review.py --data items.json --out review/<slug>.html
python scripts/collect_server.py
```

Tell the user to open it in a browser; if submitting fails, use "copy result" and
paste the JSON back.

> Lifecycle warnings, the return protocol, the result contract and the xlsx/csv export are
> documented in [references/html-fallback.md](references/html-fallback.md); read
> it when debugging.

## How to use the result

| State | Action |
|---|---|
| Pass / filled | Do it |
| Fail | Treat as a defect; follow any note |
| Blocked | Wait for the previous item to be fixed, do not ask again |
| Pending | Ask how to verify it |
| No answer | **Ask again; never default to pass** |
| cancelled | **No verdicts at all; start over** |

## Pre-flight checklist

- Check the tool list first: with `batch_review`, use the review channel (**a
  single item included**, default threshold 1); only plan approval / host
  approval prompts use `ask_user_question`, and if neither exists fall back to
  the HTML page;
- Panel offline / archival needed / item count above `maxItems` → use the HTML
  page, do not force the card;
- The HTML path needs four files: `SKILL.md`, `assets/review.html`,
  `scripts/build_review.py`, `scripts/collect_server.py`.
