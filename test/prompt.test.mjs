import test from 'node:test';
import assert from 'node:assert/strict';

import { registerPrompt, PROMPT_SECTION, PROMPT_TEXT } from '../lib/prompt.js';

test('registerPrompt registers one systemPrompt section', () => {
  const sections = [];
  let injectedDeps = null;
  const ctx = {
    logger: { warn() {} },
    inject(deps, callback) {
      injectedDeps = deps;
      return callback({
        systemPrompt: {
          section(definition) {
            sections.push(definition);
            return () => {};
          },
        },
      });
    },
  };

  const dispose = registerPrompt(ctx);

  assert.deepEqual(injectedDeps, ['systemPrompt']);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, PROMPT_SECTION);
  assert.equal(sections[0].text, PROMPT_TEXT);
  assert.equal(typeof sections[0].order, 'number');
  assert.equal(typeof dispose, 'function');
  assert.doesNotThrow(() => dispose());
});

test('registerPrompt tolerates a composition without systemPrompt', () => {
  const ctx = {
    logger: { warn() {} },
    inject() {
      throw new Error('service unavailable');
    },
  };
  assert.doesNotThrow(() => registerPrompt(ctx));
});

test('the routing text stays short and names both tools', () => {
  assert.ok(PROMPT_TEXT.length < 400, 'prompt sections are paid on every request');
  assert.match(PROMPT_TEXT, /batch_review/);
  assert.match(PROMPT_TEXT, /ask_user_question/);
  assert.match(PROMPT_TEXT, /not an approval|never assume/i);
});
