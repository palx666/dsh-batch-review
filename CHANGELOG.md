# Changelog

## 1.0.0 — 2026-11-01

First public release, merging the former `batch-review-tool` plugin and the
`batch-review-table` skill into one package.

### Tool

- `batch_review`: one call, one batch, structured `items[].{verdict,note,filled}`,
  `summary` and `report_text` back.
- Two surfaces, one contract: 1–4 items use the paged native card; 5+ items use the
  one-screen panel when its client half is mounted, and fall back to the card when it
  is not. The result's `surface` field says which one answered.
- Item types: `confirm`, `bool`, `choice`, `text`, `scale`.
- Multi-select: `multiSelect: true` on an item keeps every chosen label in `verdict`
  (joined by 、) and in the new `selected[]` array; the report lists them together.
- The third confirm state is now 待定 (formerly 未测); the HTML page and CSV header
  follow the same wording, and the client still tones the legacy 未测 label.
- Choice options render with A/B/C prefixes in the panel; fixed verdict/bool/scale
  sets do not.
- Fail-closed blanks: an unanswered item returns `filled: false` and is listed in the report.
- Cancelled sessions return `cancelled: true` with no items instead of throwing.
- Optional `persist` path writes the result as UTF-8 JSON (with `answered_at`) so verdicts
  survive the session; a write failure lands in `persist_error` and never loses the review.
- Item ids are validated and must be unique; duplicate ids would otherwise fold the
  wrong verdict, so the call is rejected before the user is asked.
- Host error codes are preserved on the thrown error (`code`, `cause`) instead of
  being flattened into a message.
- `header` is capped at 24 characters so a long id cannot crowd the card.
- Tool description no longer claims a "three or more" floor: the skill's routing rules
  decide which surface to use, and the tool itself accepts any item count.
- **Removed** the unused `mode: sequential | independent` parameter. The native card
  pages through items one at a time, so a per-item sequencing mode could not be
  honoured and the field only advertised behaviour it did not have.

### Skill

- The `batch-review-table` skill is now bundled and registered by the plugin itself
  (`ctx.skills.registerProvider()`), so one `dsh plugin add` installs both halves.
- SKILL.md now documents what the card actually looks like (one question at a time,
  paged) and routes 10+ item reviews, overview reviews and persisted reviews to the
  HTML fallback instead of stuffing them into native cards.
- SKILL.md gained the previously undocumented pieces: the HTML result contract
  (`state` enum, `blocked_by`, `assumed_pass`, `summary`), the local collector protocol
  (ports, `/health`, `/submit`, CORS/Private-Network headers, grace window), a
  one-shot lifecycle warning (browser-only page, temp dir wiped on restart, copy-JSON
  fallback), and the CSV offline path (`--format csv`).
- `build_review.py`, `collect_server.py` and `assets/review.html` ship unchanged in
  behaviour, with the same items schema.

### Panel

- New client half (`lib/client.js`) registers a one-screen review panel in
  `conversation.input.dock`; the host half (`lib/panel.js`) serves
  `/api/batch-review/{state,submit,cancel,health}` and holds the single waiting review.
- Presence-gated: the tool only waits for the panel while it has polled within the last
  6 seconds, so a missing client degrades to the native card instead of blocking.
- Cross-origin state changes are refused; the review id is checked on submit; a second
  concurrent review is refused (`BUSY`); a panel review times out after 15 minutes
  (`PANEL_TIMEOUT`) and is reported as `cancelled: true`, never as a pass.

### Packaging

- Renamed from `@local/batch-review-tool` to `dsh-batch-review`; added MIT license,
  `engines.dsh`, repository/keywords metadata, tests and CI.
