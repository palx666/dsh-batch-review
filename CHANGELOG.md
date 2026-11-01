# Changelog

## 1.0.0 — 2026-11-01

First public release, merging the former `batch-review-tool` plugin and the
`batch-review-table` skill into one package.

### Tool

- `batch_review`: one call, one batch, structured `items[].{verdict,note,filled}`,
  `summary` and `report_text` back.
- Two surfaces, one contract: a single item uses the paged native card; 2+ items use the
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
- Item cap: a review above `maxItems` (100 by default) is rejected with a
  split-the-batch message instead of being rendered. Tunables live in three
  layers, lowest first: built-in defaults, the `cordis.patch.yml` `config` block,
  then `~/.dsh/dsh-batch-review.config.json` written by the Settings section
  (Settings → left-nav 「批阅面板」). A save writes only the keys that changed, so
  the cordis layer keeps applying to everything else. Hard limits: `maxItems`
  1–500, `virtualThreshold` 50–2000, `maxBodyBytes` 1 KB–128 MB.
- Panel rows above `virtualThreshold` (500 by default) render with
  `content-visibility: auto`: the browser skips layout/paint for off-screen rows
  while every row keeps its real height, so group headings and 全通过/全待定 keep
  working and nothing is clipped.
- The panel request body cap defaults to 64 MB and can be raised to 128 MB.
- The item detail line is 12px so the expectation reads as secondary text instead
  of competing with the title.
- Tool description no longer claims a "three or more" floor: the skill's routing rules
  decide which surface to use, and the tool itself accepts any item count.
- Tool description shortened (~390 → ~250 chars) since it is paid on every request.
- **Removed** the unused `mode: sequential | independent` parameter. The native card
  pages through items one at a time, so a per-item sequencing mode could not be
  honoured and the field only advertised behaviour it did not have.

### Settings

- New `lib/config.js` and a Settings → left-nav 「批阅面板」 section: edit
  `panelThreshold`, `maxItems`, `panelTimeoutMs` (plus the advanced
  `virtualThreshold`, `maxBodyBytes`, `allowExternalPersist`) without editing YAML
  and without a restart. Writes go to `~/.dsh/dsh-batch-review.config.json`.
- Per-option notes: a choice option's `d` renders beside its label (falling back
  to `v`), so items written against the older contract keep a note.
- The 重置 button says what it does: it fills the defaults in and saves them as
  explicit settings (which override the cordis layer). To hand a tunable back to
  the cordis layer, clear its input and save — the cleared field is sent as `null`
  and the stored override is dropped.

### Panel

- New client half (`lib/client.js`) registers a one-screen review panel in
  `conversation.input.dock`; the host half (`lib/panel.js`) serves
  `/api/batch-review/{state,submit,cancel,health}` and holds the single waiting review.
- Presence-gated: the tool only waits for the panel while it has polled within the last
  15 seconds (2.5× the idle poll interval plus the request timeout), so a missing client
  degrades to the native card instead of blocking.
- Every route checks the Host header against the loopback names the panel can be
  reached by (DNS-rebinding defence), cross-origin state changes are refused, the
  review id is checked on submit; a panel
  review times out after 15 minutes (`PANEL_TIMEOUT`) and is reported as
  `cancelled: true`, never as a pass.
- Large batches: consecutive items with the same `group` (falling back to `header`)
  collapse under one heading, and each heading has 全通过 / 全待定 batch buttons. From
  50 items up the panel hints at the CSV/Excel path; 1000 items are not a panel job.
- Styling now matches the host question card (title 16px, options/detail/notes 14px,
  statistics 12px) so the paged card and the panel no longer look like different apps.
- Option buttons wrap inside the card instead of scrolling horizontally, and the note
  field follows the wrap.
- The panel is used from 2 items up (was 5).
- A reverse proxy or tunnel gets no panel: the routes only accept a loopback `Host`,
  so a GUI reached through one falls back to the native card. The browser console
  says so once — otherwise "the panel never appears" was undiagnosable.
