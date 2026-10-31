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

/** Stable string id for an item; falls back to its 1-based position. */
export function idOf(item, index) {
  if (item && item.id !== undefined && item.id !== null) return String(item.id);
  return String(index + 1);
}

/** Human-readable title used both on the card and in the report. */
export function titleOf(item, id) {
  return item.label || item.op || '第 ' + id + ' 条';
}

/** Top strip of the card. Kept short: a long id must not crowd it out. */
function headerOf(item, id) {
  const raw = typeof item.header === 'string' && item.header.trim() ? item.header.trim() : '#' + id;
  return raw.length > HEADER_MAX_CHARS ? raw.slice(0, HEADER_MAX_CHARS - 1) + '…' : raw;
}

function choiceOf(option) {
  const label = String(option.t || option.label || option.v || '');
  const description = option.v ? String(option.v) : undefined;
  return description ? { label, description } : { label };
}

/**
 * Map one item onto the host's `AskUserQuestionItem`.
 *
 * `options` is omitted for `text` items so the card offers only the free-text
 * field; `detail` carries the expected result / boolean statement under the title.
 */
export function toQuestion(item, index) {
  const id = idOf(item, index);
  const type = ITEM_TYPES.has(item.type) ? item.type : 'confirm';
  const question = {
    id,
    question: titleOf(item, id),
    header: headerOf(item, id),
    multiSelect: item.multiSelect === true,
  };

  const detail = item.expect || item.boolDesc || item.detail;
  if (typeof detail === 'string' && detail !== '') question.detail = detail;

  if (type === 'confirm') {
    question.options = CONFIRM_OPTIONS.map((option) => ({ ...option }));
  } else if (type === 'bool') {
    question.options = BOOL_OPTIONS.map((option) => ({ ...option }));
  } else if (type === 'scale') {
    const min = Number.isInteger(item.min) ? item.min : 1;
    const max = Number.isInteger(item.max) ? item.max : 5;
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    question.options = [];
    for (let n = low; n <= high; n += 1) question.options.push({ label: String(n) });
  } else if (type === 'choice') {
    question.options = (Array.isArray(item.options) ? item.options : []).map(choiceOf);
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
    const id = idOf(item, index);
    if (seen.has(id)) throw new Error('items 的 id 不能重复：' + id);
    seen.add(id);
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
      type: ITEM_TYPES.has(item.type) ? item.type : 'confirm',
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

/** Where a persisted result is written when the caller passes `persist`. */
async function persistResult(filePath, payload) {
  const target = path.resolve(filePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return target;
}

/**
 * Build the `batch_review` tool definition against a host context.
 *
 * @param ctx host context carrying `userQuestions`
 * @param {{ panel?: object, panelThreshold?: number }} [options]
 *   `panel` is the waiting room from `lib/panel.js`; when present and mounted in
 *   the client, reviews with at least `panelThreshold` items (default 5) use the
 *   one-screen panel instead of the paged native card.
 */
export function makeBatchReviewTool(ctx, options = {}) {
  const panel = options.panel ?? null;
  const panelThreshold = Number.isInteger(options.panelThreshold) ? options.panelThreshold : 5;

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
            'verdicts survive the session. Relative paths resolve against the host process cwd; ' +
            'the returned persisted field carries the absolute path actually written.',
        },
        items: {
          type: 'array',
          description: 'Items to review, in display order.',
          items: {
            type: 'object',
            properties: {
              id: { description: 'Stable id (string or number) used to map the answer back.' },
              type: {
                type: 'string',
                enum: ['confirm', 'choice', 'bool', 'text', 'scale'],
                description: 'confirm(通过/不通过/待定) | choice | bool | text | scale',
              },
              multiSelect: {
                type: 'boolean',
                description:
                  'Allow more than one option for this item (choice/confirm/bool/scale). The answer ' +
                  'keeps every label in verdict (joined by 、) and in selected[]. Defaults to false.',
              },
              label: { type: 'string', description: 'Item title.' },
              op: { type: 'string', description: 'For confirm items: the step the user performs.' },
              expect: { type: 'string', description: 'For confirm items: the expected result.' },
              boolDesc: { type: 'string', description: 'For bool items: the statement being accepted.' },
              boolLabel: { type: 'string', description: 'For bool items: the yes/no statement.' },
              header: { type: 'string', description: 'Short tag shown above the question.' },
              group: {
                type: 'string',
                description:
                  'Optional group label for large batches. Consecutive items with the same group ' +
                  'collapse under one heading in the panel, with 全通过/全待定 batch buttons.',
              },
              options: {
                type: 'array',
                description: 'For choice items.',
                items: {
                  type: 'object',
                  properties: {
                    v: { type: 'string', description: 'Stored value, e.g. A.' },
                    t: { type: 'string', description: 'Display text.' },
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
      const items = normalizeItems(args && args.items);
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
          const panelItems = questions.map((question, index) => ({
            ...question,
            group: String((items[index] && (items[index].group ?? items[index].header)) || '').trim(),
          }));
          const started = panel.begin({ title, items: panelItems });
          answer = await started.promise;
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
          });
        } catch (error) {
          result.persisted = null;
          result.persist_error = String((error && error.message) || error);
        }
      }

      return result;
    },
  };
}
