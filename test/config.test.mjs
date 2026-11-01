import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULTS,
  LIMITS,
  configPath,
  normalize,
  readFileConfig,
  resolveConfig,
  writeFileConfig,
} from '../lib/config.js';

test('normalize keeps valid numbers and reports each bad value', () => {
  assert.deepEqual(normalize({ panelThreshold: 3, maxItems: '7' }).values, { panelThreshold: 3, maxItems: 7 });
  const bad = normalize({ panelThreshold: 0, maxItems: 'x', allowExternalPersist: 'yes' });
  assert.deepEqual(bad.values, {});
  assert.equal(bad.errors.length, 3);
});

test('injectRoutingRule is a boolean knob with a true default', () => {
  assert.equal(DEFAULTS.injectRoutingRule, true);
  assert.deepEqual(normalize({ injectRoutingRule: false }).values, { injectRoutingRule: false });
  assert.deepEqual(normalize({ injectRoutingRule: 'no' }).values, {});
  assert.equal(normalize({ injectRoutingRule: 'no' }).errors.length, 1);
  // null drops the stored override and hands the key back to the cordis layer.
  assert.deepEqual(normalize({ injectRoutingRule: null }).removals, ['injectRoutingRule']);
});

test('normalize ignores unknown keys, arrays and null', () => {
  assert.deepEqual(normalize(null).values, {});
  assert.deepEqual(normalize([1, 2]).values, {});
  assert.deepEqual(normalize({ nope: 1 }).values, {});
});

test('configPath prefers DSH_HOME and falls back to the default home', () => {
  assert.equal(configPath({ DSH_HOME: 'D:/harness-home' }), join('D:/harness-home', 'dsh-batch-review.config.json'));
  assert.ok(configPath({}).endsWith('dsh-batch-review.config.json'));
});

test('the settings file round-trips and merges', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-batch-review-config-'));
  const file = join(dir, 'config.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.deepEqual(readFileConfig(file), {}, 'a missing file is empty, not an error');
  writeFileSync(file, '{not json', 'utf8');
  assert.deepEqual(readFileConfig(file), {}, 'a corrupt file is empty, not an error');

  writeFileConfig({ panelThreshold: 9 }, file);
  writeFileConfig({ maxItems: 20 }, file);
  assert.deepEqual(readFileConfig(file), { panelThreshold: 9, maxItems: 20 });
});

test('resolveConfig layers defaults < cordis < file', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-batch-review-config-'));
  const file = join(dir, 'config.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const base = resolveConfig({ panelThreshold: 4 }, file);
  assert.equal(base.panelThreshold, 4);
  assert.equal(base.maxItems, DEFAULTS.maxItems);

  writeFileConfig({ panelThreshold: 9 }, file);
  assert.equal(resolveConfig({ panelThreshold: 4 }, file).panelThreshold, 9, 'the file wins over cordis config');
});

test('every default sits inside its limits', () => {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    // Boolean knobs have no numeric range; only numeric defaults are bounded.
    if (!(key in LIMITS)) continue;
    const { min, max } = LIMITS[key];
    assert.ok(value >= min && value <= max, key + ' default is inside its limits');
  }
});

test('a null value deletes the stored override', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-batch-review-config-'));
  const file = join(dir, 'config.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileConfig({ panelThreshold: 9 }, file);
  writeFileConfig({ panelThreshold: null }, file);
  assert.deepEqual(readFileConfig(file), {});
  assert.equal(resolveConfig({ panelThreshold: 4 }, file).panelThreshold, 4, 'cordis wins again after the delete');
});

test('normalize reports removals separately from values', () => {
  const { values, errors, removals } = normalize({ panelThreshold: null, maxItems: 20 });
  assert.deepEqual(values, { maxItems: 20 });
  assert.deepEqual(removals, ['panelThreshold']);
  assert.equal(errors.length, 0);
});

test('writeFileConfig creates the parent directory', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-batch-review-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'nested', 'deeper', 'config.json');
  writeFileConfig({ maxItems: 7 }, file);
  assert.deepEqual(readFileConfig(file), { maxItems: 7 });
});
