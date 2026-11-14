/**
 * `batch_review` — mapping, folding and reporting helpers.
 *
 * The tool hands the agent's items to `ctx.userQuestions.ask()`, which renders the
 * host's own question cards. This module owns the pure parts so they can be tested
 * without a running host: item validation, `AskUserQuestionItem` mapping, answer
 * folding, and the model-facing report.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_LANG,
  boolOptions,
  confirmOptions,
  i18nError,
  localizeError,
  matchLang,
  tr,
} from './i18n.js';

const ITEM_TYPES = new Set(['confirm', 'choice', 'bool', 'text', 'scale']);
const HEADER_MAX_CHARS = 24;
/**
 * A scale item turns its [min, max] range into one option per integer. Without
 * a cap, `{ min: 0, max: 100000 }` asked the host to render 100k buttons.
 */
const MAX_SCALE_OPTIONS = 100;
/**
 * How long a panel that polled earlier (but not within the presence window) gets
 * to pick a review up before the native card takes over. Covers a background tab
 * whose timers are throttled and a page that was just reloaded; short enough that
 * an actually-unreachable panel does not stall the call for the full timeout.
 */
const PANEL_PICKUP_MS = 20000;
/**
 * One wait slice for a live panel review.
 *
 * A `run_code` call gets two minutes of execution budget by default, and that
 * budget includes time waiting for nested tools such as this one. Waiting the
 * whole 15-minute review in a single call therefore died at the host deadline
 * and threw away a half-filled panel. Instead each call waits at most one slice,
 * returns `{pending: true, review_id}`, and the caller resumes with the same
 * review id. 90 s leaves 30 s of headroom inside the default budget; `wait_ms`
 * lets a caller that configured a shorter budget shrink it further.
 */
const WAIT_SLICE_MS = 90 * 1000;
const WAIT_SLICE_MIN_MS = 1000;
const WAIT_SLICE_MAX_MS = 300 * 1000;

/** Stable string id for an item; falls back to its 1-based position. */
export function idOf(item, index) {
  if (item && item.id !== undefined && item.id !== null) return String(item.id);
  return String(index + 1);
}

/** Human-readable title used both on the card and in the report. */
export function titleOf(item, id, lang = DEFAULT_LANG) {
  return item.label || item.boolLabel || item.op || tr(lang, 'title.fallback', { id });
}

/**
 * The item's type. An explicit `type` wins; otherwise a non-empty `options`
 * array means `choice`. Sending options without a type is the natural way to
 * read the call — the host's own `batch_review` infers choice the same way, and
 * defaulting to `confirm` would render yes/no buttons over the caller's options.
 */
function typeOf(item) {
  if (ITEM_TYPES.has(item.type)) return item.type;
  if (Array.isArray(item.options) && item.options.length > 0) return 'choice';
  return 'confirm';
}

/** Top strip of the card. Kept short: a long id must not crowd it out. */
function headerOf(item, id) {
  const raw = typeof item.header === 'string' && item.header.trim() ? item.header.trim() : '#' + id;
  return raw.length > HEADER_MAX_CHARS ? raw.slice(0, HEADER_MAX_CHARS - 1) + '…' : raw;
}

function choiceOf(option) {
  if (option === null || typeof option !== 'object' || Array.isArray(option)) {
    // A bare string (or a null hole) is tolerated: the card shows it as a label
    // instead of crashing while reading `option.t`.
    return { label: option === undefined || option === null ? '' : String(option) };
  }
  const label = String(option.t || option.label || option.v || '');
  // `d` is the optional human-readable option note. `v` is only the stored value:
  // showing it as a note would put the caller's own letters at the end of the row,
  // next to the panel's A./B./C. numbering, and read as a second, contradictory
  // number. The label still falls back to `v` when neither `t` nor `label` is given.
  const note = typeof option.d === 'string' && option.d.trim() !== '' ? option.d.trim() : '';
  // A mutually exclusive option such as "都不做"/"none": picking it must clear
  // every other option, and picking another option must clear it. The panel
  // treats a label reading 都不做/无/none as exclusive even without the flag.
  const exclusive = option.exclusive === true || option.none === true;
  const out = exclusive ? { label, exclusive: true } : { label };
  if (note !== '') out.description = note;
  return out;
}

