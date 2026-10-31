import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { apply } from '../index.js';
import { makeBatchReviewTool } from '../lib/tool.js';
import { skillProvider, SKILL_NAME } from '../lib/skill.js';

function makeCtx(ask) {
  const registered = { tool: null, provider: null };
  return {
    registered,
    effect(fn) {
      return fn();
    },
    tools: {
      register(tool) {
        registered.tool = tool;
        return () => {};
      },
    },
    skills: {
      registerProvider(factory) {
        registered.provider = factory();
        return () => {};
      },
    },
    userQuestions: { ask },
    logger: { warn() {} },
  };
}

const exec = { agent: {}, signal: new AbortController().signal };

test('apply registers the batch_review tool and the bundled skill provider', () => {
  const ctx = makeCtx(async () => ({ answers: [] }));
  apply(ctx);

  assert.equal(ctx.registered.tool.name, 'batch_review');
  assert.equal(typeof ctx.registered.tool.output.render, 'function');
  assert.deepEqual(ctx.registered.tool.parameters.required, ['items']);
  assert.equal('mode' in ctx.registered.tool.parameters.properties, false);

  assert.equal(ctx.registered.provider.name, 'batch-review');
  assert.equal(ctx.registered.provider.list.length, 0);
});

test('execute folds the host answer into a structured result', async () => {
  const ctx = makeCtx(async (request) => {
    assert.deepEqual(request.questions.map((q) => q.id), ['1', '2']);
    return { answers: [{ id: '1', selected: ['通过'] }, { id: '2', selected: [], custom: '备注' }] };
  });
  apply(ctx);

  const result = await ctx.registered.tool.execute(
    { title: '验收', items: [{ id: 1, type: 'confirm', op: 'a' }, { id: 2, type: 'text', label: 'b' }] },
    exec,
  );

  assert.equal(result.cancelled, false);
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.filled, 2);
  assert.equal(result.items[1].note, '备注');
  assert.match(result.report_text, /【批阅】验收/);
});

test('execute turns an aborted ask into a cancelled result, not an exception', async () => {
  const ctx = makeCtx(async () => {
    const error = new Error('aborted');
    error.code = 'ASK_ABORTED';
    throw error;
  });
  apply(ctx);

  const result = await ctx.registered.tool.execute(
    { title: '验收', items: [{ id: 1, type: 'confirm', op: 'a' }] },
    exec,
  );

  assert.equal(result.cancelled, true);
  assert.deepEqual(result.items, []);
  assert.match(result.report_text, /未获得答复/);
});

test('execute preserves the host error code on other failures', async () => {
  const ctx = makeCtx(async () => {
    const error = new Error('delegated');
    error.code = 'DELEGATED_CALLER';
    throw error;
  });
  apply(ctx);

  await assert.rejects(
    () => ctx.registered.tool.execute({ items: [{ id: 1, type: 'confirm' }] }, exec),
    (error) => {
      assert.equal(error.code, 'DELEGATED_CALLER');
      assert.match(error.message, /DELEGATED_CALLER/);
      return true;
    },
  );
});

test('execute rejects an empty or duplicate item list before asking', async () => {
  let asked = false;
  const ctx = makeCtx(async () => {
    asked = true;
    return { answers: [] };
  });
  apply(ctx);

  await assert.rejects(() => ctx.registered.tool.execute({ items: [] }, exec), /items 不能为空/);
  await assert.rejects(
    () => ctx.registered.tool.execute({ items: [{ id: 1 }, { id: 1 }] }, exec),
    /不能重复/,
  );
  assert.equal(asked, false, 'validation must happen before the user is asked');
});

