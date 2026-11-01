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
 */

/** Route prefix; the client appends this to the document base. */
export const ROUTE_BASE = '/api/batch-review';

// Large batches are a supported case: a 100k-item review carries a ~17 MB
// payload and a ~4 MB answer. Keep the cap well above that while still
// refusing unbounded uploads.
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
/** How long a client poll keeps the panel considered mounted. */
const PRESENCE_TTL_MS = 6000;

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
  /** @param {{ logger?: object, timeoutMs?: number, maxBodyBytes?: number, virtualThreshold?: number }} [options] */
  constructor(options = {}) {
    this.logger = options.logger;
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.maxBodyBytes = Number.isFinite(options.maxBodyBytes) && options.maxBodyBytes > 0
      ? options.maxBodyBytes
      : MAX_BODY_BYTES;
    this.virtualThreshold = Number.isInteger(options.virtualThreshold) && options.virtualThreshold > 0
      ? options.virtualThreshold
      : 500;
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
   * @param {{ title: string, items: object[] }} request
   * @returns {Promise<object>} the same envelope `ctx.userQuestions.ask()` returns
   */
  begin({ title, items }) {
    if (this.current !== null) {
      const error = new Error('另一次批阅正在进行，请等它结束');
      error.code = 'BUSY';
      throw error;
    }
    sequence += 1;
    const id = 'br-' + Date.now().toString(36) + '-' + sequence.toString(36);

    let timer = null;
    const promise = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        if (this.current !== null && this.current.id === id) this.current = null;
        const error = new Error('面板批阅超时，未获得答复');
        error.code = 'PANEL_TIMEOUT';
        reject(error);
      }, this.timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      this.current = {
        id,
        title: title || '',
        items,
        createdAt: Date.now(),
        resolve: (answers) => {
          clearTimeout(timer);
          this.current = null;
          resolve({ answers });
        },
        reject: (error) => {
          clearTimeout(timer);
          this.current = null;
          reject(error);
        },
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
    ];
  }
}
