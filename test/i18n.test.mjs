import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LANG,
  boolOptions,
  cancelReasonText,
  confirmOptions,
  i18nError,
  localizeError,
  messageKeys,
  normalizeLang,
  tr,
} from '../lib/i18n.js';
import { buildReport, toQuestion } from '../lib/tool.js';
import { BatchReviewPanel } from '../lib/panel.js';
import { normalize } from '../lib/config.js';

test('zh and en ship exactly the same message keys', () => {
  // A key that exists in one language and not the other would silently fall back
  // to Chinese (or to the key itself) for an English UI.
  assert.deepEqual(messageKeys('zh'), messageKeys('en'));
  assert.ok(messageKeys('en').length > 30);
});

test('tr fills every placeholder, including repeated ones', () => {
  assert.equal(
    tr('zh', 'report.summaryOpen', { total: 3, filled: 2, open: 1 }),
    '共 3 条 · 已填 2 条 · 未填 1 条',
  );
  assert.equal(
    tr('en', 'report.summaryOpen', { total: 3, filled: 2, open: 1 }),
    '3 items · 2 answered · 1 open',
  );
});

test('tr falls back to the key for an unknown message', () => {
  assert.equal(tr('en', 'no.such.key'), 'no.such.key');
});

test('normalizeLang maps tags and falls back to the default', () => {
  assert.equal(normalizeLang('en-US'), 'en');
  assert.equal(normalizeLang('EN'), 'en');
  assert.equal(normalizeLang('zh-CN'), 'zh');
  assert.equal(normalizeLang('fr'), DEFAULT_LANG);
  assert.equal(normalizeLang(undefined), DEFAULT_LANG);
  assert.equal(normalizeLang(''), DEFAULT_LANG);
});

test('confirm and bool labels follow the language and keep their tone', () => {
  assert.deepEqual(confirmOptions('en').map((option) => option.label), ['Pass', 'Fail', 'Pending']);
  assert.deepEqual(confirmOptions('en').map((option) => option.tone), ['pass', 'fail', 'pending']);
  assert.deepEqual(boolOptions('en').map((option) => option.label), ['Yes', 'No']);
  assert.deepEqual(boolOptions('zh').map((option) => option.tone), ['yes', 'no']);
});

test('toQuestion answers in the requested language', () => {
  const en = toQuestion({ id: 1, type: 'confirm', op: 'Restart' }, 0, 'en');
  assert.equal(en.options[0].label, 'Pass');
  assert.equal(toQuestion({ id: 2, type: 'bool', label: 'Keep' }, 1, 'en').options[0].label, 'Yes');
  // A Chinese card keeps the Chinese labels.
  assert.equal(toQuestion({ id: 3, type: 'confirm', op: '重启' }, 2, 'zh').options[0].label, '通过');
});

test('buildReport has no Chinese left in the English report', () => {
  const rows = [
    { id: '1', title: 'Restart', verdict: 'Pass', selected: ['Pass'], note: '', filled: true },
    { id: '2', title: 'Check logs', verdict: '', selected: [], note: '', filled: false },
  ];
  const en = buildReport('Checklist', rows, 'en');
  assert.match(en, /^\[Batch review\] Checklist/);
  assert.match(en, /2 items · 1 answered · 1 open/);
  assert.match(en, /1\. Restart → Pass/);
  assert.match(en, /2\. Check logs → \(not answered\)/);
  assert.match(en, /Not answered: 2/);
  assert.doesNotMatch(en, /[\u4e00-\u9fff]/, 'the English report must not contain Chinese');

  const zh = buildReport('检查', rows, 'zh');
  assert.match(zh, /^【批阅】检查/);
  assert.match(zh, /共 2 条 · 已填 1 条 · 未填 1 条/);
});

test('cancellation reasons follow the language', () => {
  assert.equal(cancelReasonText('en', 'skipped'), 'the user skipped this review');
  assert.equal(cancelReasonText('zh', 'cancelled'), '用户取消了本次批阅');
});

test('localizeError rebuilds an i18n error in the target language', () => {
  const zh = i18nError('err.itemsEmpty');
  assert.equal(zh.message, 'items 不能为空');
  const en = localizeError(zh, 'en');
  assert.equal(en.message, 'items must not be empty');
  assert.equal(en.cause, zh);
  // A plain error passes through untouched.
  const plain = new Error('boom');
  assert.equal(localizeError(plain, 'en'), plain);
});

test('tr never re-expands a literal placeholder inside a value', () => {
  // User text reaches report_text through these templates, so a value that
  // happens to contain `{total}` must stay literal instead of being substituted.
  assert.equal(
    tr('en', 'report.title', { title: 'check {total} items' }),
    '[Batch review] check {total} items',
  );
  assert.equal(tr('zh', 'report.title', { title: '检查 {filled}' }), '【批阅】检查 {filled}');
  // An unknown template placeholder stays as written rather than being emptied.
  assert.equal(tr('en', 'report.title', {}), '[Batch review] {title}');
});

test('panel.learnLocale records the language reported by the client poll', () => {
  const panel = new BatchReviewPanel({});
  assert.equal(panel.locale, DEFAULT_LANG);
  panel.learnLocale({ url: '/api/batch-review/state?locale=en' });
  assert.equal(panel.locale, 'en');
  assert.equal(panel.fail('err.itemsEmpty').message, 'items must not be empty');
  panel.learnLocale({ url: '/api/batch-review/state?locale=zh-CN' });
  assert.equal(panel.locale, 'zh');
  // A malformed URL, or no locale at all, must not change the recorded language.
  panel.learnLocale({ url: 'not a url' });
  assert.equal(panel.locale, 'zh');
  panel.learnLocale({ url: '/api/batch-review/state' });
  assert.equal(panel.locale, 'zh');
});

test('config validation errors follow the requested language', () => {
  const zh = normalize({ panelThreshold: 0 });
  assert.match(zh.errors[0], /必须是/);
  const en = normalize({ panelThreshold: 0 }, 'en');
  assert.match(en.errors[0], /must be an integer between/);
  assert.doesNotMatch(en.errors[0], /[\u4e00-\u9fff]/);
  const bool = normalize({ allowExternalPersist: 'yes' }, 'en');
  assert.match(bool.errors[0], /must be true or false/);
});