/**
 * Ids arrive as strings or numbers; anything else stringifies into a value that
 * silently collides (``[object Object]``) or that the answer cannot reference.
 */
function assertUsableId(item, index) {
  const raw = item.id;
  if (raw === undefined || raw === null) return;
  if (typeof raw === 'string') {
    if (raw.trim() === '') throw i18nError('err.idEmpty', { index });
    return;
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw i18nError('err.idType', { index, value: String(raw) });
    return;
  }
  throw i18nError('err.idKind', {
    index,
    kind: Object.prototype.toString.call(raw),
  });
}

/** One error for both validation layers (normalizeItems and toQuestion). */
function scaleTooLarge(index, count) {
  const error = i18nError('err.scaleTooLarge', { index, count, max: MAX_SCALE_OPTIONS });
  error.code = 'BAD_SCALE';
  return error;
}

/**
 * The item's explanation line. `expect` (confirm) and `boolDesc` (bool) are the
 * specific spellings, `detail` is the general fallback; everything is optional.
 */
export function detailOf(item) {
  const detail = item.expect || item.boolDesc || item.detail;
  return typeof detail === 'string' && detail !== '' ? detail : '';
}

/**
 * Map one item onto the host's `AskUserQuestionItem`.
 *
 * `options` is omitted for `text` items so the card offers only the free-text
 * field.
 *
 * The host card renders a `detail` row with `margin: 0 2px 8px` and no colour
 * of its own (it inherits the primary label colour), while the title sits in a
 * 24px-padded header. A separate detail row therefore reads as a line sticking
 * out to the left of the title, in the wrong colour. Until that card is fixed
 * upstream the explanation is folded into the title and no `detail` is sent;
 * the panel renders its own indented, secondary-coloured detail line (see the
 * panel items built in `execute`).
 */
export function toQuestion(item, index, lang = DEFAULT_LANG) {
  const id = idOf(item, index);
  const type = typeOf(item);
  const title = titleOf(item, id, lang);
  const detail = detailOf(item);
  const question = {
    id,
    question: detail === '' ? title : title + ' — ' + detail,
    header: headerOf(item, id),
    // `multi_select` is the spelling the host's ask_user_question uses; accept it
    // too so callers do not have to remember which tool wants which casing.
    multiSelect: item.multiSelect === true || item.multi_select === true,
  };

  if (type === 'confirm') {
    question.options = confirmOptions(lang);
  } else if (type === 'bool') {
    question.options = boolOptions(lang);
  } else if (type === 'scale') {
    const min = Number.isInteger(item.min) ? item.min : 1;
    const max = Number.isInteger(item.max) ? item.max : 5;
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    const count = high - low + 1;
    if (count > MAX_SCALE_OPTIONS) throw scaleTooLarge(index, count);
    question.options = [];
    for (let n = low; n <= high; n += 1) question.options.push({ label: String(n) });
  } else if (type === 'choice') {
    // A null hole or a bare string has no label to show; dropping it keeps the
    // card free of empty buttons without crashing the whole review.
    question.options = (Array.isArray(item.options) ? item.options : [])
      .map(choiceOf)
      .filter((option) => option.label !== '');
  }
  // text: no options key at all — the host then renders a free-text field.

  return question;
}

/**
 * Validate the agent's items once, before anything is rendered.
 *
 * Duplicate ids are rejected instead of silently overwriting each other: the
 * answer comes back keyed by id, so a collision would fold the wrong verdict.
 */
export function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw i18nError('err.itemsEmpty');
  const seen = new Set();
  return items.map((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw i18nError('err.itemNotObject', { index });
    }
    assertUsableId(item, index);
    const id = idOf(item, index);
    if (seen.has(id)) throw i18nError('err.duplicateId', { id });
    seen.add(id);
    if (item.type === 'scale') {
      const min = Number.isInteger(item.min) ? item.min : 1;
      const max = Number.isInteger(item.max) ? item.max : 5;
      const count = Math.max(min, max) - Math.min(min, max) + 1;
      if (count > MAX_SCALE_OPTIONS) throw scaleTooLarge(index, count);
    }
    return item;
  });
}

