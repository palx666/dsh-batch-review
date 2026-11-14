# Changelog

## 1.1.0 — 2026-11-14

> Only 1.1.0 is published remotely (there is no 1.0.3–1.0.9 release). This version summarizes every change since 1.0.1; older entries stay in [CHANGELOG.md](CHANGELOG.md) as detailed records.

### Fixed

- Fixed the panel being cut off by the default wait rule in PTC mode.
- Fixed duplicated numbering and scrambled order when the caller numbers the options itself.
- Fixed silent panel degradation truncating multi-item reviews.
- Fixed relative `persist` paths landing in the profile directory.

### Changed

- Reworked multi-select handling.
- A single item now uses the review panel by default too (it adds a note field and cannot be cut off); the native card is only a fallback when the panel is offline or the user raises the threshold.

### Known

- `batch_review` does not support plan-review / approval intents yet.
