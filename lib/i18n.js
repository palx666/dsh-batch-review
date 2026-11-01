/**
 * dsh-batch-review — host-side message catalogue.
 *
 * The browser half owns the panel/settings copy through the host's `ctx.locale`
 * dictionaries. The host half has no locale service of its own, so the mounted
 * panel records the language the client reports on every `/state` poll and the
 * tool reads it back here: a review started from an English UI answers with
 * English option labels, errors and report text.
 *
 * All messages are kept in one table so adding a language is a data change, not
 * a code change. `{name}` placeholders are filled by `tr`.
 *
 * @module dsh-batch-review/i18n
 */

/** Language used when nothing has been reported yet (and the fallback table). */
export const DEFAULT_LANG = 'zh';

const ZH = {
  // Tool / validation errors (shown to the agent, surfaced to the user).
  'err.itemsEmpty': 'items 不能为空',
  'err.itemNotObject': 'items[{index}] 必须是对象',
  'err.duplicateId': 'items 的 id 不能重复：{id}',
  'err.idType': 'items[{index}].id 必须是有限数字，收到 {value}',
  'err.idEmpty': 'items[{index}].id 不能是空字符串：空 id 的回答会被静默丢弃',
  'err.idKind': 'items[{index}].id 必须是字符串或有限数字，收到 {kind}',
  'err.tooManyItems': '条目过多：本次 {count} 条，上限 {max} 条。批阅是逐条人工作答的，超过上限建议做分组和拆分',
  'err.scaleTooLarge': 'items[{index}] 的评分选项 {count} 个，超过上限 {max} 个',
  'err.needAgent': 'batch_review 需要一个活的 agent 才能向用户提问',
  'err.askFailed': '向用户提问失败：{code}',
  'err.panelBusy': '另一次批阅正在进行，请等它结束',
  'err.panelAborted': '批阅已被中止',
  'err.panelTimeout': '面板批阅超时，未获得答复',
  'err.noPendingReview': '没有等待中的批阅（可能已提交或已取消）',
  'err.submitNotObject': '提交内容必须是对象',
  'err.reviewIdMismatch': '批阅 id 不匹配',
  'err.answersNotArray': 'answers 必须是数组',
  'err.noEditableConfig': '本插件没有启用可编辑配置',
  'err.configInt': '{key} 必须是 {min}–{max} 之间的整数',
  'err.configBool': 'allowExternalPersist 必须是 true / false',

  // Fixed verdict labels for confirm / bool items.
  'option.pass': '通过',
  'option.fail': '不通过',
  'option.pending': '待定',
  'option.yes': '是',
  'option.no': '否',

  // Fallbacks and separators.
  'title.fallback': '第 {id} 条',
  'join.multi': '、',

  // Result report (report_text) and cancellation reasons.
  'report.title': '【批阅】{title}',
  'report.summary': '共 {total} 条 · 已填 {filled} 条',
  'report.summaryOpen': '共 {total} 条 · 已填 {filled} 条 · 未填 {open} 条',
  'report.unfilled': '（未填）',
  'report.noteOnly': '（仅备注）',
  'report.openList': '未填：{ids}（没填不代表通过，需要单独追问）',
  'report.cancelled': '未获得答复（{reason}）：本条批阅没有任何结论。',
  'report.cancelledRetry': '需要重新发起 batch_review；不要把「没答复」当成通过。',
  'cancel.skipped': '用户跳过了本次批阅',
  'cancel.cancelled': '用户取消了本次批阅',
  'cancel.aborted': '会话中断或超时',
};