/** Fold the host answer back into one row per item. */
export function buildRows(items, answer, lang = DEFAULT_LANG) {
  const byId = new Map();
  const answers = answer && Array.isArray(answer.answers) ? answer.answers : [];
  for (const given of answers) {
    if (given && given.id !== undefined) byId.set(String(given.id), given);
  }

  return items.map((item, index) => {
    const id = idOf(item, index);
    const given = byId.get(id) || { selected: [], custom: '' };
    const selected = Array.isArray(given.selected)
      ? given.selected.filter((value) => typeof value === 'string')
      : [];
    const note = typeof given.custom === 'string' ? given.custom.trim() : '';
    // A multi-select answer keeps every label in `verdict` (joined) and in the
    // new `selected` array, so single-value consumers still read something sane.
    const verdict = selected.join(tr(lang, 'join.multi'));
    return {
      id,
      title: titleOf(item, id, lang),
      type: typeOf(item),
      verdict,
      selected,
      note,
      filled: verdict !== '' || note !== '',
    };
  });
}

/** Model-facing report. `filled: false` rows are called out, never implied as passed. */
export function buildReport(title, rows, lang = DEFAULT_LANG, banner = '') {
  const filledRows = rows.filter((row) => row.filled);
  const openRows = rows.filter((row) => !row.filled);
  const lines = rows.map((row) => {
    if (!row.filled) return row.id + '. ' + row.title + ' → ' + tr(lang, 'report.unfilled');
    let line = row.id + '. ' + row.title + ' → ' + (row.verdict || tr(lang, 'report.noteOnly'));
    if (row.note) line += ' — ' + row.note;
    return line;
  });

  const out = [];
  out.push(tr(lang, 'report.title', { title: title || '' }));
  if (banner) out.push(banner);
  out.push(openRows.length
    ? tr(lang, 'report.summaryOpen', { total: rows.length, filled: filledRows.length, open: openRows.length })
    : tr(lang, 'report.summary', { total: rows.length, filled: filledRows.length }));
  out.push('');
  out.push(lines.join('\n'));
  if (openRows.length) {
    out.push('');
    out.push(tr(lang, 'report.openList', { ids: openRows.map((row) => row.id).join(tr(lang, 'join.multi')) }));
  }
  return out.join('\n');
}

/**
 * Banner explaining why a multi-item review was answered on the paged native
 * card. The card shows one question per page, so a large review is easy to
 * submit half-answered.
 *
 * @param {'panel-unmounted'|'panel-unreachable'|'panel-busy'} reason
 */
export function degradedBanner(lang, reason, total) {
  if (reason === 'panel-unreachable') {
    return tr(lang, 'report.degradedUnreachable', { total, seconds: Math.round(PANEL_PICKUP_MS / 1000) });
  }
  if (reason === 'panel-busy') return tr(lang, 'report.degradedBusy', { total });
  return tr(lang, 'report.degradedUnmounted', { total });
}

/** Report used when the ask never produced an answer (abort or session end). */
export function cancelledReport(title, reason, lang = DEFAULT_LANG) {
  return [
    tr(lang, 'report.title', { title: title || '' }),
    '',
    tr(lang, 'report.cancelled', { reason }),
    tr(lang, 'report.cancelledRetry'),
  ].join('\n');
}

/**
 * Report used when the wait slice expired but the review is still live.
 *
 * This is the message that teaches the caller the resume protocol, so it must
 * say three things unambiguously: the review is NOT finished, the answers so
 * far are NOT lost, and the next call must carry `review_id` instead of items.
 */
