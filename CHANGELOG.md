# Changelog

## 1.0.0 — 2026-11-01

First public release, merging the former `batch-review-tool` plugin and the
`batch-review-table` skill into one package.

### Tool

- `batch_review`: one call, one card per item, structured `items[].{verdict,note,filled}`,
  `summary` and `report_text` back.
- Item types: `confirm`, `bool`, `choice`, `text`, `scale`.
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

### Packaging

- Renamed from `@local/batch-review-tool` to `dsh-batch-review`; added MIT license,
  `engines.dsh`, repository/keywords metadata, tests and CI.
