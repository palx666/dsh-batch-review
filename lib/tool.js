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

const CONFIRM_OPTIONS = [{ label: '通过' }, { label: '不通过' }, { label: '待定' }];
const BOOL_OPTIONS = [{ label: '是' }, { label: '否' }];
const ITEM_TYPES = new Set(['confirm', 'choice', 'bool', 'text', 'scale']);
const HEADER_MAX_CHARS = 24;
/**
 * A scale item turns its [min, max] range into one option per integer. Without
 * a cap, `{ min: 0, max: 100000 }` asked the host to render 100k buttons.
 */
const MAX_SCALE_OPTIONS = 100;

/** Stable string id for an item; falls back to its 1-based position. */
export function idOf(item, index) {
  if (item && item.id !== undefined && item.id !== null) return String(item.id);
  return String(index + 1);
}

/** Human-readable title used both on the card and in the report. */
export function titleOf(item, id) {
  return item.label || item.boolLabel || item.op || '第 ' + id + ' 条';
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
  // `d` is the human-readable option note. `v` is the stored value and only
  // doubles as the note when `d` is absent, so items written against the older
  // contract keep rendering a note instead of silently losing it.
  const note = typeof option.d === 'string' && option.d.trim() !== '' ? option.d.trim() : '';
  const description = note !== '' ? note : (option.v ? String(option.v) : undefined);
  return description ? { label, description } : { label };
}

/**
 * Ids arrive as strings or numbers; anything else stringifies into a value that
 * silently collides (``[object Object]``) or that the answer cannot reference.
 */
function assertUsableId(item, index) {
  const raw = item.id;
  if (raw === undefined || raw === null) return;
  if (typeof raw === 'string') {
    if (raw.trim() === '') {
      throw new Error('items[' + index + '].id 不能是空字符串：空 id 的回答会被静默丢弃');
    }
    return;
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      throw new Error('items[' + index + '].id 必须是有限数字，收到 ' + String(raw));
    }
    return;
  }
  throw new Error(
    'items[' + index + '].id 必须是字符串或有限数字，收到 ' + Object.prototype.toString.call(raw),
  );
}

