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