const EN = {
  'err.itemsEmpty': 'items must not be empty',
  'err.itemNotObject': 'items[{index}] must be an object',
  'err.duplicateId': 'item ids must be unique; duplicate id: {id}',
  'err.idType': 'items[{index}].id must be a finite number, got {value}',
  'err.idEmpty': 'items[{index}].id must not be an empty string: an empty id would silently drop the answer',
  'err.idKind': 'items[{index}].id must be a string or a finite number, got {kind}',
  'err.tooManyItems': 'too many items: {count} (limit {max}). A review is answered by hand one item at a time; split it into groups',
  'err.scaleTooLarge': 'items[{index}] would render {count} scale options; the limit is {max}',
  'err.needAgent': 'batch_review needs a live agent to ask the user',
  'err.askFailed': 'asking the user failed: {code}',
  'err.panelBusy': 'another review is already in progress; wait for it to finish',
  'err.panelAborted': 'the review was aborted',
  'err.panelTimeout': 'the panel review timed out without an answer',
  'err.noPendingReview': 'no review is waiting (it may have been submitted or cancelled)',
  'err.submitNotObject': 'the submitted payload must be an object',
  'err.reviewIdMismatch': 'review id mismatch',
  'err.answersNotArray': 'answers must be an array',
  'err.noEditableConfig': 'this plugin has no editable settings',
  'err.configInt': '{key} must be an integer between {min} and {max}',
  'err.configBool': 'allowExternalPersist must be true or false',

  'option.pass': 'Pass',
  'option.fail': 'Fail',
  'option.pending': 'Pending',
  'option.yes': 'Yes',
  'option.no': 'No',

  // Fallbacks and separators.
  'title.fallback': 'Item {id}',
  'join.multi': ', ',

  'report.title': '[Batch review] {title}',
  'report.summary': '{total} items · {filled} answered',
  'report.summaryOpen': '{total} items · {filled} answered · {open} open',
  'report.unfilled': '(not answered)',
  'report.noteOnly': '(note only)',
  'report.openList': 'Not answered: {ids} (a blank is never a pass; ask again)',
  'report.cancelled': 'No answer was obtained ({reason}): this review produced no verdicts.',
  'report.cancelledRetry': 'Start batch_review again; never treat a missing answer as a pass.',
  'cancel.skipped': 'the user skipped this review',
  'cancel.cancelled': 'the user cancelled this review',
  'cancel.aborted': 'the session ended or timed out',
};

const CATALOG = { zh: ZH, en: EN };

/**
 * Map a BCP 47-style tag onto a shipped language. Unknown tags fall back to the
 * default rather than throwing: a review must never fail because of a locale.
 */
export function normalizeLang(value) {
  const tag = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (tag === '') return DEFAULT_LANG;
  if (tag.startsWith('en')) return 'en';
  if (tag.startsWith('zh')) return 'zh';
  return DEFAULT_LANG;
}

/** Translate one key, filling `{name}` placeholders from `vars`. */
export function tr(lang, key, vars = {}) {
  const table = CATALOG[normalizeLang(lang)];
  const template = table[key] ?? ZH[key] ?? key;
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.split('{' + name + '}').join(String(value)),
    template,
  );
}

/** Every message key a language ships (used by the tests to keep zh/en in sync). */
export function messageKeys(lang) {
  return Object.keys(CATALOG[normalizeLang(lang)]).sort();
}

/**
 * Build an error that carries a message key instead of a fixed string; the tool
 * turns it into the active language at throw time (`localizeError`). The message
 * is pre-filled in the default language so a direct caller (a test, a helper
 * used outside `execute`) still reads something human.
 */
export function i18nError(key, vars = {}) {
  const error = new Error(tr(DEFAULT_LANG, key, vars));
  error.i18nKey = key;
  error.i18nVars = vars;
  return error;
}

/** Rebuild an `i18nError` in `lang`, preserving `code`, `status` and the cause. */
export function localizeError(error, lang) {
  if (!error || typeof error.i18nKey !== 'string') return error;
  const next = new Error(tr(lang, error.i18nKey, error.i18nVars ?? {}));
  next.code = error.code;
  next.status = error.status;
  next.cause = error;
  return next;
}

/** Fixed verdict buttons for a `confirm` item, in `lang`, each with its tone. */
export function confirmOptions(lang) {
  return [
    { label: tr(lang, 'option.pass'), tone: 'pass' },
    { label: tr(lang, 'option.fail'), tone: 'fail' },
    { label: tr(lang, 'option.pending'), tone: 'pending' },
  ];
}

/** Fixed verdict buttons for a `bool` item, in `lang`, each with its tone. */
export function boolOptions(lang) {
  return [
    { label: tr(lang, 'option.yes'), tone: 'yes' },
    { label: tr(lang, 'option.no'), tone: 'no' },
  ];
}

/** Human label for a cancelled review (`surface: cancelled`). */
export function cancelReasonText(lang, reason) {
  return reason === 'skipped' ? tr(lang, 'cancel.skipped') : tr(lang, 'cancel.cancelled');
}
