import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The client bundle registers itself through `window.__ModuleLoader__.load`.
 * There is no DOM in node, so the test captures the definition, mocks the React
 * module table and the slot registry, and checks the contract the host relies on:
 * one factory, one dock registration, and no work at import time.
 */

let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      captured = definition;
    },
  },
};

const fakeDocument = {
  head: { appendChild() {} },
  getElementById() { return null; },
  createElement() {
    return { id: '', dataset: {}, textContent: '', remove() {} };
  },
};
globalThis.document = fakeDocument;

await import('../lib/client.js?client-test=1');

const fakeReact = {
  createElement() { return null; },
  useState(initial) { return [initial, () => {}]; },
  useEffect() {},
};

function loadModule() {
  assert.ok(captured !== null, 'the bundle must call window.__ModuleLoader__.load at import time');
  assert.equal(captured.id, 'dsh-batch-review');
  return captured.factory((name) => {
    if (name === 'react') return fakeReact;
    throw new Error('unexpected require(' + name + ')');
  });
}

test('the client bundle registers the dock panel and the settings section', () => {
  const registrations = [];
  const effects = [];
  const injected = [];
  const module = loadModule();
  assert.deepEqual(module.inject, ['slots']);

  module.apply({
    effect(fn) {
      effects.push(fn());
      return () => {};
    },
    slots: {
      inject(name, factory) {
        injected.push(name);
        if (name === 'conversation.input.dock' || name === 'settings.section') factory();
        return () => {};
      },
      register(definition, component) {
        registrations.push({ definition, component });
        return () => {};
      },
    },
  });

  assert.equal(effects.length, 1, 'styles are installed through ctx.effect');
  assert.deepEqual(injected, ['conversation.input.dock', 'settings.section']);
  assert.equal(registrations.length, 2);
  const dock = registrations.find((entry) => entry.definition.name === 'conversation.input.dock');
  const section = registrations.find((entry) => entry.definition.name === 'settings.section');
  assert.equal(dock.definition.id, 'batch-review-panel');
  assert.equal(typeof dock.component, 'function');
  assert.equal(section.definition.id, 'batch-review');
  assert.equal(typeof section.component, 'function');
});

test('a composition without the dock slot does not throw', () => {
  const module = loadModule();
  assert.doesNotThrow(() => {
    module.apply({
      effect(fn) { return fn(); },
      slots: {
        inject() { throw new Error('slot missing'); },
        register() { throw new Error('unreachable'); },
      },
    });
  });
});

/**
 * The settings page's patch builder is the one piece of client logic a wrong edit
 * silently breaks: posting the whole draft baked the resolved defaults + cordis
 * values into the settings file and froze the cordis layer for good (the P1 this
 * suite is meant to keep fixed). It is a pure function, so the three cases are
 * asserted directly instead of through a rendered component.
 */

function buildPatchOf() {
  const module = loadModule();
  assert.equal(typeof module.__test?.buildPatch, 'function',
    'the client module must expose buildPatch for the tests');
  return module.__test.buildPatch;
}

test('buildPatch sends only the keys the page changed', () => {
  const buildPatch = buildPatchOf();
  const baseline = { maxItems: 100, panelThreshold: 2, virtualThreshold: 500 };
  assert.deepEqual(buildPatch({ ...baseline, maxItems: 50 }, baseline), { maxItems: 50 });
  assert.deepEqual(buildPatch({ ...baseline, maxItems: 50, panelThreshold: 9 }, baseline),
    { maxItems: 50, panelThreshold: 9 });
});

test('buildPatch sends null for a cleared key so the override is dropped', () => {
  const buildPatch = buildPatchOf();
  const baseline = { maxItems: 100, panelThreshold: 2 };
  assert.deepEqual(buildPatch({ ...baseline, maxItems: null }, baseline), { maxItems: null });
  // A key that never had an override has nothing to drop: sending null would be
  // a write the server does not need.
  assert.deepEqual(buildPatch({ maxItems: null }, { panelThreshold: 2 }), {});
});

test('buildPatch sends nothing when the draft is untouched', () => {
  const buildPatch = buildPatchOf();
  const baseline = { maxItems: 100, panelThreshold: 2, allowExternalPersist: false };
  assert.deepEqual(buildPatch({ ...baseline }, baseline), {});
});

test('buildPatch never leaks untouched keys, which is the P1 regression', () => {
  const buildPatch = buildPatchOf();
  const baseline = { maxItems: 100, panelThreshold: 2, virtualThreshold: 500 };
  const fullDraft = { ...baseline, panelTimeoutMs: 900000 };
  // Only the requested key goes out; the resolved values of the other three stay
  // in memory and keep applying from the cordis layer.
  assert.deepEqual(buildPatch(fullDraft, baseline), { panelTimeoutMs: 900000 });
});