test('execute persists the result when persist is set', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'batch-review-'));
  const target = path.join(dir, 'nested', 'result.json');
  const ctx = makeCtx(async () => ({ answers: [{ id: '1', selected: ['通过'] }] }));
  apply(ctx);

  const result = await ctx.registered.tool.execute(
    { title: 'persist', persist: target, items: [{ id: 1, type: 'confirm' }] },
    exec,
  );

  assert.equal(result.persisted, target);
  const saved = JSON.parse(await readFile(target, 'utf8'));
  assert.equal(saved.summary.total, 1);
  assert.equal(saved.items[0].verdict, '通过');
  assert.ok(saved.answered_at, 'persisted payload records when it was answered');
});

test('a failed persist never loses the review', async () => {
  const ctx = makeCtx(async () => ({ answers: [{ id: '1', selected: ['通过'] }] }));
  apply(ctx);

  const result = await ctx.registered.tool.execute(
    { persist: tmpdir(), items: [{ id: 1, type: 'confirm' }] },
    exec,
  );

  assert.equal(result.persisted, null);
  assert.ok(result.persist_error, 'write failure is reported');
  assert.equal(result.summary.filled, 1, 'the verdict itself is still returned');
});

test('a large review uses the mounted panel instead of the native card', async () => {
  const panel = {
    available: () => true,
    begin: () => ({ id: 'r1', promise: Promise.resolve({ answers: [{ id: '1', selected: ['通过'] }] }) }),
  };
  const ctx = makeCtx(async () => {
    throw new Error('native card must not be used');
  });
  const tool = makeBatchReviewTool(ctx, { panel, panelThreshold: 5 });
  const items = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, type: 'confirm' }));

  const result = await tool.execute({ title: 'big', items }, exec);
  assert.equal(result.surface, 'panel');
  assert.equal(result.summary.total, 5);
  assert.equal(result.summary.filled, 1);
});

test('a small review still uses the native card even with a mounted panel', async () => {
  const panel = {
    available: () => true,
    begin: () => {
      throw new Error('panel must not be used');
    },
  };
  const ctx = makeCtx(async () => ({ answers: [] }));
  const tool = makeBatchReviewTool(ctx, { panel, panelThreshold: 5 });

  const result = await tool.execute({ items: [{ id: 1, type: 'confirm' }] }, exec);
  assert.equal(result.surface, 'cards');
  assert.equal(result.cancelled, false);
});

test('an unmounted panel falls back to the native card', async () => {
  const panel = {
    available: () => false,
    begin: () => {
      throw new Error('panel must not be used');
    },
  };
  const ctx = makeCtx(async () => ({ answers: [] }));
  const tool = makeBatchReviewTool(ctx, { panel, panelThreshold: 5 });
  const items = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, type: 'confirm' }));

  const result = await tool.execute({ items }, exec);
  assert.equal(result.surface, 'cards');
});

test('a panel cancel becomes a cancelled result, not an exception', async () => {
  const panel = {
    available: () => true,
    begin: () => ({
      id: 'r1',
      promise: Promise.reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' })),
    }),
  };
  const ctx = makeCtx(async () => {
    throw new Error('native card must not be used');
  });
  const tool = makeBatchReviewTool(ctx, { panel, panelThreshold: 5 });
  const items = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, type: 'confirm' }));

  const result = await tool.execute({ items }, exec);
  assert.equal(result.cancelled, true);
  assert.equal(result.surface, 'panel');
  assert.equal(result.cancel_reason, 'CANCELLED');
});

test('the skill provider lists one candidate and returns Markdown without frontmatter', async () => {
  const provider = skillProvider();
  const candidates = await provider.list();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, SKILL_NAME);
  assert.equal(candidates[0].provider, 'batch-review');
  assert.equal(typeof candidates[0].rank, 'number');
  assert.equal(candidates[0].resourceBase.kind, 'directory');

  const skill = await provider.get(candidates[0]);
  assert.equal(skill.name, SKILL_NAME);
  assert.ok(skill.content.includes('# 批阅表格'), 'body must be present');
  assert.equal(skill.content.startsWith('---'), false, 'frontmatter must be stripped');
});
