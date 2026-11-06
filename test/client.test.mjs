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

  // styles + the locale dictionary registration effect (the latter is a no-op
  // when the fake context has no locale service).
  assert.equal(effects.length, 2, 'styles and dictionaries are installed through ctx.effect');
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

/**
 * The dictionary registration used to be the part of `apply` a fake context made
 * a no-op (no locale service), so `effects.length === 2` asserted the shell and
 * not the work. These two cases drive the real service through `ctx.get`, which
 * is the entry the host actually provides.
 */

function makeLocaleService() {
  const calls = [];
  return {
    calls,
    register(ns, locale, dict) {
      calls.push({ kind: 'register', ns, locale, dict });
      return () => { calls.push({ kind: 'unregister', locale }); };
    },
    getSnapshot() { return { active: 'en' }; },
  };
}

function makeClientCtx(get) {
  const effects = [];
  return {
    effects,
    ctx: {
      effect(fn) {
        const dispose = fn();
        effects.push(dispose);
        return () => {};
      },
      get,
      slots: {
        inject() { return () => {}; },
        register() { return () => {}; },
      },
    },
  };
}

const REGISTERED = [['dsh-batch-review', 'zh'], ['dsh-batch-review', 'en']];

test('apply registers both dictionaries with the per-locale signature and disposes them', () => {
  const module = loadModule();
  const service = makeLocaleService();
  const { effects, ctx } = makeClientCtx(() => service);
  module.apply(ctx);

  const registered = service.calls.filter((call) => call.kind === 'register');
  assert.deepEqual(registered.map((call) => [call.ns, call.locale]), REGISTERED);
  for (const call of registered) {
    assert.equal(typeof call.dict, 'object', 'each locale ships a dictionary object');
    assert.ok(Object.keys(call.dict).length > 0, 'the dictionary is not empty');
  }

  // The disposers the effect collected must reach both registered locales.
  effects[1]();
  assert.deepEqual(
    service.calls.filter((call) => call.kind === 'unregister').map((call) => call.locale),
    ['zh', 'en'],
  );
});

test('dictionaries are registered when the locale service appears after apply', () => {
  const module = loadModule();
  const service = makeLocaleService();
  const ref = { current: null };
  const { ctx } = makeClientCtx(() => ref.current);
  module.apply(ctx);

  assert.equal(service.calls.length, 0, 'a missing service must not register anything');

  // The service appears late; the next resolve (a render calls `activeLang`) registers.
  ref.current = service;
  assert.equal(module.__test.activeLang(), 'en');
  assert.deepEqual(
    service.calls.filter((call) => call.kind === 'register').map((call) => [call.ns, call.locale]),
    REGISTERED,
  );

  // A later resolve reuses the cached service and must not register a second time.
  module.__test.activeLang();
  assert.equal(service.calls.filter((call) => call.kind === 'register').length, 2);
});

test('activeLang prefers <html lang> so a panel mounted before the locale service follows the UI language', () => {
  const module = loadModule();
  const service = makeLocaleService();
  const { ctx } = makeClientCtx(() => service);
  module.apply(ctx);

  // The document is the host's own signal; it wins over the snapshot so a panel
  // that mounted before the locale service still shows the active language.
  // `activeLang` returns the raw tag; callers map it through `pickLang`.
  globalThis.document.documentElement = { lang: 'zh-CN' };
  try {
    assert.equal(module.__test.activeLang(), 'zh-CN');
    globalThis.document.documentElement = { lang: 'en-US' };
    assert.equal(module.__test.activeLang(), 'en-US');
  } finally {
    delete globalThis.document.documentElement;
  }

  // Without the attribute the snapshot still decides (the fake service says en).
  assert.equal(module.__test.activeLang(), 'en');
});

test('fixed verdict tones render in the active UI language regardless of the labels the review shipped with', () => {
  const module = loadModule();

  globalThis.document.documentElement = { lang: 'en-US' };
  try {
    // The tool ships the labels in the language the review started with, so a
    // review started before the panel reported a language keeps Chinese ones.
    assert.equal(module.__test.verdictText('pass', '通过'), 'Pass');
    assert.equal(module.__test.verdictText('fail', '不通过'), 'Fail');
    assert.equal(module.__test.verdictText('pending', '待定'), 'Pending');
    assert.equal(module.__test.verdictText('yes', '是'), 'Yes');
    assert.equal(module.__test.verdictText('no', '否'), 'No');
    // Caller-supplied choices keep their own text.
    assert.equal(module.__test.verdictText('choice', '方案 A'), '方案 A');

    globalThis.document.documentElement = { lang: 'zh-CN' };
    assert.equal(module.__test.verdictText('pass', '通过'), '通过');
  } finally {
    delete globalThis.document.documentElement;
  }
});
