import test from 'node:test';
import assert from 'node:assert/strict';

import { BatchReviewPanel, ROUTE_BASE } from '../lib/panel.js';

// `unrefTimer: false` keeps the wait timer holding the event loop open, so these
// tests no longer depend on something else keeping the process alive.
function panel(options = {}) {
  return new BatchReviewPanel({ timeoutMs: 50, unrefTimer: false, ...options });
}

function fakeResponse() {
  return {
    status: 0,
    body: null,
    writeHead(status) { this.status = status; },
    end(body) { this.body = JSON.parse(body); },
  };
}

function fakePost(headers, payload = '{"answers":[]}') {
  return {
    method: 'POST',
    headers,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload, 'utf8');
    },
  };
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

test('a pending review is shown only to the session that asked for it', () => {
  const p = panel();
  const { id, promise } = p.begin({ title: 'T', items: [], sessionId: 'sess-a' });
  promise.catch(() => {});

  assert.equal(p.state('sess-a').pending.id, id);
  assert.equal(p.state('sess-a').pending.session_id, 'sess-a');
  // Another session — or another workspace, which is another session — sees nothing.
  assert.equal(p.state('sess-b').pending, null);
  // A poller that reports no session (an older client) still sees it.
  assert.equal(p.state(null).pending.id, id);
  p.cancel({});
});

test('a review started without a session id stays visible everywhere', () => {
  const p = panel();
  const { id, promise } = p.begin({ title: 'T', items: [] });
  promise.catch(() => {});
  assert.equal(p.state('sess-a').pending.id, id);
  assert.equal(p.state('sess-b').pending.id, id);
  p.cancel({});
});

test('a review without an answer times out', async () => {
  const p = panel();
  const { promise } = p.begin({ title: 'T', items: [] });
  await assert.rejects(promise, (error) => error.code === 'PANEL_TIMEOUT');
  assert.equal(p.state().pending, null);
});

test('routes expose state/submit/cancel/health/config', () => {
  const p = panel();
  const routes = p.routes();
  assert.deepEqual(
    routes.map((route) => route.kind + ' ' + route.path),
    [
      'exact ' + ROUTE_BASE + '/state',
      'exact ' + ROUTE_BASE + '/submit',
      'exact ' + ROUTE_BASE + '/cancel',
      'exact ' + ROUTE_BASE + '/health',
      'exact ' + ROUTE_BASE + '/config',
    ],
  );
});

test('a route handler refuses a cross-origin POST', async () => {
  const p = panel();
  const submit = p.routes().find((route) => route.path === ROUTE_BASE + '/submit');
  const response = fakeResponse();
  await submit.handler(
    { method: 'POST', headers: { origin: 'https://evil.example', host: '127.0.0.1:9' }, [Symbol.asyncIterator]: async function* () {} },
    response,
  );
  assert.equal(response.status, 403);
  assert.equal(response.body.ok, false);
});

test('a POST without the token is refused', async () => {
  const p = panel();
  const submit = p.routes().find((route) => route.path === ROUTE_BASE + '/submit');
  const response = fakeResponse();
  await submit.handler(fakePost({ host: '127.0.0.1:9' }), response);
  assert.equal(response.status, 403);
  assert.match(response.body.error, /token/);
});

test('a POST with a stale token is refused', async () => {
  const p = panel({ token: 'current' });
  const submit = p.routes().find((route) => route.path === ROUTE_BASE + '/submit');
  const response = fakeResponse();
  await submit.handler(fakePost({ host: '127.0.0.1:9', 'x-batch-review-token': 'old' }), response);
  assert.equal(response.status, 403);
});

test('a same-origin POST with the token and no Origin is accepted', async () => {
  const p = panel({ token: 'current' });
  const { promise } = p.begin({ title: 'T', items: [] });
  const submit = p.routes().find((route) => route.path === ROUTE_BASE + '/submit');
  const response = fakeResponse();
  await submit.handler(
    fakePost({ host: '127.0.0.1:9', 'x-batch-review-token': 'current' }, '{"answers":[]}'),
    response,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await promise, { answers: [] });
});

test('the state payload carries the submit token', () => {
  const p = panel({ token: 'abc' });
  assert.equal(p.state().token, 'abc');
  assert.equal(typeof panel().state().token, 'string');
  assert.ok(panel().state().token.length > 0, 'a random token is generated per panel');
});

test('aborting the call settles the waiting review as CANCELLED', async () => {
  const p = panel();
  const controller = new AbortController();
  const { promise } = p.begin({ title: 'T', items: [], signal: controller.signal });
  controller.abort();
  await assert.rejects(promise, (error) => error.code === 'CANCELLED');
  assert.equal(p.state().pending, null, 'an aborted review does not stay BUSY');
});

