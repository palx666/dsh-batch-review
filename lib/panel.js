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
 * header, so a cross-origin page cannot read the token.
 *
 * Every route first checks the Host header against the loopback names the panel
 * can legitimately be reached by. The Origin check alone is not enough: under
 * DNS rebinding a remote page resolves its own name to 127.0.0.1, so its Origin
 * host equals the Host header and that comparison passes. A non-loopback Host
 * therefore means "this request did not come from the panel", whatever Origin
 * says. A local process can still read `/state` — the same process could read
 * the review files on disk, so that is out of scope here.
 */

import { randomUUID } from 'node:crypto';

import { DEFAULT_LANG, cancelReasonText, normalizeLang, tr } from './i18n.js';

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
    'X-Content-Type-Options': 'nosniff',
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

/** Loopback names the panel can be served from; a rebound page sends its own. */
function hostAllowed(request) {
  const raw = request?.headers?.host;
  // No Host header: an HTTP/1.0 client or an in-process test harness. A browser
  // always sends one, and DNS rebinding necessarily sends the attacker's name.
  if (typeof raw !== 'string' || raw.trim() === '') return true;
  let hostname;
  try {
    hostname = new URL('http://' + raw.trim()).hostname;
  } catch {
    return false;
  }
  const bare = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (hostname === 'localhost' || bare === 'localhost') return true;
  if (bare === '127.0.0.1' || bare === '::1') return true;
  // A host bound to another loopback address (or an explicit test server) still
  // counts: compare against the socket's own local address.
  const local = request?.socket?.localAddress;
  if (typeof local === 'string' && (local === bare || local === hostname)) return true;
  return false;
}

/** True when the request did not come from the panel page itself. */
function foreignRequest(request) {
  if (!hostAllowed(request)) return true;
  return crossOrigin(request);
}

