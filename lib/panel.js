/**
 * The panel channel: a host-side waiting room for `batch_review` calls that are
 * too large for the native paged card.
 *
 * The client half (`lib/client.js`) mounts one panel in `conversation.input.dock`
 * and polls `GET /api/batch-review/state`. While a review waits, the panel shows
 * every item on one screen; submitting it `POST`s back here and settles the tool
 * call. The native card stays the fallback: if no client has polled recently the
 * tool never waits for a panel that cannot answer.
 *
 * One review is active at a time — a review is a human interaction, and a second
 * concurrent one would overwrite the first panel. A second `begin()` is refused
 * so the caller can fall back instead of silently waiting.
 *
 * Submitting is authorised by a per-process token that the page reads from the
 * poll payload. `/state` is readable from the page itself but carries no CORS
 * header, so a cross-origin page cannot read the token; combined with the
 * Origin check, a foreign page can neither read the review nor forge an answer.
 * A local process can still read `/state` — the same process could read the
 * review files on disk, so that is out of scope here.
 */

import { randomUUID } from 'node:crypto';

/** Route prefix; the client appends this to the document base. */
export const ROUTE_BASE = '/api/batch-review';

// Large batches are a supported case: a 100k-item review carries a ~17 MB
// payload and a ~4 MB answer. Keep the cap well above that while still
// refusing unbounded uploads.
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
/** Header carrying the submit token handed to the page by `GET /state`. */
const TOKEN_HEADER = 'x-batch-review-token';
/**
 * How long a client poll keeps the panel considered mounted.
 *
 * This has to outlive the client's own retry maths or a single slow request
 * would make a live panel look unmounted: the client polls every 1.5 s while a
 * review waits (2.5 s while idle) with an 8 s request timeout, so the worst case
 * between two successful polls is 8 s + 2.5 s. 15 s leaves room above that.
 */
const PRESENCE_TTL_MS = 15000;

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

async function readJsonBody(request, maxBodyBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error('body too large');
      error.code = 'TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') return null;
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** A browser sends Origin on a state-changing POST; a local script does not. */
function crossOrigin(request) {
  const origin = request?.headers?.origin;
  if (typeof origin !== 'string' || origin.trim() === '') return false;
  const host = request?.headers?.host;
  if (typeof host !== 'string' || host.trim() === '') return true;
  try {
    return new URL(origin).host !== host.trim();
  } catch {
    return true;
  }
}

let sequence = 0;

export class BatchReviewPanel {
  /**
   * @param {{ logger?: object, timeoutMs?: number, maxBodyBytes?: number,
   *   virtualThreshold?: number, unrefTimer?: boolean, token?: string }} [options]
   *   `unrefTimer` (default true) keeps the wait timer from holding the process
   *   open; tests run their own event loop and pass false so the timer can fire.
   */
  constructor(options = {}) {
    this.logger = options.logger;
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.maxBodyBytes = Number.isFinite(options.maxBodyBytes) && options.maxBodyBytes > 0
      ? options.maxBodyBytes
      : MAX_BODY_BYTES;
    this.virtualThreshold = Number.isInteger(options.virtualThreshold) && options.virtualThreshold > 0
      ? options.virtualThreshold
      : 500;
    this.unrefTimer = options.unrefTimer !== false;
    /** Settings tab bridge; null when the host wired no settings file. */
    this.settings = options.settings ?? null;
    /** Submit token. Random per panel; only the page that polls sees it. */
    this.token = typeof options.token === 'string' && options.token !== '' ? options.token : randomUUID();
    this.current = null;
    this.lastPoll = 0;
    this.polled = false;
  }

  /** A client polled within the presence window: the panel can be reached. */
  available(now = Date.now()) {
    return this.polled && now - this.lastPoll <= PRESENCE_TTL_MS;
  }

  touch() {
    this.polled = true;
    this.lastPoll = Date.now();
  }

  /** What the panel renders on every poll. Never leaks the resolver. */
  state() {
    const pending = this.current;
    return {
      available: this.available(),
      virtual_threshold: this.virtualThreshold,
      token: this.token,
      pending: pending === null
        ? null
        : {
            id: pending.id,
            title: pending.title,
            items: pending.items,
            created_at: new Date(pending.createdAt).toISOString(),
          },
    };
  }

