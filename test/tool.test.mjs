import test from 'node:test';
import assert from 'node:assert/strict';

import {
  idOf,
  titleOf,
  toQuestion,
  normalizeItems,
  buildRows,
  buildReport,
  cancelledReport,
} from '../lib/tool.js';

test('idOf keeps explicit ids and falls back to the 1-based position', () => {
  assert.equal(idOf({ id: 7 }, 0), '7');
  assert.equal(idOf({ id: 'abc' }, 1), 'abc');
  assert.equal(idOf({}, 2), '3');
  assert.equal(idOf({ id: 0 }, 0), '0');
});

test('titleOf prefers label, then op, then a numbered fallback', () => {
  assert.equal(titleOf({ label: 'L', op: 'O' }, '1'), 'L');
  assert.equal(titleOf({ op: 'O' }, '1'), 'O');
  assert.equal(titleOf({}, '1'), '第 1 条');
});

test('toQuestion maps confirm items onto the host schema', () => {
  const question = toQuestion({ id: 1, type: 'confirm', op: '重启', expect: '不白屏' }, 0);
  assert.deepEqual(question, {
    id: '1',
    question: '重启',
    header: '#1',
    multiSelect: false,
    detail: '不白屏',
    options: [{ label: '通过' }, { label: '不通过' }, { label: '待定' }],
  });
});

test('toQuestion carries multiSelect through to the host schema', () => {
  assert.equal(toQuestion({ id: 1, type: 'choice', multiSelect: true, options: [{ t: 'A' }] }, 0).multiSelect, true);
  assert.equal(toQuestion({ id: 2, type: 'confirm' }, 1).multiSelect, false);
});

test('toQuestion maps bool, scale, choice and text items', () => {
  assert.deepEqual(toQuestion({ type: 'bool', label: '常驻', boolDesc: '接受' }, 0).options,
    [{ label: '是' }, { label: '否' }]);

  const scale = toQuestion({ type: 'scale', label: '评分', min: 2, max: 4 }, 0);
  assert.deepEqual(scale.options, [{ label: '2' }, { label: '3' }, { label: '4' }]);

  const choice = toQuestion({
    type: 'choice',
    label: '接入方式',
    options: [{ v: 'A', t: '直连' }, { v: 'B', t: '转发' }],
  }, 0);
  assert.deepEqual(choice.options, [
    { label: '直连', description: 'A' },
    { label: '转发', description: 'B' },
  ]);

  const text = toQuestion({ type: 'text', label: '描述现象' }, 0);
  assert.equal('options' in text, false);
});

test('toQuestion falls back to confirm for unknown types and truncates long headers', () => {
  assert.ok(Array.isArray(toQuestion({ type: 'nope', label: 'x' }, 0).options));
  const long = toQuestion({ label: 'x', header: 'a'.repeat(80) }, 0).header;
  assert.ok(long.length <= 24, 'header must be truncated');
  assert.ok(long.endsWith('…'));
});

test('normalizeItems rejects empty, non-object and duplicate ids', () => {
  assert.throws(() => normalizeItems([]), /items 不能为空/);
  assert.throws(() => normalizeItems(undefined), /items 不能为空/);
  assert.throws(() => normalizeItems([1]), /必须是对象/);
  assert.throws(() => normalizeItems([{ id: 1 }, { id: '1' }]), /不能重复/);
});

test('buildRows folds answers and marks blanks as unfilled', () => {
  const items = [
    { id: 1, type: 'confirm', op: 'a' },
    { id: 2, type: 'choice', label: 'b', options: [{ v: 'A', t: 'A' }] },
    { id: 3, type: 'text', label: 'c' },
    { id: 4, type: 'bool', label: 'd' },
  ];
  const rows = buildRows(items, {
    answers: [
      { id: '1', selected: ['通过'] },
      { id: '2', selected: ['A'], custom: ' 选它 ' },
      { id: '3', selected: [], custom: '只写了备注' },
    ],
  });

  assert.equal(rows[0].filled, true);
  assert.equal(rows[0].verdict, '通过');
  assert.equal(rows[1].verdict, 'A');
  assert.equal(rows[1].note, '选它');
  assert.equal(rows[2].verdict, '');
  assert.equal(rows[2].note, '只写了备注');
  assert.equal(rows[2].filled, true);
  assert.equal(rows[3].filled, false);
});

test('buildRows keeps every multi-select label in verdict and selected', () => {
  const rows = buildRows([{ id: 1, type: 'choice', multiSelect: true, label: 'm', options: [{ t: 'A' }] }], {
    answers: [{ id: '1', selected: ['A', 'B'] }],
  });
  assert.equal(rows[0].verdict, 'A、B');
  assert.deepEqual(rows[0].selected, ['A', 'B']);
  assert.equal(rows[0].filled, true);
});

test('buildRows tolerates a missing answer payload', () => {
  const rows = buildRows([{ id: 1, type: 'confirm' }], undefined);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].filled, false);
});

test('buildReport counts filled rows and calls out the blanks', () => {
  const rows = [
    { id: '1', title: 'a', verdict: '通过', note: '', filled: true },
    { id: '2', title: 'b', verdict: '', note: '', filled: false },
    { id: '3', title: 'c', verdict: '', note: '备注', filled: true },
  ];
  const report = buildReport('验收', rows);
  assert.match(report, /【批阅】验收/);
  assert.match(report, /共 3 条 · 已填 2 条 · 未填 1 条/);
  assert.match(report, /未填：2（没填不代表通过，需要单独追问）/);
  assert.match(report, /3\. c → （仅备注） — 备注/);
});

test('cancelledReport states that no verdict exists', () => {
  const report = cancelledReport('验收', '会话中断或已取消');
  assert.match(report, /未获得答复/);
  assert.match(report, /不要把「没答复」当成通过/);
});