- An item's explanation is folded into the native card's title (e.g. 「重启 — 不白屏」)
  instead of using the host card's separate `detail` row: that row is indented 2px
  against the title's 24px header padding and keeps the primary colour, so it read
  as a line sticking out to the left of the title. The panel still renders the
  explanation on its own indented, secondary-coloured line.

### Internationalization

- English and Chinese ship in one package. The panel and the Settings section
  follow the GUI language through the host's locale service and switch without a
  reload; the client reports the active language on every `/state` poll, and the
  host (which has no locale service of its own) uses it for option labels,
  validation errors and `report_text`. Without a mounted panel the host falls
  back to Chinese.
- Confirm/bool options now carry a `tone` (`pass`/`fail`/`pending`/`yes`/`no`)
  next to their translated label, so the panel no longer recognises verdict
  buttons by their Chinese text.
- The skill ships `SKILL.md` (Chinese) and `SKILL.en.md` (English).
- `batch_review` accepts an explicit `lang` (`en`/`zh`) for the panel-less case
  (a script, or a host where the panel never mounted); without it the host uses
  the language the panel last reported, then Chinese. A tag the package does not
  ship (`fr`) falls through to that next preference instead of pinning Chinese, so
  an invalid explicit value cannot override a panel already showing English.
- Dictionaries register with the per-locale signature the client runner declares
  (`register(ns, locale, dict)`) and are retried when the locale service appears
  after the plugin applies; the disposers go back to `ctx.effect`. A re-entry
  guard keeps the retry from registering the dictionaries twice when the service
  is already present the first time the effect runs.
- Verdict tones fall back to the shipped label wording on a host that predates
  the `tone` field, so the group bulk buttons keep working there.
- Placeholders are substituted in a single pass (`tr`/`fillText`): text that
  itself contains `{total}` stays literal instead of being expanded again.

### Hardening

- Submit token: the panel hands a per-process token to the polling page through
  `GET /state`; a POST without it (or with a stale one) is refused with 403, so a
  cross-origin page cannot read the review or forge an answer even if it finds the route.
- The tool call's abort signal reaches the panel: an aborted session settles the review as
  `cancelled` and clears it, instead of leaving it to hold the panel `BUSY` for the full
  timeout. A panel that answers `BUSY` for any other reason falls back to the native card
  instead of failing the call with "向用户提问失败：BUSY".
- `persist` is confined to the host process cwd subtree; writing elsewhere needs
  `allowExternalPersist: true` in the profile config. A refused path returns
  `persist_error` and the verdicts are still returned.
- Item ids must be strings or finite numbers: empty strings, booleans, objects and `NaN`
  are rejected with the item index (an empty id used to drop its answer silently).
  `scale` ranges that would render more than 100 options are rejected, and a `choice`
  option that is `null` or a bare string no longer crashes the mapping.
- Presence window widened to 15 s (was 6 s): one slow poll can no longer make a live panel
  look unmounted.
- HTML fallback: item ids are escaped in every DOM sink, `build_review.py` rejects
  non-integer ids and escapes U+2028/U+2029 (it already escaped `</`), and
  `collect_server.py` refuses POSTs whose Origin/Referer is not absent, `null` or
  `file://`.
- CI fails on a non-zero `fail`/`cancelled` count instead of trusting a pipeline's exit
  code, and asserts that reviewer text cannot close the page's inline `<script>`.

### Routing

- `lib/prompt.js` registers a short system-prompt section so the "use batch_review vs
  ask_user_question, a blank is never an approval" rule ships with the plugin instead of
  living only in one user's AGENTS.md. The section can be switched off with
  `injectRoutingRule: false` (Settings → Advanced → "Inject the routing rule into the
  system prompt"), which takes effect after a restart; the rule then lives in your own
  `AGENTS.md` and the tool is only reached when named explicitly.

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
- `build_review.py`, `collect_server.py` and `assets/review.html` keep the same items
  schema; the review page now escapes item ids, and the collector only accepts
  `file://`-originated submissions.

### Packaging

- Renamed from `@local/batch-review-tool` to `dsh-batch-review`; added MIT license,
  `engines.dsh`, repository/keywords metadata, tests and CI.