/** A label that reads as "none of these" is mutually exclusive in a multi-select. */
function isExclusiveLabel(label) {
  const normalized = String(label).replace(/\s+/g, '').toLowerCase();
  return normalized === '都不做' || normalized === '都不要' || normalized === '全都不做' ||
    normalized === 'none' || normalized === 'neither' || normalized === 'noaction';
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
    /**
     * The most recent review that settled (answer or error), kept so a caller
     * that missed the submit by a few seconds can still collect its verdicts
     * with the same review id instead of starting over.
     */
    this.lastReview = null;
    this.lastPoll = 0;
    this.polled = false;
    /**
     * Language the client last reported on `/state`. The host has no locale
     * service, so this is how an English UI gets English errors, option labels
     * and report text; it starts at the default until the first poll.
     */
    this.locale = DEFAULT_LANG;
  }

  /** A client polled within the presence window: the panel can be reached. */
  available(now = Date.now()) {
    return this.polled && now - this.lastPoll <= PRESENCE_TTL_MS;
  }

  /**
   * True once a client polled at any point in this process, even if the last poll
   * is now stale. A stale-but-known panel is worth a short pickup probe: the page
   * may sit in a background tab (browsers throttle its timers well past the 15 s
   * presence window) or have just been reloaded. Treating that as "no panel" used
   * to drop a large review onto the paged native card, which truncates answers.
   */
  known() {
    return this.polled;
  }

  touch() {
    this.polled = true;
    this.lastPoll = Date.now();
  }

  /** Remember the UI language the polling page reported (`?locale=en`). */
  learnLocale(request) {
    try {
      const url = new URL(String(request?.url ?? ''), 'http://127.0.0.1');
      const value = url.searchParams.get('locale');
      if (value !== null) this.locale = normalizeLang(value);
    } catch {
      /* a malformed URL must never break polling */
    }
  }

  /** The session the polling page is currently showing (`?session=<id>`). */
  pollSession(request) {
    try {
      const url = new URL(String(request?.url ?? ''), 'http://127.0.0.1');
      const value = url.searchParams.get('session');
      return typeof value === 'string' && value !== '' ? value : null;
    } catch {
      return null;
    }
  }

  /** Build a localised error for a message key (optionally with a code). */
  fail(key, code, vars = {}) {
    const error = new Error(tr(this.locale, key, vars));
    if (code !== undefined) error.code = code;
    return error;
  }

  /**
   * What the panel renders on every poll. Never leaks the resolver.
   *
   * A review belongs to the session that asked for it, so another session (or
   * another workspace, which is a different session) polling the same host does
   * not see it. Unknown ids on either side stay visible for compatibility.
   */
  state(sessionId = null) {
    const pending = this.current;
    const visible = pending !== null && this.matchesSession(pending, sessionId) ? pending : null;
    return {
      available: this.available(),
      virtual_threshold: this.virtualThreshold,
      token: this.token,
      pending: visible === null
        ? null
        : {
            id: visible.id,
            title: visible.title,
            items: visible.items,
            created_at: new Date(visible.createdAt).toISOString(),
            session_id: visible.sessionId,
          },
    };
  }

  /** Whether a pending review may be shown to the polling session. */
  matchesSession(pending, sessionId) {
    if (typeof pending.sessionId !== 'string' || pending.sessionId === '') return true;
    if (typeof sessionId !== 'string' || sessionId === '') return true;
    return pending.sessionId === sessionId;
  }

  /**
   * Ask through the panel and wait for the submit.
   *
   * A review deliberately outlives one tool call: a caller running under a short
   * execution budget (a `run_code` call defaults to two minutes) must be able to
   * return early and ask again. Aborting the tool call therefore no longer
   * destroys the review — only a submit, an explicit cancel, or the total
   * `timeoutMs` deadline settles it. The caller collects the verdicts either by
   * awaiting the same promise again or through `recentAnswer(id)` after it
   * settled, so a half-filled panel is never lost to a host deadline.
   *
   * @param {{ title: string, items: object[], signal?: AbortSignal, sessionId?: string,
   *   timeoutMs?: number }} request
   * @returns {{ id: string, promise: Promise<object>, review: object }}
   */
  begin({ title, items, signal, sessionId, timeoutMs }) {
    if (this.current !== null) throw this.fail('err.panelBusy', 'BUSY');
    if (signal !== undefined && signal !== null && signal.aborted === true) {
      throw this.fail('err.panelAborted', 'CANCELLED');
    }
    sequence += 1;
    const id = 'br-' + Date.now().toString(36) + '-' + sequence.toString(36);

    const limitMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : this.timeoutMs;
    let timer = null;
    let settled = false;
    let resolveOuter;
    let rejectOuter;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (this.current !== null && this.current.id === id) this.current = null;
      // Record the outcome synchronously: a caller resumed in the same tick as a
      // submit must find the verdicts through recent()/recentAnswer(), not race
      // the promise's microtask.
      review.settled = true;
      if (fn === rejectOuter) review.error = value;
      else review.answer = value;
      this.lastReview = review;
      fn(value);
    };

    /** The panel's review record; also the resumable handle returned to callers. */
    const review = {
      id,
      title: title || '',
      items,
      // The asking session: another session (or workspace) must not render it.
      sessionId: typeof sessionId === 'string' && sessionId !== '' ? sessionId : null,
      createdAt: Date.now(),
      settled: false,
      answer: null,
      error: null,
      resolve: null,
      reject: null,
    };

    const promise = new Promise((resolve, reject) => {
      resolveOuter = resolve;
      rejectOuter = reject;
      review.resolve = (answers) => settle(resolveOuter, { answers });
      review.reject = (error) => settle(rejectOuter, error);
      timer = setTimeout(() => {
        settle(reject, this.fail('err.panelTimeout', 'PANEL_TIMEOUT'));
      }, limitMs);
      if (this.unrefTimer && typeof timer.unref === 'function') timer.unref();
    });

    // The promise is part of the resumable handle: a caller that waited one
    // slice must be able to await the same review again later.
    review.promise = promise;

    // Track the outcome without swallowing the caller's own rejection: both
    // handlers return normally, so the chained promise never rejects.
    promise.then(
      (value) => {
        review.settled = true;
        review.answer = value;
        this.lastReview = review;
      },
      (error) => {
        review.settled = true;
        review.error = error;
        this.lastReview = review;
      },
    );

    this.current = review;
    return { id, promise, review };
  }

  /** The still-waiting review with this id, or null. */
  peek(id) {
    const pending = this.current;
    if (pending === null || pending.id !== id) return null;
    return pending;
  }

  /** The settled review with this id (answer or error), or null. */
  recent(id) {
    const last = this.lastReview;
    if (last === null || last.id !== id) return null;
    return last;
  }

  /** The answer of a review that already settled, or null. */
  recentAnswer(id) {
    const last = this.lastReview;
    if (last === null || last.id !== id) return null;
    return last.answer;
  }

  /** Validate and settle one submitted answer batch. */
  submit(payload) {
    const pending = this.current;
    if (pending === null) throw this.fail('err.noPendingReview', 'NOT_PENDING');
    if (payload === null || typeof payload !== 'object') {
      throw this.fail('err.submitNotObject', 'BAD_PAYLOAD');
    }
    if (typeof payload.id === 'string' && payload.id !== '' && payload.id !== pending.id) {
      throw this.fail('err.reviewIdMismatch', 'BAD_ID');
    }
    const raw = payload.answers;
    if (!Array.isArray(raw)) {
      throw this.fail('err.answersNotArray', 'BAD_PAYLOAD');
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
    // A multi-select may carry a mutually exclusive option ("都不做"/"none"). The
    // client enforces that, but a stale page must not be able to submit it
    // alongside another option: reject it instead of folding a self-contradictory
    // verdict into the report.
    const items = Array.isArray(pending.items) ? pending.items : [];
    for (const answer of answers) {
      const item = items.find((candidate) => String(candidate.id) === answer.id);
      if (item === undefined) continue;
      const exclusive = new Set(
        (Array.isArray(item.options) ? item.options : [])
          .filter((option) => option.exclusive === true || option.none === true ||
            isExclusiveLabel(String(option.label ?? '')))
          .map((option) => String(option.label ?? '')),
      );
      if (exclusive.size === 0) continue;
      const pickedExclusive = answer.selected.some((value) => exclusive.has(value));
      const pickedOther = answer.selected.some((value) => !exclusive.has(value));
      if (pickedExclusive && pickedOther) {
        throw this.fail('err.conflictingSelection', 'CONFLICTING_SELECTION');
      }
    }
    pending.resolve(answers);
    return { received: answers.length };
  }

  cancel(payload) {
    const pending = this.current;
    if (pending === null) return { cancelled: false };
    // A tab still showing an older review must not cancel the new one.
    if (payload !== null && typeof payload === 'object' &&
        typeof payload.id === 'string' && payload.id !== '' && payload.id !== pending.id) {
      throw this.fail('err.reviewIdMismatch', 'BAD_ID');
    }
    const error = new Error(cancelReasonText(
      this.locale,
      payload !== null && typeof payload === 'object' && payload.reason === 'skipped'
        ? 'skipped'
        : 'cancelled',
    ));
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
      const error = this.fail('err.noEditableConfig');
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
      const error = this.fail('err.noEditableConfig');
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
        if (foreignRequest(request)) {
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
      exact('GET', ROUTE_BASE + '/state', async (request) => {
        this.touch();
        this.learnLocale(request);
        return this.state(this.pollSession(request));
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
          if (foreignRequest(request)) {
            sendJson(response, 403, { ok: false, error: 'cross-origin request refused' });
            return;
          }
          // The settings page reports its language the same way a panel poll does.
          this.learnLocale(request);
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