test('an already-aborted signal is refused before the review is queued', () => {
  const p = panel();
  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () => p.begin({ title: 'T', items: [], signal: controller.signal }),
    (error) => error.code === 'CANCELLED',
  );
  assert.equal(p.state().pending, null);
});

test('state carries the configured virtual threshold', () => {
  const p = new BatchReviewPanel({ timeoutMs: 50, unrefTimer: false, virtualThreshold: 42 });
  assert.equal(p.state().virtual_threshold, 42);
  assert.equal(new BatchReviewPanel({}).state().virtual_threshold, 500, 'default');
});

test('the configured body cap is used instead of the module default', async () => {
  const p = new BatchReviewPanel({ timeoutMs: 50, unrefTimer: false, maxBodyBytes: 16, token: 'tk' });
  const route = p.routes().find((entry) => entry.path === ROUTE_BASE + '/submit');
  const chunks = [Buffer.from('{"id":"x","answers":[]}', 'utf8')];
  const request = {
    method: 'POST',
    headers: { 'x-batch-review-token': 'tk' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
  const response = {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; },
    end(body) { this.body = body; },
  };
  await route.handler(request, response);
  assert.equal(response.status, 413, 'a 22-byte body must exceed a 16-byte cap');
});

test('config route answers 404 when the host wired no settings bridge', async () => {
  const p = panel();
  const route = p.routes().find((entry) => entry.path === ROUTE_BASE + '/config');
  const getResponse = fakeResponse();
  await route.handler({ method: 'GET', headers: {} }, getResponse);
  assert.equal(getResponse.status, 404);

  const postResponse = fakeResponse();
  await route.handler(fakePost({}, '{}'), postResponse);
  assert.equal(postResponse.status, 404);
});

test('the config route reads with GET and writes with POST on one path', async () => {
  const config = { panelThreshold: 3, maxItems: 50, allowExternalPersist: false };
  const saved = [];
  const p = panel({
    settings: {
      path: 'C:/tmp/batch-review.json',
      defaults: { panelThreshold: 2 },
      limits: { panelThreshold: { min: 1, max: 100 } },
      config,
      save(patch) {
        saved.push(patch);
        return { ...config, ...patch };
      },
    },
  });

  const route = p.routes().find((entry) => entry.path === ROUTE_BASE + '/config');
  const getResponse = fakeResponse();
  await route.handler({ method: 'GET', headers: {} }, getResponse);
  assert.equal(getResponse.status, 200);
  assert.equal(getResponse.body.path, 'C:/tmp/batch-review.json');
  assert.equal(getResponse.body.config.panelThreshold, 3);
  assert.deepEqual(getResponse.body.defaults, { panelThreshold: 2 });

  const postResponse = fakeResponse();
  await route.handler(fakePost({}, JSON.stringify({ panelThreshold: 5 })), postResponse);
  assert.equal(postResponse.status, 200);
  assert.deepEqual(saved, [{ panelThreshold: 5 }]);
  assert.equal(postResponse.body.config.panelThreshold, 5);
});

test('the config route rejects a method it does not serve', async () => {
  const p = panel({ settings: { path: 'x', defaults: {}, limits: {}, config: {}, save: () => ({}) } });
  const route = p.routes().find((entry) => entry.path === ROUTE_BASE + '/config');
  const response = fakeResponse();
  await route.handler({ method: 'DELETE', headers: {} }, response);
  assert.equal(response.status, 405);
});

test('cancel rejects a mismatched review id', () => {
  const p = panel();
  const { promise } = p.begin({ title: 'T', items: [] });
  promise.catch(() => {});
  assert.throws(() => p.cancel({ id: 'other' }), /不匹配/);
  assert.ok(p.state().pending !== null, 'the review is still waiting');
  p.cancel({});
});

test('a rebound Host is refused even when the Origin matches it', async () => {
  const p = panel({ token: 'current' });
  const submit = p.routes().find((route) => route.path === ROUTE_BASE + '/submit');
  const response = fakeResponse();
  await submit.handler(fakePost({
    host: 'evil.example:7860',
    origin: 'http://evil.example:7860',
    'x-batch-review-token': 'current',
  }, '{"answers":[]}'), response);
  assert.equal(response.status, 403, 'a non-loopback Host means the request is not the panel');
  assert.match(response.body.error, /cross-origin/);
});

test('the config route refuses a rebound Host too', async () => {
  const p = panel({
    settings: { path: 'x.json', defaults: {}, limits: {}, config: {}, save: () => ({}) },
  });
  const route = p.routes().find((r) => r.path === ROUTE_BASE + '/config');
  const response = fakeResponse();
  await route.handler({
    method: 'POST',
    headers: { host: 'evil.example:7860', origin: 'http://evil.example:7860', 'content-type': 'application/json' },
    [Symbol.asyncIterator]: async function* () { yield Buffer.from('{"maxItems":20}', 'utf8'); },
  }, response);
  assert.equal(response.status, 403);
});
