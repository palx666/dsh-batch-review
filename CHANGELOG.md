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
- Item ids are validated and must be unique; duplicate ids would otherwise fold the
  wrong verdict, so the call is rejected before the user is asked.
- Host error codes are preserved on the thrown error (`code`, `cause`) instead of
  being flattened into a message.
- `header` is capped at 24 characters so a long id cannot crowd the card.
- **Removed** the unused `mode: sequential | independent` parameter. The native card
  pages through items one at a time, so a per-item sequencing mode could not be
  honoured and the field only advertised behaviour it did not have.

### Skill

- The `batch-review-table` skill is now bundled and registered by the plugin itself
  (`ctx.skills.registerProvider()`), so one `dsh plugin add` installs both halves.
- SKILL.md documents the real card shape (one question at a time, paged) and routes
  large reviews to the HTML fallback.
- `build_review.py`, `collect_server.py` and `assets/review.html` ship unchanged in
  behaviour, with the same items schema.

### Packaging

- Renamed from `@local/batch-review-tool` to `dsh-batch-review`; added MIT license,
  `engines.dsh`, repository/keywords metadata, tests and CI.