/** One error for both validation layers (normalizeItems and toQuestion). */
function scaleTooLarge(index, count) {
  const error = new Error(
    'items[' + index + '] 的 scale 区间会生成 ' + count + ' 个选项，上限 ' + MAX_SCALE_OPTIONS +
      ' 个。请缩小 min/max，或改用 choice 只列几个档位。',
  );
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
export function toQuestion(item, index) {
  const id = idOf(item, index);
  const type = typeOf(item);
  const title = titleOf(item, id);
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
    question.options = CONFIRM_OPTIONS.map((option) => ({ ...option }));
  } else if (type === 'bool') {
    question.options = BOOL_OPTIONS.map((option) => ({ ...option }));
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
  if (!Array.isArray(items) || items.length === 0) throw new Error('items 不能为空');
  const seen = new Set();
  return items.map((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('items[' + index + '] 必须是对象');
    }
    assertUsableId(item, index);
    const id = idOf(item, index);
    if (seen.has(id)) throw new Error('items 的 id 不能重复：' + id);
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
export function buildRows(items, answer) {
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
    const verdict = selected.join('、');
    return {
      id,
      title: titleOf(item, id),
      type: typeOf(item),
      verdict,
      selected,
      note,
      filled: verdict !== '' || note !== '',
    };
  });
}

/** Model-facing report. `filled: false` rows are called out, never implied as passed. */
export function buildReport(title, rows) {
  const filledRows = rows.filter((row) => row.filled);
  const openRows = rows.filter((row) => !row.filled);
  const lines = rows.map((row) => {
    if (!row.filled) return row.id + '. ' + row.title + ' → （未填）';
    let line = row.id + '. ' + row.title + ' → ' + (row.verdict || '（仅备注）');
    if (row.note) line += ' — ' + row.note;
    return line;
  });

  const out = [];
  out.push('【批阅】' + (title || ''));
  out.push(
    '共 ' + rows.length + ' 条 · 已填 ' + filledRows.length + ' 条' +
      (openRows.length ? ' · 未填 ' + openRows.length + ' 条' : ''),
  );
  out.push('');
  out.push(lines.join('\n'));
  if (openRows.length) {
    out.push('');
    out.push(
      '未填：' + openRows.map((row) => row.id).join('、') +
        '（没填不代表通过，需要单独追问）',
    );
  }
  return out.join('\n');
}

/** Report used when the ask never produced an answer (abort or session end). */
export function cancelledReport(title, reason) {
  return [
    '【批阅】' + (title || ''),
    '',
    '未获得答复（' + reason + '）：本条批阅没有任何结论。',
    '需要重新发起 batch_review；不要把「没答复」当成通过。',
  ].join('\n');
}

const DESCRIPTION =
  'Ask the user to answer inline in the Web UI and return per-item verdicts plus notes. ' +
  'Use it whenever the user\'s judgement is needed — confirming, choosing, approving, ' +
  'reviewing, rating, commenting — on 2+ items. Blank items return filled=false; a blank ' +
  'is never an approval.';

/** True when `target` sits inside the process cwd subtree. */
function insideCwd(target) {
  const cwd = process.cwd();
  const relative = path.relative(cwd, target);
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
  const target = path.resolve(filePath);
  if (options.allowExternal !== true && !insideCwd(target)) {
    const error = new Error(
      'persist 路径越界：' + target + ' 不在进程 cwd（' + process.cwd() + '）子树内。' +
        '默认只允许写 cwd 子树；确需写到别处，请在配置里设 allowExternalPersist: true。',
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
 *   panel instead of the paged native card. This helper defaults to 5 for
 *   `panelThreshold`; `index.js` configures 2 for the plugin itself.
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
        persist: {
          type: 'string',
          description:
            'Optional path. When set, the result is also written there as UTF-8 JSON so the ' +
            'verdicts survive the session. Relative paths resolve against the host process cwd. ' +
            'By default only paths inside that cwd subtree are writable; writing elsewhere needs ' +
            'allowExternalPersist: true in the plugin config. The returned persisted field carries ' +
            'the absolute path actually written; a refused or failed write returns persist_error.',
        },
        items: {
          type: 'array',
          description: 'Items to review, in display order.',
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
                  'Allow more than one option for this item (choice/confirm/bool/scale). The answer ' +
                  'keeps every label in verdict (joined by 、) and in selected[]. Defaults to false. ' +
                  '`multi_select` is accepted as an alias.',
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
                  '`type` is inferred as `choice`.',
                items: {
                  type: 'object',
                  properties: {
                    v: { type: 'string', description: 'Stored value, e.g. A.' },
                    t: { type: 'string', description: 'Display text.' },
                    label: { type: 'string', description: 'Alias of t.' },
                    d: {
                      type: 'string',
                      description:
                        'One-line option note shown under the label (falls back to v when absent).',
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
      required: ['items'],
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
      // Re-read on every call: the Settings tab may change these mid-session.
      const panelThreshold = numberOf('panelThreshold', 5, 1);
      const maxItems = numberOf('maxItems', 100, 1);
      const allowExternalPersist = config.allowExternalPersist === true;
      const items = normalizeItems(args && args.items);
      if (items.length > maxItems) {
        const error = new Error(
          '条目过多：本次 ' + items.length + ' 条，上限 ' + maxItems + ' 条。' +
            '批阅是逐条人工作答的，超过上限建议做分组和拆分',
        );
        error.code = 'TOO_MANY_ITEMS';
        throw error;
      }
      if (!exec.agent) throw new Error('batch_review 需要一个活的 agent 才能向用户提问');

      const questions = items.map(toQuestion);
      const title = (args && args.title) || '';
      const usePanel = panel !== null && items.length >= panelThreshold && panel.available();

      let answer;
      let surface = 'cards';
      try {
        if (usePanel) {
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
              question: titleOf(item, question.id),
              detail: detailOf(item),
              group: String((item.group ?? item.header) || '').trim(),
            };
          });
          let started = null;
          try {
            started = panel.begin({ title, items: panelItems, signal: exec.signal });
          } catch (panelError) {
            // A second review already owns the panel. The native card is a
            // working surface, so fall back instead of failing the call with BUSY.
            if (panelError && panelError.code === 'BUSY') {
              surface = 'cards';
              answer = await ctx.userQuestions.ask({
                questions,
                agent: exec.agent,
                signal: exec.signal,
              });
            } else {
              throw panelError;
            }
          }
          if (started !== null) answer = await started.promise;
        } else {
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
          return {
            title,
            cancelled: true,
            surface,
            cancel_reason: code,
            items: [],
            summary: { total: items.length, filled: 0 },
            report_text: cancelledReport(title, code === 'CANCELLED' ? '用户取消' : '会话中断或超时'),
          };
        }
        const wrapped = new Error('向用户提问失败：' + code);
        wrapped.code = code;
        wrapped.cause = error;
        throw wrapped;
      }

      const rows = buildRows(items, answer);
      const result = {
        title,
        cancelled: false,
        surface,
        items: rows,
        summary: {
          total: rows.length,
          filled: rows.filter((row) => row.filled).length,
        },
        report_text: buildReport(title, rows),
      };

      const persistPath = args && typeof args.persist === 'string' ? args.persist.trim() : '';
      if (persistPath) {
        try {
          result.persisted = await persistResult(persistPath, {
            ...result,
            answered_at: new Date().toISOString(),
          }, { allowExternal: allowExternalPersist });
        } catch (error) {
          result.persisted = null;
          result.persist_error = String((error && error.message) || error);
        }
      }

      return result;
    },
  };
}