export function pendingReport(title, reviewId, total, lang = DEFAULT_LANG, seconds = WAIT_SLICE_MS / 1000) {
  return [
    tr(lang, 'report.title', { title: title || '' }),
    '',
    tr(lang, 'report.pendingWait', { total, seconds }),
    tr(lang, 'report.pendingResume', { review_id: reviewId }),
    tr(lang, 'report.pendingBudget'),
  ].join('\n');
}

/** Clamp a caller-supplied wait slice; the default keeps the tool call short. */
export function sliceOf(args) {
  const raw = args === null || args === undefined ? undefined : args.wait_ms;
  if (raw === undefined || raw === null) return WAIT_SLICE_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw i18nError('err.badWaitMs');
  return Math.min(Math.max(Math.floor(value), WAIT_SLICE_MIN_MS), WAIT_SLICE_MAX_MS);
}

/**
 * Wait at most `ms` for the review promise.
 *
 * Returns `{done: true, answer}` / `{done: true, error}` when the review
 * settled, and `{time: true}` when the slice ran out first. The review itself
 * stays alive in the panel either way.
 */
export function waitSlice(promise, ms) {
  let timer = null;
  const tick = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ time: true }), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([
    promise.then(
      (answer) => ({ done: true, answer }),
      (error) => ({ done: true, error }),
    ),
    tick,
  ]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

const DESCRIPTION =
  'Ask the user to answer inline in the Web UI and return per-item verdicts plus notes. ' +
  'Use it whenever the user\'s judgement is needed — confirming, choosing, approving, ' +
  'reviewing, rating, commenting — on one or more items; a single item uses the panel too. ' +
  'When options can be combined, set ' +
  'multiSelect: true on that item and list each combinable action plus a "none" option; never ' +
  'put a combination such as "A+B" into a single-choice option. Blank items return filled=false; ' +
  'a blank is never an approval. When degraded=true the one-screen panel was unavailable and the ' +
  'review ran on the one-question-per-page native card: check summary.filled === summary.total ' +
  'before drawing conclusions, and split the batch if it is not. ' +
  'Waiting is sliced: with a live panel one call waits at most ~90 s (wait_ms overrides it) ' +
  'and then returns {pending: true, review_id}; the review stays on the panel and nothing the ' +
  'user already typed is lost. Call batch_review again with {review_id} (no items) until pending ' +
  'is false — the verdicts arrive on that later call. Inside run_code, set the program timeoutMs ' +
  'to >= 900000 or make one batch_review call per program: a 2-minute budget ends the wait early ' +
  '(the review survives and the next call resumes it).';

/** True when `target` sits inside `dir`'s subtree. */
function insideDir(target, dir) {
  const relative = path.relative(dir, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Write the answer payload.
 *
 * `persist` is a model-supplied path, so by default only the process cwd subtree
 * is writable: one tool call must not be able to drop files anywhere on the
 * disk. `allowExternalPersist` (plugin config, default false) is the owner's
 * explicit opt-out; a refused path is reported as `persist_error` and the review
 * itself is still returned.
 */
async function persistResult(filePath, payload, options = {}) {
  // Relative paths are the caller's, so resolve them against the caller's
  // workspace when the host exposes it; the process cwd is the profile directory
  // and silently swallowed reviews written as "docs/records/x.json" into it.
  const baseDir = typeof options.baseDir === 'string' && options.baseDir !== ''
    ? options.baseDir
    : process.cwd();
  const target = path.resolve(baseDir, filePath);
  const allowed = insideDir(target, baseDir) || insideDir(target, process.cwd());
  if (options.allowExternal !== true && !allowed) {
    const error = new Error(
      'persist 路径越界：' + target + ' 不在 agent 工作区（' + baseDir + '）或进程 cwd（' +
        process.cwd() + '）子树内。默认只允许写这两处；确需写到别处，请在配置里设 ' +
        'allowExternalPersist: true。',
    );
    error.code = 'PERSIST_OUTSIDE_CWD';
    throw error;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return target;
}

/**
 * Build the `batch_review` tool definition against a host context.
 *
 * @param ctx host context carrying `userQuestions`
 * @param {{ panel?: object, panelThreshold?: number, maxItems?: number,
 *   allowExternalPersist?: boolean }} [options]
 *   `panel` is the waiting room from `lib/panel.js`; when present and mounted in
 *   the client, reviews with at least `panelThreshold` items use the one-screen
 *   panel instead of the paged native card. This helper defaults to 1 for
 *   `panelThreshold`; `index.js` configures 1 for the plugin itself, so every
 *   review uses the panel unless the user raises the threshold.
 *   `allowExternalPersist` (default false) lifts the cwd-only rule on `persist`.
 */
export function makeBatchReviewTool(ctx, options = {}) {
  const panel = options.panel ?? null;
  // A live object when the plugin wires one, so the Settings tab takes effect
  // without a restart; loose values keep direct-call tests working.
  const config = options.config ?? {
    panelThreshold: options.panelThreshold,
    maxItems: options.maxItems,
    allowExternalPersist: options.allowExternalPersist,
  };
  const numberOf = (key, fallback, min) => {
    const n = Number(config[key]);
    return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
  };

  return {
    name: 'batch_review',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title shown at the top of the review.',
        },
        lang: {
          type: 'string',
          enum: ['en', 'zh'],
          description:
            'Language for option labels, errors and report text. Defaults to the language ' +
            'the mounted panel last reported, then Chinese. Pass it explicitly when there is ' +
            'no panel (a script) and the report language matters.',
        },
        persist: {
          type: 'string',
          description:
            'Optional path. When set, the result is also written there as UTF-8 JSON so the ' +
            'verdicts survive the session. Relative paths resolve against the agent workspace ' +
            '(falling back to the host process cwd when the host exposes no workspace). By ' +
            'default only paths inside the workspace or that cwd subtree are writable; writing ' +
            'elsewhere needs allowExternalPersist: true in the plugin config. The returned ' +
            'persisted field carries the absolute path actually written; a refused or failed ' +
            'write returns persist_error.',
        },
        review_id: {
          type: 'string',
          description:
            'Resume a live review instead of starting one: pass the review_id a previous call ' +
            'returned with pending:true, and omit items. The call waits another slice and returns ' +
            'the final verdicts once the user submits. A review stays resumable until it is ' +
            'submitted, cancelled, or reaches the panel timeout.',
        },
        wait_ms: {
          type: 'number',
          description:
            'Upper bound for this wait slice, in ms (5000-300000; default 90000). Lower it ' +
            'when the host execution budget is shorter than the default slice, for example a ' +
            'run_code call given a 60 s timeout.',
        },
        items: {
          type: 'array',
          description: 'Items to review, in display order. Omit when resuming with review_id.',
          items: {
            type: 'object',
            properties: {
              id: {
                type: ['string', 'number'],
                description: 'Stable id (string or number) used to map the answer back.',
              },
              type: {
                type: 'string',
                enum: ['confirm', 'choice', 'bool', 'text', 'scale'],
                description: 'confirm(通过/不通过/待定) | choice | bool | text | scale',
              },
              multiSelect: {
                type: 'boolean',
                description:
                  'Allow more than one option for this item (choice/confirm/bool/scale). Use it ' +
                  'whenever the options can be combined: list every combinable action as its own ' +
                  'option plus a "none" option (e.g. A, B, 都不做) — never write a combined option ' +
                  'such as "A+B" in a single-choice list. The answer keeps every label in verdict ' +
                  '(joined by 、) and in selected[]. Defaults to false. `multi_select` is accepted ' +
                  'as an alias.',
              },
              multi_select: {
                type: 'boolean',
                description: 'Alias of multiSelect (the host`ask_user_question` spelling).',
              },
              label: { type: 'string', description: 'Item title.' },
              op: { type: 'string', description: 'For confirm items: the step the user performs.' },
              expect: { type: 'string', description: 'For confirm items: the expected result.' },
              boolDesc: { type: 'string', description: 'For bool items: the statement being accepted.' },
              boolLabel: { type: 'string', description: 'For bool items: the yes/no statement.' },
              detail: {
                type: 'string',
                description:
                  'Item explanation. The panel shows it as its own line under the title; the ' +
                  'native card folds it into the title. `expect` (confirm) and `boolDesc` (bool) ' +
                  'win over `detail`.',
              },
              header: { type: 'string', description: 'Short tag shown above the question.' },
              group: {
                type: 'string',
                description:
                  'Optional group label for large batches. Consecutive items with the same group ' +
                  'collapse under one heading in the panel, with 全通过/全待定 batch buttons.',
              },
              options: {
                type: 'array',
                description:
                  'For choice items. Only `choice` renders them: an explicit non-choice `type` ' +
                  '(e.g. `text`) wins and these are ignored. A non-empty options array with no ' +
                  '`type` is inferred as `choice`. Order them by importance with the recommended ' +
                  'option first: the panel numbers them A/B/C by array order, so do not write a ' +
                  'letter prefix — or a combination such as "A+B" — in `t`.',
                items: {
                  type: 'object',
                  properties: {
                    v: { type: 'string', description: 'Stored value, e.g. A.' },
                    t: { type: 'string', description: 'Display text.' },
                    label: { type: 'string', description: 'Alias of t.' },
                    d: {
                      type: 'string',
                      description: 'One-line option note shown under the label.',
                    },
                    exclusive: {
                      type: 'boolean',
                      description:
                        'Mark a mutually exclusive option such as "都不做"/"none" (alias: none). ' +
                        'Selecting it clears every other option, and selecting another option clears ' +
                        'it. A label that reads 都不做/无/none is treated as exclusive automatically.',
                    },
                  },
                },
              },
              min: { type: 'number', description: 'For scale items.' },
              max: { type: 'number', description: 'For scale items.' },
            },
          },
        },
      },
      // Neither field alone is required: a first call needs items, a resumed call
      // only needs review_id, and execute states that contract explicitly.
      required: [],
    },
    output: {
      schema: { type: 'object' },
      render: function render(_args, value) {
        const text = value && typeof value === 'object' && typeof value.report_text === 'string'
          ? value.report_text
          : String(value);
        return [{ type: 'text', text }];
      },
    },
    async execute(args, exec) {
      // Explicit lang wins: a script or a panel-less host has no other source of
      // truth, and the README promises an explicit escape hatch. Then the language
      // the panel last reported, then the default. Each step uses matchLang so an
      // explicit but unsupported tag (lang: 'fr') falls through to the next
      // preference instead of pinning the review to the default language.
      const lang = matchLang(args && typeof args.lang === 'string' ? args.lang : null)
        ?? matchLang(panel && typeof panel.locale === 'string' ? panel.locale : null)
        ?? DEFAULT_LANG;
      // Re-read on every call: the Settings tab may change these mid-session.
      // The fallback mirrors DEFAULTS in config.js (1): every review uses the
      // panel unless the settings file raises the threshold above the item count.
      const panelThreshold = numberOf('panelThreshold', 1, 1);
      const maxItems = numberOf('maxItems', 100, 1);
      const allowExternalPersist = config.allowExternalPersist === true;
      // Relative persist paths belong to the caller, not to the host's profile cwd.
      const agentCwd = typeof exec.agent?.cwd === 'string' && exec.agent.cwd !== ''
        ? exec.agent.cwd
        : (typeof exec.agent?.session?.cwd === 'string' ? exec.agent.session.cwd : '');
      if (!exec.agent) throw localizeError(i18nError('err.needAgent'), lang);

      let sliceMs;
      try {
        sliceMs = sliceOf(args);
      } catch (error) {
        throw localizeError(error, lang);
      }
      const sessionId = typeof exec.agent.session?.id === 'string' ? exec.agent.session.id : null;
      const title = (args && args.title) || '';
      const persistPath = args && typeof args.persist === 'string' ? args.persist.trim() : '';

      // One result builder for both paths (fresh review and resumed review), so a
      // resumed call returns exactly the shape a first call would have returned.
      const finish = async (resultTitle, items, answer, surface, degraded, reviewId) => {
        const rows = buildRows(items, answer, lang);
        const banner = degraded === null ? '' : degradedBanner(lang, degraded, rows.length);
        const result = {
          title: resultTitle,
          cancelled: false,
          pending: false,
          surface,
          surface_reason: degraded,
          degraded: degraded !== null,
          ...(reviewId ? { review_id: reviewId } : {}),
          items: rows,
          summary: { total: rows.length, filled: rows.filter((row) => row.filled).length },
          report_text: buildReport(resultTitle, rows, lang, banner),
        };
        if (persistPath) {
          try {
            result.persisted = await persistResult(persistPath, {
              ...result,
              answered_at: new Date().toISOString(),
            }, { allowExternal: allowExternalPersist, baseDir: agentCwd });
          } catch (error) {
            result.persisted = null;
            result.persist_error = String((error && error.message) || error);
          }
        }
        return result;
      };

      const cancelledResult = (resultTitle, surface, degraded, reviewId, total, code) => ({
        title: resultTitle,
        cancelled: true,
        pending: false,
        surface,
        surface_reason: degraded,
        degraded: degraded !== null,
        ...(reviewId ? { review_id: reviewId } : {}),
        cancel_reason: code,
        items: [],
        summary: { total, filled: 0 },
        report_text: cancelledReport(
          resultTitle,
          tr(lang, code === 'CANCELLED' ? 'cancel.cancelled' : 'cancel.aborted'),
          lang,
        ),
      });

      const pendingResult = (review, waitedMs) => ({
        title: review.title,
        cancelled: false,
        pending: true,
        surface: 'panel',
        surface_reason: null,
        degraded: false,
        review_id: review.id,
        wait_slice_ms: Math.round(waitedMs),
        items: [],
        summary: { total: review.items.length, filled: 0 },
        report_text: pendingReport(
          review.title,
          review.id,
          review.items.length,
          lang,
          Math.round(waitedMs / 1000),
        ),
      });

      // ---- resume a live review (no items) ------------------------------
      const reviewId = args && typeof args.review_id === 'string' ? args.review_id.trim() : '';
      if (reviewId !== '') {
        if (panel === null || typeof panel.peek !== 'function') {
          throw localizeError(i18nError('err.reviewUnknown', { review_id: reviewId }), lang);
        }
        const live = panel.peek(reviewId);
        if (live === null) {
          const finished = typeof panel.recent === 'function' ? panel.recent(reviewId) : null;
          if (finished !== null && finished.answer !== null) {
            return await finish(finished.title, finished.items, finished.answer, 'panel', null, finished.id);
          }
          if (finished !== null && finished.error !== null) {
            const code = finished.error && finished.error.code ? String(finished.error.code) : 'ASK_ABORTED';
            return cancelledResult(finished.title, 'panel', null, finished.id, finished.items.length, code);
          }
          throw localizeError(i18nError('err.reviewUnknown', { review_id: reviewId }), lang);
        }
        if (live.sessionId !== null && sessionId !== null && live.sessionId !== sessionId) {
          throw localizeError(i18nError('err.reviewSession', { review_id: reviewId }), lang);
        }
        const resumed = await waitSlice(live.promise, sliceMs);
        if (resumed.time) return pendingResult(live, sliceMs);
        if (resumed.error) throw resumed.error;
        return await finish(live.title, live.items, resumed.answer, 'panel', null, live.id);
      }

      // ---- start a new review -------------------------------------------
      let items;
      try {
        items = normalizeItems(args && args.items);
      } catch (error) {
        throw localizeError(error, lang);
      }
      if (items.length > maxItems) {
        const error = localizeError(
          i18nError('err.tooManyItems', { count: items.length, max: maxItems }),
          lang,
        );
        error.code = 'TOO_MANY_ITEMS';
        throw error;
      }
      let questions;
      try {
        questions = items.map((item, index) => toQuestion(item, index, lang));
      } catch (error) {
        throw localizeError(error, lang);
      }
      // Two "mounted" states matter here:
      //  - live: a client polled within the presence window -> wait the full timeout;
      //  - warm: a client polled earlier but is idle now (background tab, reloaded
      //    page) -> offer the review with a short pickup window.
      // Only "never polled" means the panel really is absent. The old check treated
      // a warm-but-idle panel as absent and silently moved large reviews onto the
      // paged native card, where they were submitted half-answered.
      const thresholdMet = items.length >= panelThreshold;
      const panelLive = panel !== null && thresholdMet && panel.available() === true;
      const panelWarm = panel !== null && thresholdMet && !panelLive
        && typeof panel.known === 'function' && panel.known() === true;
      const panelUsable = panelLive || panelWarm;
      /** Why a multi-item review used the paged native card (null = not degraded). */
      let degraded = null;

      let answer = null;
      let surface = 'cards';
      let review = null;
      try {
        if (panelUsable) {
          surface = 'panel';
          // The panel also needs the raw group label, which AskUserQuestionItem
          // does not carry; questions stay untouched for the native-card path.
          const panelItems = questions.map((question, index) => {
            const item = items[index] ?? {};
            return {
              ...question,
              // The card path folds the explanation into the title; the panel has
              // its own indented, secondary-coloured detail line, so give it back
              // the original title and the separate detail text.
              question: titleOf(item, question.id, lang),
              detail: detailOf(item),
              group: String((item.group ?? item.header) || '').trim(),
            };
          });
          let started = null;
          try {
            started = panel.begin({
              title,
              items: panelItems,
              signal: exec.signal,
              // The review belongs to the asking session: a panel rendered for
              // another session (or another workspace) must not show it.
              sessionId: exec.agent?.session?.id,
              // A warm-but-idle client gets only a short pickup window; a live one
              // keeps the full panel timeout.
              timeoutMs: panelLive ? undefined : PANEL_PICKUP_MS,
            });
          } catch (panelError) {
            // A second review already owns the panel. The native card is a
            // working surface, so fall back instead of failing the call with BUSY.
            if (panelError && panelError.code === 'BUSY') {
              surface = 'cards';
              degraded = 'panel-busy';
              answer = await ctx.userQuestions.ask({
                questions,
                agent: exec.agent,
                signal: exec.signal,
              });
            } else {
              throw panelError;
            }
          }
          if (started !== null) {
            // Real panels return the review record; a bare {id, promise} stub (older
            // tests, third-party callers) still gets a usable summary.
            review = started.review ?? { id: started.id, title, items: panelItems };
            if (panelLive) {
              // Slice the wait: a host execution budget (run_code defaults to two
              // minutes) must be able to end this call without ending the review.
              const sliced = await waitSlice(started.promise, sliceMs);
              if (sliced.time) return pendingResult(started.review, sliceMs);
              if (sliced.error) throw sliced.error;
              answer = sliced.answer;
            } else {
              try {
                answer = await started.promise;
              } catch (panelError) {
                // The short probe found nobody behind the panel: fall back to the
                // native card, but say so instead of pretending the review is intact.
                if (panelError && panelError.code === 'PANEL_TIMEOUT') {
                  surface = 'cards';
                  degraded = 'panel-unreachable';
                  answer = await ctx.userQuestions.ask({
                    questions,
                    agent: exec.agent,
                    signal: exec.signal,
                  });
                } else {
                  throw panelError;
                }
              }
            }
          }
        } else {
          if (panel !== null && thresholdMet) degraded = 'panel-unmounted';
          answer = await ctx.userQuestions.ask({
            questions,
            agent: exec.agent,
            signal: exec.signal,
          });
        }
      } catch (error) {
        const code = error && error.code ? String(error.code) : String((error && error.message) || error);
        if (code === 'ASK_ABORTED' || code === 'CANCELLED' || code === 'PANEL_TIMEOUT' ||
          (exec.signal && exec.signal.aborted)) {
          return cancelledResult(title, surface, degraded, review ? review.id : null, items.length, code);
        }
        const wrapped = localizeError(i18nError('err.askFailed', { code }), lang);
        wrapped.code = code;
        wrapped.cause = error;
        throw wrapped;
      }

      return await finish(title, items, answer, surface, degraded, review ? review.id : null);
    },
  };
}