  /**
   * Ask through the panel and wait for the submit.
   *
   * @param {{ title: string, items: object[], signal?: AbortSignal }} request
   *   `signal` is the tool call's signal: aborting the session must not leave a
   *   review waiting for the full timeout while every later review is BUSY.
   * @returns {Promise<object>} the same envelope `ctx.userQuestions.ask()` returns
   */
  begin({ title, items, signal }) {
    if (this.current !== null) {
      const error = new Error('另一次批阅正在进行，请等它结束');
      error.code = 'BUSY';
      throw error;
    }
    if (signal !== undefined && signal !== null && signal.aborted === true) {
      const error = new Error('批阅已被中止');
      error.code = 'CANCELLED';
      throw error;
    }
    sequence += 1;
    const id = 'br-' + Date.now().toString(36) + '-' + sequence.toString(36);

    let timer = null;
    let onAbort = null;
    let settled = false;
    let resolveOuter;
    let rejectOuter;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (signal !== undefined && signal !== null && onAbort !== null) {
        signal.removeEventListener('abort', onAbort);
      }
      if (this.current !== null && this.current.id === id) this.current = null;
      fn(value);
    };

    const promise = new Promise((resolve, reject) => {
      resolveOuter = resolve;
      rejectOuter = reject;
      timer = setTimeout(() => {
        const error = new Error('面板批阅超时，未获得答复');
        error.code = 'PANEL_TIMEOUT';
        settle(reject, error);
      }, this.timeoutMs);
      if (this.unrefTimer && typeof timer.unref === 'function') timer.unref();

      if (signal !== undefined && signal !== null) {
        onAbort = () => {
          const error = new Error('批阅已被中止');
          error.code = 'CANCELLED';
          settle(reject, error);
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.current = {
        id,
        title: title || '',
        items,
        createdAt: Date.now(),
        resolve: (answers) => settle(resolveOuter, { answers }),
        reject: (error) => settle(rejectOuter, error),
      };
    });

    return { id, promise };
  }

  /** Validate and settle one submitted answer batch. */
  submit(payload) {
    const pending = this.current;
    if (pending === null) {
      const error = new Error('没有等待中的批阅（可能已提交或已取消）');
      error.code = 'NOT_PENDING';
      throw error;
    }
    if (payload === null || typeof payload !== 'object') {
      const error = new Error('提交内容必须是对象');
      error.code = 'BAD_PAYLOAD';
      throw error;
    }
    if (typeof payload.id === 'string' && payload.id !== '' && payload.id !== pending.id) {
      const error = new Error('批阅 id 不匹配');
      error.code = 'BAD_ID';
      throw error;
    }
    const raw = payload.answers;
    if (!Array.isArray(raw)) {
      const error = new Error('answers 必须是数组');
      error.code = 'BAD_PAYLOAD';
      throw error;
    }
    const answers = [];
    for (const entry of raw) {
      if (entry === null || typeof entry !== 'object') continue;
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      if (id === '') continue;
      answers.push({
        id,
        selected: Array.isArray(entry.selected) ? entry.selected.filter((v) => typeof v === 'string') : [],
        ...typeof entry.custom === 'string' && entry.custom.trim() !== '' ? { custom: entry.custom.trim() } : {},
      });
    }
    pending.resolve(answers);
    return { received: answers.length };
  }

  cancel(payload) {
    const pending = this.current;
    if (pending === null) return { cancelled: false };
    const error = new Error(
      payload !== null && typeof payload === 'object' && payload.reason === 'skipped'
        ? '用户跳过了本次批阅'
        : '用户取消了本次批阅',
    );
    error.code = 'CANCELLED';
    pending.reject(error);
    return { cancelled: true };
  }

  /** POSTs must carry the token this panel handed to the polling page. */
  authorized(request) {
    const headers = request?.headers ?? {};
    const raw = headers[TOKEN_HEADER] ?? headers.authorization;
    if (typeof raw !== 'string') return false;
    const value = (raw.startsWith('Bearer ') ? raw.slice(7) : raw).trim();
    return value !== '' && value === this.token;
  }

  /** Live tunables for the Settings tab (a host without the bridge answers 404). */
  configState() {
    if (this.settings === null) {
      const error = new Error('本插件没有启用可编辑配置');
      error.status = 404;
      throw error;
    }
    return {
      path: this.settings.path,
      defaults: { ...this.settings.defaults },
      limits: { ...this.settings.limits },
      config: { ...this.settings.config },
    };
  }

  /** Validate, persist and apply a partial config change. */
  saveConfig(patch) {
    if (this.settings === null) {
      const error = new Error('本插件没有启用可编辑配置');
      error.status = 404;
      throw error;
    }
    const config = this.settings.save(patch ?? {});
    return { path: this.settings.path, config: { ...config } };
  }

  /** Route definitions for `ctx.webServer.register()`. */
  routes() {
    const exact = (method, path, handler) => ({
      kind: 'exact',
      path,
      handler: async (request, response) => {
        if (crossOrigin(request)) {
          sendJson(response, 403, { ok: false, error: 'cross-origin request refused' });
          return;
        }
        const actual = String(request.method ?? 'GET').toUpperCase();
        if (actual !== method && !(method === 'GET' && actual === 'HEAD')) {
          sendJson(response, 405, { ok: false, error: 'use ' + method });
          return;
        }
        if (method === 'POST' && !this.authorized(request)) {
          sendJson(response, 403, { ok: false, error: 'missing or stale review token' });
          return;
        }
        let body = null;
        if (method === 'POST') {
          try {
            body = await readJsonBody(request, this.maxBodyBytes);
          } catch (error) {
            sendJson(response, error?.code === 'TOO_LARGE' ? 413 : 400, {
              ok: false,
              error: String(error?.message ?? error),
            });
            return;
          }
        }
        try {
          sendJson(response, 200, { ok: true, ...(await handler(request, body)) });
        } catch (error) {
          const status = Number.isInteger(error?.status) ? error.status : 400;
          sendJson(response, status, { ok: false, error: String(error?.message ?? error) });
        }
      },
    });

    return [
      exact('GET', ROUTE_BASE + '/state', async () => {
        this.touch();
        return this.state();
      }),
      exact('POST', ROUTE_BASE + '/submit', async (_request, body) => this.submit(body)),
      exact('POST', ROUTE_BASE + '/cancel', async (_request, body) => this.cancel(body)),
      exact('GET', ROUTE_BASE + '/health', async () => ({
        available: this.available(),
        polled: this.polled,
        pending: this.current === null ? null : this.current.id,
        timeout_ms: this.timeoutMs,
      })),
      // Settings → left-nav section: read the live tunables, write them to the
      // JSON file under the DSH home. One path, two methods on purpose — the
      // web server keys routes by path, so a second registration for the same
      // path would shadow the first and POST would land on the GET handler.
      {
        kind: 'exact',
        path: ROUTE_BASE + '/config',
        handler: async (request, response) => {
          if (crossOrigin(request)) {
            sendJson(response, 403, { ok: false, error: 'cross-origin request refused' });
            return;
          }
          const actual = String(request.method ?? 'GET').toUpperCase();
          if (actual === 'GET' || actual === 'HEAD') {
            try {
              sendJson(response, 200, { ok: true, ...this.configState() });
            } catch (error) {
              sendJson(response, Number.isInteger(error?.status) ? error.status : 400, {
                ok: false,
                error: String(error?.message ?? error),
              });
            }
            return;
          }
          if (actual !== 'POST') {
            sendJson(response, 405, { ok: false, error: 'use GET or POST' });
            return;
          }
          let body = null;
          try {
            body = await readJsonBody(request, this.maxBodyBytes);
          } catch (error) {
            sendJson(response, error?.code === 'TOO_LARGE' ? 413 : 400, {
              ok: false,
              error: String(error?.message ?? error),
            });
            return;
          }
          try {
            sendJson(response, 200, { ok: true, ...this.saveConfig(body) });
          } catch (error) {
            sendJson(response, Number.isInteger(error?.status) ? error.status : 400, {
              ok: false,
              error: String(error?.message ?? error),
            });
          }
        },
      },
    ];
  }
}
