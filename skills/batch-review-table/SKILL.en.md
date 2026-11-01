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
| Item count | 1 | 2 or more |
| Item relation | pick one/several (parallel or exclusive options) | each item needs an **independent verdict** |
| Result shape | `selected[]` | pass / fail / pending + note |
| Multi-select | ✅ | ✅ (`multiSelect: true` on an item) |
| Plan approval (plan-review) | ✅ | ❌ |
| Summary text | ❌ | ✅ `report_text` |
| Result contract | `answers[]` | `items[].filled/verdict/note` |

Decision order (first match wins):

```
1. Plan approval needed                                  → ask_user_question
2. 2+ items, each needs an independent verdict           → batch_review
3. A single ordinary choice/confirmation                 → ask_user_question
4. Many items (a dozen+), one-screen overview, archival  → HTML review page (see "Fallback")
5. None of the above                                     → see "When even this does not fit"
```

Both tools render the same native card in the Web UI (`batch_review` also goes
through `userQuestions.ask`); the difference is the data contract, not the look.

**Know the card's real shape**: one `batch_review` call puts every item into the
same card, but the UI shows **one question at a time**, paging with previous/next.
More items means more paging — it is "ask once, answer page by page", not a
one-screen overview.

**2+ items switch to the one-screen panel**: once `dsh-batch-review` is installed
there is a review panel above the composer; with 2+ items and the panel online,
`batch_review` uses the panel automatically (all items on one screen, per-item
verdict buttons plus a note field, one submit). You do **not** need a different
tool or parameter. When the panel is offline (the user is on another page or the
client bundle is not loaded) it falls back to the native card. The returned
`surface` field says whether `panel` or `cards` answered.

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
- `multiSelect` (optional): `"multiSelect": true` lets one item take several
  answers; `verdict` joins them with the active language's separator (「、」 in
  Chinese, ", " in English) and `selected[]` keeps the array, and the report lists
  them together;
- `id` must be unique: answers map back by id, and duplicate ids are rejected by
  the tool;
- `persist` (optional): also writes the result as UTF-8 JSON so it survives the
  session; the returned `persisted` is the absolute path actually written, and a
  failed write lands in `persist_error` (the review itself is still returned);
- the tool waits for the user to click — **do not call it twice**, send every item
  in one call;
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
- the result must be archived on disk (JSON / CSV / Excel).

```sh
python scripts/build_review.py --data items.json --out review/<slug>.html
python scripts/collect_server.py
```

Tell the user to open it in a browser; if submitting fails, use "copy result" and
paste the JSON back.

> Lifecycle warnings, the return protocol, the result contract and CSV export are
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

- Check the tool list first: with `batch_review`, use the review channel; without
  it, fall back to `ask_user_question` or the HTML page;
- Panel offline / archival needed / item count above `maxItems` → use the HTML
  page, do not force the card;
- The HTML path needs four files: `SKILL.md`, `assets/review.html`,
  `scripts/build_review.py`, `scripts/collect_server.py`.
