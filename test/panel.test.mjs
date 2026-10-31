import test from 'node:test';
import assert from 'node:assert/strict';

import { BatchReviewPanel, ROUTE_BASE } from '../lib/panel.js';

function panel() {
  return new BatchReviewPanel({ timeoutMs: 50 });
}

test('a panel is unavailable until a client polls', () => {
  const p = panel();
  assert.equal(p.available(), false);
  p.touch();
  assert.equal(p.available(), true);
  assert.equal(p.available(Date.now() + 60_000), false, 'presence expires');
});

test('state exposes the waiting review and no resolver', () => {
  const p = panel();
  const items = [{ id: '1', question: 'a' }];
  const { id, promise } = p.begin({ title: 'T', items });
  promise.catch(() => {});

  const state = p.state();
  assert.equal(state.pending.id, id);
  assert.equal(state.pending.title, 'T');
  assert.deepEqual(state.pending.items, items);
  assert.equal('resolve' in state.pending, false);
});

test('submit settles the waiting review with the answers', async () => {
  const p = panel();
  const { promise } = p.begin({ title: 'T', items: [] });
  const received = p.submit({
    answers: [
      { id: '1', selected: ['通过'], custom: ' ok ' },
      { id: '2', selected: [] },
    ],
  });
  assert.deepEqual(received, { received: 2 });

  const answer = await promise;
  assert.deepEqual(answer.answers, [
    { id: '1', selected: ['通过'], custom: 'ok' },
    { id: '2', selected: [] },
  ]);
  assert.equal(p.state().pending, null);
});

test('submit rejects a mismatched review id', () => {
  const p = panel();
  const { promise } = p.begin({ title: 'T', items: [] });
  promise.catch(() => {});
  assert.throws(() => p.submit({ id: 'other', answers: [] }), /不匹配/);
  assert.ok(p.state().pending !== null, 'the review is still waiting');
  p.cancel({});
});

test('cancel ends the review with CANCELLED', async () => {
  const p = panel();
  const { promise } = p.begin({ title: 'T', items: [] });
  assert.deepEqual(p.cancel({ reason: 'dismissed' }), { cancelled: true });
  await assert.rejects(promise, (error) => error.code === 'CANCELLED');
  assert.equal(p.state().pending, null);
});

test('a second concurrent review is refused', () => {
  const p = panel();
  const { promise } = p.begin({ title: 'T', items: [] });
  promise.catch(() => {});
  assert.throws(() => p.begin({ title: 'U', items: [] }), (error) => error.code === 'BUSY');
  p.cancel({});
});

test('a review without an answer times out', async () => {
  const p = panel();
  const { promise } = p.begin({ title: 'T', items: [] });
  await assert.rejects(promise, (error) => error.code === 'PANEL_TIMEOUT');
  assert.equal(p.state().pending, null);
});

test('routes expose state/submit/cancel/health', () => {
  const p = panel();
  const routes = p.routes();
  assert.deepEqual(
    routes.map((route) => route.kind + ' ' + route.path),
    [
      'exact ' + ROUTE_BASE + '/state',
      'exact ' + ROUTE_BASE + '/submit',
      'exact ' + ROUTE_BASE + '/cancel',
      'exact ' + ROUTE_BASE + '/health',
    ],
  );
});

test('a route handler refuses a cross-origin POST', async () => {
  const p = panel();
  const submit = p.routes().find((route) => route.path === ROUTE_BASE + '/submit');
  const response = {
    status: 0,
    body: null,
    writeHead(status) { this.status = status; },
    end(body) { this.body = JSON.parse(body); },
  };
  await submit.handler(
    { method: 'POST', headers: { origin: 'https://evil.example', host: '127.0.0.1:9' }, [Symbol.asyncIterator]: async function* () {} },
    response,
  );
  assert.equal(response.status, 403);
  assert.equal(response.body.ok, false);
});
