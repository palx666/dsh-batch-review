/**
 * dsh-batch-review — client half (browser bundle).
 *
 * One surface: the review panel in `conversation.input.dock`. It polls
 * `GET /api/batch-review/state` and, while a review is waiting, renders the
 * whole batch on one screen — every item with its verdict buttons and its own
 * note field — so a 20-item checklist no longer turns into 20 card pages.
 *
 * The panel is the only thing that polls. If this module is not mounted (or the
 * slot is missing in this composition) nothing polls, the host's panel stays
 * "not available", and `batch_review` falls back to the native card instead of
 * waiting for an answer no UI can send.
 *
 * `window.__ModuleLoader__.load` is the host's client bundling contract; React
 * comes from the browser module table.
 *
 * @module dsh-batch-review/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-batch-review',

  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // ── Copy ────────────────────────────────────────────────────────────────
    // Every piece of visible text goes through `T`. The dictionaries are
    // registered with the host's locale service in `apply`, and `T` reads the
    // active language at call time, so switching the GUI language updates the
    // panel and the settings section without a reload.
    const NS = 'dsh-batch-review';

    const ZH = {
      'panel.title': '批阅',
      'panel.subtitle': '一次问完 · 逐条作答 · 共 {n} 条',
      'panel.slow': '共 {n} 条，逐条作答会很慢；建议改用 CSV/Excel 批量填写（技能里的 build_review.py --format csv）。',
      'panel.stat': '已填 {filled} / {total} · 未填不当作通过',
      'panel.ungrouped': '未分组',
      'panel.count': '{n} 条',
      'panel.multi': '多选',
      'panel.note': '备注（可选）',
      'panel.answer': '填写内容',
      'panel.bulk': '全{label}',
      'panel.clear': '清空',
      'panel.skip': '跳过',
      'panel.submit': '提交',
      'panel.submitting': '提交中…',
      'panel.submitFail': '提交失败',
      'panel.stale': '批阅凭证已过期（面板可能重启过），请稍等一秒再点一次；仍失败就重新发起批阅。',
      'panel.warn403': '面板接口拒绝了本页请求（可能是反代/隧道访问：面板只接受回环 Host）— 已退回原生卡片',
      'settings.title': '批阅面板',
      'settings.intro': '批阅面板的运行时参数。保存后立即生效，并写入 {path}。',
      'settings.file': '配置文件',
      'settings.save': '保存',
      'settings.saving': '保存中…',
      'settings.reset': '重置',
      'settings.resetTitle': '把默认值填入表单；保存后会作为显式设置写盘（覆盖 cordis 层）。若想交还给 cordis 层，请清空对应输入框后保存。',
      'settings.resetNote': '已填入默认值：保存后按显式设置写盘（想交还 cordis 请清空输入框）',
      'settings.advanced': '高级设置',
      'settings.collapse': '收起高级设置',
      'settings.advancedIntro': '以下参数一般不需要改，调整前请确认影响。',
      'settings.loading': '读取配置…',
      'settings.noChange': '没有改动',
      'settings.saved': '已保存，立即生效',
      'settings.saveFail': '保存失败：{message}',
      'settings.range': '（{min}–{max}）',
      'field.panelThreshold.label': '面板阈值',
      'field.panelThreshold.hint': '条目数 ≥ 这个值时走插件面板，否则走原生卡片',
      'field.maxItems.label': '单次条目上限',
      'field.maxItems.hint': '超过直接驳回，要求拆成多批',
      'field.panelTimeoutMs.label': '等待上限（毫秒）',
      'field.panelTimeoutMs.hint': '等人工作答的最长时间',
      'field.virtualThreshold.label': '虚拟滚动阈值',
      'field.virtualThreshold.hint': '条目数超过该值时启用虚拟滚动',
      'field.maxBodyBytes.label': '请求体上限（字节）',
      'field.maxBodyBytes.hint': '大批次提交的体积上限',
      'field.allowExternalPersist.label': '允许把结果存到工作目录之外',
      'field.allowExternalPersist.hint': 'agent 的 persist 参数默认只能写当前工作目录内；开启后允许任意路径。一般保持关闭。',
    };

    const EN = {
      'panel.title': 'Review',
      'panel.subtitle': 'One batch · answer every item · {n} total',
      'panel.slow': '{n} items is a lot to answer row by row; consider the CSV/Excel route (build_review.py --format csv in the skill).',
      'panel.stat': 'Filled {filled} / {total} · a blank is never a pass',
      'panel.ungrouped': 'Ungrouped',
      'panel.count': '{n} items',
      'panel.multi': 'multi',
      'panel.note': 'Note (optional)',
      'panel.answer': 'Your answer',
      'panel.bulk': 'All {label}',
      'panel.clear': 'Clear',
      'panel.skip': 'Skip',
      'panel.submit': 'Submit',
      'panel.submitting': 'Submitting…',
      'panel.submitFail': 'Submit failed',
      'panel.stale': 'This panel token went stale (the panel may have restarted). Wait a second and click again; if it still fails, start the review again.',
      'panel.warn403': 'The panel routes refused this page (a reverse proxy or tunnel? the panel only accepts a loopback Host) — falling back to the native card',
      'settings.title': 'Batch review',
      'settings.intro': 'Runtime settings for the review panel. A save takes effect immediately and is written to {path}.',
      'settings.file': 'the config file',
      'settings.save': 'Save',
      'settings.saving': 'Saving…',
      'settings.reset': 'Reset',
      'settings.resetTitle': 'Fills the form with the defaults; saving writes them as explicit settings (overriding the cordis layer). To hand a tunable back to cordis, clear its input and save.',
      'settings.resetNote': 'Defaults filled in: saving writes them as explicit settings (clear an input to hand it back to cordis)',
      'settings.advanced': 'Advanced',
      'settings.collapse': 'Hide advanced',
      'settings.advancedIntro': 'These rarely need changing; check the effect before you touch them.',
      'settings.loading': 'Loading settings…',
      'settings.noChange': 'No changes',
      'settings.saved': 'Saved; applied immediately',
      'settings.saveFail': 'Save failed: {message}',
      'settings.range': ' ({min}–{max})',
      'field.panelThreshold.label': 'Panel threshold',
      'field.panelThreshold.hint': 'At this many items or more the plugin panel is used; below it, the native card',
      'field.maxItems.label': 'Item cap',
      'field.maxItems.hint': 'A larger review is rejected and must be split',
      'field.panelTimeoutMs.label': 'Timeout (ms)',
      'field.panelTimeoutMs.hint': 'How long to wait for a human answer',
      'field.virtualThreshold.label': 'Virtual-scroll threshold',
      'field.virtualThreshold.hint': 'Above this many rows the panel lets the browser skip off-screen paint',
      'field.maxBodyBytes.label': 'Request body cap (bytes)',
      'field.maxBodyBytes.hint': 'Size limit for a large submitted batch',
      'field.allowExternalPersist.label': 'Allow persist outside the working directory',
      'field.allowExternalPersist.hint': 'The persist argument may only write inside the process cwd by default; enabling this allows any path. Usually left off.',
    };

    const DICT = { zh: ZH, en: EN };

    function fillText(template, vars) {
      if (vars === undefined || vars === null) return template;
      return Object.entries(vars).reduce(
        (text, [name, value]) => text.split('{' + name + '}').join(String(value)),
        template,
      );
    }

    // Replaced in `apply` with the host-bound translator; the fallback keeps the
    // module renderable in a test or a host without the locale service.
    let translate = (key, vars) => fillText(ZH[key] ?? key, vars);
    function T(key, vars) {
      return translate(key, vars);
    }

    /** The locale service, once `apply` runs (null in a lean composition). */
    let localeService = null;

    /** Active language reported to the host on every poll (`?locale=`). */
    function currentLang() {
      try {
        const snapshot = localeService?.getSnapshot?.();
        const active = snapshot && typeof snapshot.active === 'string' ? snapshot.active : '';
        return active === '' ? 'zh' : active;
      } catch {
        return 'zh';
      }
    }

    const PANEL_ID = 'batch-review-panel';
    // Root-absolute on purpose: a document URL with path segments would otherwise
    // resolve the route under that path and the panel would silently fall back.
    const ROUTE = '/api/batch-review/';
    const POLL_IDLE_MS = 2500;
    const POLL_WAIT_MS = 1500;
    const REQUEST_TIMEOUT_MS = 8000;

    const CSS = `
.brx-card{width:100%;max-width:var(--dsh-chat-content-width);box-sizing:border-box;
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xl);
  background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);
  box-shadow:var(--dsw-elevation-panel);display:flex;flex-direction:column;
  max-height:min(62vh,560px);overflow:hidden;margin:0 auto}
.brx-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
  padding:14px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.brx-title{margin:0;font-size:16px;font-weight:500;line-height:22px}
.brx-sub{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.brx-hint{margin:8px 16px 0;padding:8px 10px;border-radius:8px;font-size:12px;line-height:18px;
  background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary)}
.brx-progress{height:4px;border-radius:4px;background:var(--dsw-alias-bg-overlay);overflow:hidden;margin-top:8px}
.brx-progress i{display:block;height:100%;background:var(--dsw-alias-state-business-primary);transition:width .15s}
.brx-list{overflow-y:auto;padding:6px 8px;display:flex;flex-direction:column;gap:2px}
.brx-group{margin:4px 0 2px}
.brx-group-hd{display:flex;align-items:center;justify-content:flex-start;gap:12px;
  padding:4px 10px 2px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary)}
.brx-group-hd b{font-weight:600;color:var(--dsw-alias-label-primary);margin-right:6px}
.brx-group-acts{display:flex;gap:4px}
.brx-row{padding:10px 10px 8px;border-radius:var(--dsw-radius-md);border:1px solid transparent}
.brx-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.brx-row-t{display:flex;gap:8px;align-items:baseline;font-size:14px;line-height:22px}
.brx-multi{margin-left:6px;padding:0 5px;border-radius:4px;background:var(--dsw-alias-bg-overlay);
  color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;align-self:center}
.brx-num{flex:0 0 auto;min-width:20px;text-align:right;color:var(--dsw-alias-label-tertiary);font-size:12px}
.brx-detail{margin:2px 0 0 28px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.brx-line{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:8px 0 0 28px}
.brx-acts{display:flex;flex-wrap:wrap;gap:4px;margin:0;flex:0 1 auto;min-width:0}
.brx-btn{box-sizing:border-box;min-height:34px;padding:0 12px;border-radius:6px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);
  font:inherit;font-size:14px;line-height:1;white-space:nowrap;flex:0 0 auto}
.brx-btn.sm{min-height:26px;padding:0 9px;font-size:12px}
.brx-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.brx-btn.on{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.brx-btn.pass.on{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.brx-btn.fail.on{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.brx-opts{display:flex;flex-direction:column;gap:4px;flex:1 1 100%;min-width:0}
.brx-opt{display:flex;flex-direction:row;align-items:baseline;flex-wrap:wrap;gap:2px 8px;
  width:100%;box-sizing:border-box;
  padding:7px 10px;border-radius:6px;cursor:pointer;text-align:left;
  border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);
  font:inherit;font-size:14px;line-height:20px}
.brx-opt:hover{background:var(--dsw-alias-interactive-bg-hover)}
.brx-opt.on{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.brx-opt.pass.on{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.brx-opt.fail.on{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.brx-opt-t{font-size:14px;line-height:20px;flex:0 0 auto}
.brx-opt-d{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);flex:1 1 auto;min-width:0}
.brx-opt.on .brx-opt-d{color:inherit;opacity:.85}
.brx-note{box-sizing:border-box;flex:1 1 160px;min-width:120px;min-height:34px;margin:0;
  padding:7px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-module-platform);color:inherit;font:inherit;font-size:14px;line-height:24px;resize:vertical}
.brx-note:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.brx-ft{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1)}
.brx-stat{font-size:12px;color:var(--dsw-alias-label-secondary)}
.brx-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;padding:0 16px 8px}
.brx-list.virtual{display:block;gap:0}
.brx-list.virtual .brx-group-hd,.brx-list.virtual .brx-row{content-visibility:auto;contain-intrinsic-size:auto 82px}
.brx-set{padding:12px 14px;display:flex;flex-direction:column;gap:10px;max-width:720px}
.brx-set-hd{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.brx-set-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.brx-set-k{flex:0 0 170px;font-size:14px;line-height:20px}
.brx-set-in{width:130px;box-sizing:border-box;padding:6px 8px;border-radius:6px;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);
  color:inherit;font:inherit;font-size:14px}
.brx-set-d{flex:1 1 220px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.brx-set-ft{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-top:4px}
.brx-set-note{margin-right:auto;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.brx-set-toggle{align-self:flex-start;margin:2px 0 0;padding:0;border:0;background:none;cursor:pointer;
  color:var(--dsw-alias-state-business-primary);font:inherit;font-size:13px;line-height:20px}
.brx-set-toggle:hover{text-decoration:underline}
.brx-set-adv{display:flex;flex-direction:column;gap:10px;padding:10px 12px;border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay)}
`;

    function installStyles() {
      const existing = document.getElementById('dsh-batch-review-css');
      if (existing !== null) existing.remove();
      const tag = document.createElement('style');
      tag.id = 'dsh-batch-review-css';
      tag.dataset.plugin = 'dsh-batch-review';
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => tag.remove();
    }

    /**
     * Submit token, handed out by `GET /state` on every poll. POSTs must echo it
     * or the host answers 403: a cross-origin page can read neither the token nor
     * the answers, so it cannot forge a verdict even if it finds the endpoint.
     */
    let submitToken = '';
    let warnedMissingRoute = false;
    let warnedHostRejected = false;

    async function request(name, init) {
      if (typeof fetch !== 'function') throw new Error('fetch unavailable');
      const base = document.baseURI ?? document.location?.href ?? '/';
      const url = new URL(ROUTE + name, base).toString();
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller === null ? null : setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const headers = { ...(init && init.headers) };
      if (init && init.method === 'POST') headers['x-batch-review-token'] = submitToken;
      try {
        const response = await fetch(url, {
          cache: 'no-store',
          credentials: 'same-origin',
          ...init,
          headers,
          signal: controller?.signal,
        });
        const text = await response.text();
        if (response.status === 404 && !warnedMissingRoute) {
          warnedMissingRoute = true;
          console.warn('[dsh-batch-review] panel routes are unreachable at ' + url
            + ' — falling back to the native card');
        }
        const body = text === '' ? {} : JSON.parse(text);
        if (response.status === 403) {
          // A 403 is two things: a submit token that outlived its panel (host
          // restart), or a request the panel routes refuse because the Host is not
          // loopback — a reverse proxy or tunnel. The panel has no way to tell them
          // apart, so say the second one once: without it "the panel never
          // appears" is undiagnosable on a proxied GUI.
          if (!warnedHostRejected) {
            warnedHostRejected = true;
            console.warn('[dsh-batch-review] ' + T('panel.warn403'));
          }
          // The token outlived its panel (host restart): forget it and let the
          // next poll pick up the current one; the panel shows a retry hint.
          submitToken = '';
          const error = new Error(body?.error ?? 'HTTP 403');
          error.code = 'STALE_TOKEN';
          throw error;
        }
        if (!response.ok && body?.ok !== true) throw new Error(body?.error ?? 'HTTP ' + response.status);
        return body;
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    }

    /**
     * The Settings page saves a patch, never the whole draft. Posting every key
     * used to bake the resolved values (defaults + cordis) into the settings
     * file, which sits above the cordis layer and silently froze it. `null` means
     * "drop the stored override" and is only sent when one actually existed.
     *
     * Pure and module-level so the test suite can lock the three cases
     * (changed / cleared / untouched) without a DOM.
     */
    function buildPatch(draft, baseline) {
      const patch = {};
      for (const key of Object.keys(draft)) {
        const value = draft[key];
        if (value === null) {
          if (baseline[key] !== undefined) patch[key] = null;
        } else if (value !== baseline[key]) {
          patch[key] = value;
        }
      }
      return patch;
    }

    /**
     * Buttons for one item come from its `options`, not from a `type` field: the
     * host maps items to `AskUserQuestionItem` before the panel sees them, and
     * that shape only carries `options` (text items have none).
     */
    function verdictsOf(item) {
      const options = Array.isArray(item.options) ? item.options : [];
      return options.map((option) => {
        const label = String(option.label ?? '');
        // The host carries the note in `description`; items without one keep the
        // compact inline button row, items with one stack label + note.
        const note = typeof option.description === 'string' ? option.description : '';
        // The host tags the fixed verdict/bool sets with a `tone`; anything else
        // is a caller-supplied choice. Judging by the label text stopped working
        // the moment the labels were translated.
        const tone = typeof option.tone === 'string' ? option.tone : 'choice';
        return { label, tone, note };
      });
    }

    /** Choice options get A/B/C prefixes; fixed verdict/bool/scale sets do not. */
    function isChoiceSet(options) {
      const labels = options.map((option) => String(option.label ?? ''));
      const tones = options.map((option) => (typeof option.tone === 'string' ? option.tone : ''));
      const everyTone = (allowed) =>
        tones.length > 0 && tones.every((tone) => allowed.includes(tone));
      if (everyTone(['pass', 'fail', 'pending', 'skip'])) return false;
      if (everyTone(['yes', 'no'])) return false;
      return !labels.every((label) => /^\d+$/.test(label));
    }

    // The dock unmounts when the user opens Settings or switches pages; a
    // component-local draft would silently drop every click. Keep it here,
    // keyed by review id, and mirror it into sessionStorage so even a page
    // reload restores the clicks.
    const DRAFT_KEY = 'dsh-batch-review:draft';
    const draftMemory = (() => {
      try {
        const raw = globalThis.sessionStorage?.getItem(DRAFT_KEY);
        const parsed = raw === undefined || raw === null ? null : JSON.parse(raw);
        if (parsed !== null && typeof parsed === 'object' && typeof parsed.id === 'string') {
          return { id: parsed.id, draft: parsed.draft ?? {} };
        }
      } catch {
        /* storage unavailable or corrupt: start empty */
      }
      return { id: null, draft: {} };
    })();

    function saveDraftMemory() {
      try {
        globalThis.sessionStorage?.setItem(DRAFT_KEY, JSON.stringify(draftMemory));
      } catch {
        /* storage unavailable: the in-memory copy still works */
      }
    }

    function ReviewPanel() {
      const [view, setView] = React.useState({ pending: null, available: false, virtual_threshold: 500 });
      const [draft, setDraft] = React.useState({});
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');

      // Every draft write goes through here so the module-level memory stays in
      // sync with the component state.
      const commitDraft = (updater) => {
        setDraft((prev) => {
          const next = typeof updater === 'function' ? updater(prev) : updater;
          draftMemory.draft = next;
          saveDraftMemory();
          return next;
        });
      };

      React.useEffect(() => {
        let alive = true;
        let timer = null;
        const poll = async () => {
          let pending = null;
          try {
            // The language rides the poll: the host has no locale service, and it
            // uses this value for the option labels, errors and report text.
            const body = await request('state?locale=' + encodeURIComponent(currentLang()));
            if (!alive) return;
            if (typeof body.token === 'string' && body.token !== '') submitToken = body.token;
            setView({
              pending: body.pending ?? null,
              available: body.available === true,
              virtual_threshold: Number.isInteger(body.virtual_threshold) ? body.virtual_threshold : 500,
            });
            pending = body.pending ?? null;
          } catch {
            if (alive) setView((prev) => ({ ...prev, pending: null, available: false }));
          }
          if (alive) timer = setTimeout(poll, pending === null ? POLL_IDLE_MS : POLL_WAIT_MS);
        };
        poll();
        return () => {
          alive = false;
          if (timer !== null) clearTimeout(timer);
        };
      }, []);

      const pending = view.pending;

      // A new review resets the draft; a remount of the same review restores
      // whatever was already clicked. A remount starts with pending === null
      // until the first poll returns, so that state must NOT touch the memory
      // (clearing it there is exactly what made Settings wipe the draft).
      React.useEffect(() => {
        if (pending !== null) {
          if (draftMemory.id === pending.id) {
            setDraft(draftMemory.draft);
          } else {
            draftMemory.id = pending.id;
            draftMemory.draft = {};
            saveDraftMemory();
            commitDraft({});
          }
        }
        setError('');
        setBusy(false);
      }, [pending === null ? '' : pending.id]);

      // Very large batches render every row but let the browser skip off-screen
      // layout/paint (see the .virtual CSS rule); rendering one DOM row per item
      // used to freeze the panel on a 100k-item review.
      const VIRTUAL_THRESHOLD = Number.isInteger(view.virtual_threshold) ? view.virtual_threshold : 500;

      // Group once per review, never per scroll frame.
      const model = React.useMemo(() => {
        const source = view.pending;
        const its = source && Array.isArray(source.items) ? source.items : [];
        const gs = [];
        its.forEach((item, index) => {
          const key = String(item.group ?? item.header ?? '').trim() || T('panel.ungrouped');
          const last = gs[gs.length - 1];
          if (last !== undefined && last.key === key) last.items.push({ item, index });
          else gs.push({ key, items: [{ item, index }] });
        });
        // The bulk row applies the group's fixed verdict set; it is recognised by
        // the tone the host tagged the options with, not by their (translated) text.
        const BULK_TONES = ['pass', 'fail', 'pending'];
        for (const group of gs) {
          // Which bulk verdicts make sense for this group: only the tones its
          // items actually offer. A choice/scale/text group has none, so its
          // header keeps just the clear button instead of three dead ones.
          const toneLabels = new Map();
          for (const entry of group.items) {
            for (const option of verdictsOf(entry.item)) {
              if (!toneLabels.has(option.tone)) toneLabels.set(option.tone, option.label);
            }
          }
          group.bulk = BULK_TONES
            .filter((tone) => toneLabels.has(tone))
            .map((tone) => ({ tone, label: toneLabels.get(tone) }));
        }
        return { groups: gs };
      }, [view.pending]);

      if (pending === null) return null;

      const items = Array.isArray(pending.items) ? pending.items : [];
      const filled = items.filter((item) => {
        const entry = draft[item.id] ?? {};
        const selected = Array.isArray(entry.selected) ? entry.selected : [];
        return selected.length > 0 || (entry.note ?? '').trim() !== '';
      }).length;

      const setVerdict = (id, label, multi) => {
        commitDraft((prev) => {
          const current = Array.isArray(prev[id]?.selected) ? prev[id].selected : [];
          let next;
          if (multi) {
            next = current.includes(label) ? current.filter((value) => value !== label) : [...current, label];
          } else {
            next = current.length === 1 && current[0] === label ? [] : [label];
          }
          return { ...prev, [id]: { ...prev[id], selected: next } };
        });
      };
      const setNote = (id, note) => {
        commitDraft((prev) => ({ ...prev, [id]: { ...prev[id], note } }));
      };

      const submit = async () => {
        setBusy(true);
        setError('');
        try {
          const answers = items.map((item) => ({
            id: String(item.id),
            selected: Array.isArray(draft[item.id]?.selected) ? draft[item.id].selected : [],
            custom: typeof draft[item.id]?.note === 'string' ? draft[item.id].note : '',
          }));
          const body = await request('submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: pending.id, answers }),
          });
          if (body?.ok === true) {
            setView((prev) => ({ ...prev, pending: null, available: true }));
            commitDraft({});
          } else {
            setError(body?.error ?? T('panel.submitFail'));
          }
        } catch (err) {
          setError(err?.code === 'STALE_TOKEN' ? T('panel.stale') : String(err?.message ?? err));
        } finally {
          setBusy(false);
        }
      };

      const cancel = async () => {
        setBusy(true);
        setError('');
        try {
          await request('cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: pending.id, reason: 'skipped' }),
          });
          setView((prev) => ({ ...prev, pending: null, available: true }));
          commitDraft({});
        } catch (err) {
          setError(err?.code === 'STALE_TOKEN' ? T('panel.stale') : String(err?.message ?? err));
        } finally {
          setBusy(false);
        }
      };

      const bulkGroup = (groupItems, label) => {
        commitDraft((prev) => {
          const next = { ...prev };
          for (const { item } of groupItems) {
            if (!verdictsOf(item).some((option) => option.label === label)) continue;
            next[item.id] = { ...next[item.id], selected: [label] };
          }
          return next;
        });
      };

      const clearGroup = (groupItems) => {
        commitDraft((prev) => {
          const next = { ...prev };
          for (const { item } of groupItems) delete next[item.id];
          return next;
        });
      };

      const rowNode = (item, index) => {
        const options = verdictsOf(item);
        const entry = draft[item.id] ?? {};
        const selected = Array.isArray(entry.selected) ? entry.selected : [];
        const numbered = isChoiceSet(options);
        // Options carrying a note stack label above note, like the native card;
        // a note-less group keeps the compact inline row of buttons.
        const stacked = options.some((option) => option.note !== '');
        const prefix = (option, optionIndex) => numbered && !/^[A-Za-z][.、．]\s*/.test(option.label)
          ? String.fromCharCode(65 + optionIndex) + '. ' + option.label
          : option.label;
        const actions = options.length === 0
          ? null
          : stacked
            ? h('div', { className: 'brx-opts' },
                options.map((option, optionIndex) => h('button', {
                  key: option.label,
                  type: 'button',
                  className: 'brx-opt ' + option.tone + (selected.includes(option.label) ? ' on' : ''),
                  disabled: busy,
                  onClick: () => setVerdict(item.id, option.label, item.multiSelect === true),
                },
                  h('span', { className: 'brx-opt-t' }, prefix(option, optionIndex)),
                  h('span', { className: 'brx-opt-d' }, option.note),
                )),
              )
            : h('div', { className: 'brx-acts' },
                options.map((option, optionIndex) => h('button', {
                  key: option.label,
                  type: 'button',
                  className: 'brx-btn ' + option.tone + (selected.includes(option.label) ? ' on' : ''),
                  disabled: busy,
                  onClick: () => setVerdict(item.id, option.label, item.multiSelect === true),
                }, prefix(option, optionIndex))),
              );
        return h('div', { key: item.id, className: 'brx-row' },
          h('div', { className: 'brx-row-t' },
            h('span', { className: 'brx-num' }, String(index + 1)),
            h('span', {}, item.question ?? String(item.id)),
            item.multiSelect ? h('span', { className: 'brx-multi' }, T('panel.multi')) : null,
          ),
          item.detail ? h('div', { className: 'brx-detail' }, item.detail) : null,
          h('div', { className: 'brx-line' },
            actions,
            h('textarea', {
              className: 'brx-note',
              placeholder: options.length > 0 ? T('panel.note') : T('panel.answer'),
              rows: options.length > 0 ? 1 : 2,
              value: entry.note ?? '',
              disabled: busy,
              onChange: (event) => setNote(item.id, event.target.value),
            }),
          ),
        );
      };

      // Group consecutive items by `group` (falling back to the card header). A
      // batch of 100 is workable when it arrives sorted into a handful of groups;
      // a flat list of 100 is not.
      const groups = model.groups;

      // Only the verdicts this group actually offers: a group of choice/scale/text
      // items has no 通过/不通过/待定 buttons at all, only 清空.
      const groupActions = (group) => h('div', { className: 'brx-group-acts' },
        (Array.isArray(group.bulk) ? group.bulk : []).map((bulk) => h('button', {
          key: bulk.tone,
          type: 'button',
          className: 'brx-btn sm',
          disabled: busy,
          onClick: () => bulkGroup(group.items, bulk.label),
        }, T('panel.bulk', { label: bulk.label }))),
        h('button', { type: 'button', className: 'brx-btn sm', disabled: busy, onClick: () => clearGroup(group.items) }, T('panel.clear')),
      );

      const groupNodes = groups.map((group, groupIndex) => h('div', {
        key: group.key + ':' + groupIndex,
        className: 'brx-group',
      },
        h('div', { className: 'brx-group-hd' },
          h('span', {}, h('b', {}, group.key), T('panel.count', { n: group.items.length })),
          groupActions(group),
        ),
        group.items.map(({ item, index }) => rowNode(item, index)),
      ));

      // Very large batches skip off-screen layout/paint through content-visibility
      // instead of a hand-rolled fixed-height window: every row keeps its real
      // height, so a tall row (detail line, stacked option notes) can never be
      // clipped and its buttons stay clickable.
      const virtualMode = items.length > VIRTUAL_THRESHOLD;

      return h('div', { className: 'brx-card' },
        h('div', { className: 'brx-hd' },
          h('div', { style: { minWidth: 0 } },
            h('h3', { className: 'brx-title' }, pending.title || T('panel.title')),
            h('p', { className: 'brx-sub' }, T('panel.subtitle', { n: items.length })),
            h('div', { className: 'brx-progress' },
              h('i', { style: { width: (items.length === 0 ? 0 : Math.round((filled / items.length) * 100)) + '%' } }),
            ),
          ),
        ),
        items.length >= 50
          ? h('div', { className: 'brx-hint' }, T('panel.slow', { n: items.length }))
          : null,
        h('div', { className: virtualMode ? 'brx-list virtual' : 'brx-list' }, groupNodes),
        error !== '' ? h('div', { className: 'brx-err' }, error) : null,
        h('div', { className: 'brx-ft' },
          h('span', { className: 'brx-stat' }, T('panel.stat', { filled, total: items.length })),
          h('div', { style: { display: 'flex', gap: 8 } },
            h('button', { type: 'button', className: 'brx-btn', disabled: busy, onClick: cancel }, T('panel.skip')),
            h('button', {
              type: 'button',
              className: 'brx-btn on',
              disabled: busy,
              onClick: submit,
            }, busy ? T('panel.submitting') : T('panel.submit')),
          ),
        ),
      );
    }

    /** Settings page: frequent tunables stay visible, the rest hides behind Advanced. */
    const BASIC_FIELDS = [
      { key: 'panelThreshold' },
      { key: 'maxItems' },
      { key: 'panelTimeoutMs' },
    ];
    const ADVANCED_FIELDS = [
      { key: 'virtualThreshold' },
      { key: 'maxBodyBytes' },
    ];

    function SettingsTab() {
      const [state, setState] = React.useState({
        loading: true, error: '', config: {}, defaults: {}, limits: {}, path: '',
      });
      const [draft, setDraft] = React.useState({});
      const [baseline, setBaseline] = React.useState({});
      const [busy, setBusy] = React.useState(false);
      const [note, setNote] = React.useState('');
      const [advanced, setAdvanced] = React.useState(false);

      React.useEffect(() => {
        let alive = true;
        request('config')
          .then((body) => {
            if (!alive) return;
            setState({
              loading: false,
              error: '',
              config: body.config ?? {},
              defaults: body.defaults ?? {},
              limits: body.limits ?? {},
              path: body.path ?? '',
            });
            setDraft(body.config ?? {});
            setBaseline(body.config ?? {});
          })
          .catch((error) => {
            if (!alive) return;
            setState((prev) => ({ ...prev, loading: false, error: String(error?.message ?? error) }));
          });
        return () => { alive = false; };
      }, []);

      const save = () => {
        // Only the keys this page changed go out; see buildPatch for why.
        const patch = buildPatch(draft, baseline);
        if (Object.keys(patch).length === 0) {
          setNote(T('settings.noChange'));
          return;
        }
        setBusy(true);
        setNote('');
        request('config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
          .then((body) => {
            const next = body.config ?? draft;
            setState((prev) => ({ ...prev, config: next }));
            setDraft(next);
            setBaseline(next);
            setNote(T('settings.saved'));
          })
          .catch((error) => setNote(T('settings.saveFail', { message: String(error?.message ?? error) })))
          .finally(() => setBusy(false));
      };

      if (state.loading) return h('div', { className: 'brx-set' }, T('settings.loading'));
      if (state.error !== '') {
        return h('div', { className: 'brx-set' }, h('div', { className: 'brx-err' }, state.error));
      }

      const fieldRow = (field) => {
        const limit = state.limits?.[field.key] ?? {};
        const range = limit.min === undefined ? '' : T('settings.range', { min: limit.min, max: limit.max });
        return h('label', { key: field.key, className: 'brx-set-row' },
          h('span', { className: 'brx-set-k' }, T('field.' + field.key + '.label')),
          h('input', {
            type: 'number',
            className: 'brx-set-in',
            min: limit.min,
            max: limit.max,
            value: draft[field.key] ?? '',
            disabled: busy,
            onChange: (event) => setDraft((prev) => ({
              ...prev,
              [field.key]: event.target.value === '' ? null : Number(event.target.value),
            })),
          }),
          h('span', { className: 'brx-set-d' }, T('field.' + field.key + '.hint') + range),
        );
      };

      return h('div', { className: 'brx-set' },
        h('p', { className: 'brx-set-hd' },
          T('settings.intro', { path: state.path || T('settings.file') })),
        BASIC_FIELDS.map(fieldRow),
        h('button', {
          type: 'button',
          className: 'brx-set-toggle',
          disabled: busy,
          onClick: () => setAdvanced((prev) => !prev),
        }, advanced ? T('settings.collapse') : T('settings.advanced')),
        advanced
          ? h('div', { className: 'brx-set-adv' },
              h('p', { className: 'brx-set-hd' }, T('settings.advancedIntro')),
              ADVANCED_FIELDS.map(fieldRow),
              h('label', { className: 'brx-set-row' },
                h('span', { className: 'brx-set-k' }, T('field.allowExternalPersist.label')),
                h('input', {
                  type: 'checkbox',
                  checked: draft.allowExternalPersist === true,
                  disabled: busy,
                  onChange: (event) => setDraft((prev) => ({ ...prev, allowExternalPersist: event.target.checked })),
                }),
                h('span', { className: 'brx-set-d' }, T('field.allowExternalPersist.hint')),
              ),
            )
          : null,
        h('div', { className: 'brx-set-ft' },
          note !== '' ? h('span', { className: 'brx-set-note' }, note) : h('span'),
          h('button', {
            type: 'button',
            className: 'brx-btn',
            disabled: busy,
            title: T('settings.resetTitle'),
            onClick: () => {
              setDraft({ ...(state.defaults ?? {}) });
              setNote(T('settings.resetNote'));
            },
          }, T('settings.reset')),
          h('button', {
            type: 'button',
            className: 'brx-btn on',
            disabled: busy,
            onClick: save,
          }, busy ? T('settings.saving') : T('settings.save')),
        ),
      );
    }

    return {
      inject: ['slots'],
      // Pure helper, exposed for the unit tests: the settings page's patch builder
      // is the one piece of client logic a wrong edit silently breaks.
      __test: { buildPatch },
      apply(ctx) {
        ctx.effect(() => installStyles());
        // Register both dictionaries and bind the translator. `ctx.locale` is a
        // client service; a lean composition without it keeps the built-in copy.
        try {
          if (ctx.locale && typeof ctx.locale.register === 'function') {
            ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'dsh-batch-review: zh');
            ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'dsh-batch-review: en');
            localeService = ctx.locale;
            if (typeof ctx.locale.bind === 'function') {
              const bound = ctx.locale.bind(NS);
              translate = (key, vars) => fillText(bound(key), vars);
            }
          }
        } catch {
          /* no locale service: the Chinese dialog stays as shipped */
        }
        try {
          ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
            name: 'conversation.input.dock',
            id: PANEL_ID,
            order: 10,
          }, ReviewPanel));
        } catch (error) {
          try {
            console.warn('[dsh-batch-review] panel slot not registered:', error);
          } catch {
            /* nothing left to do */
          }
        }
        // Settings → left nav gets its own 「批阅面板」 section. `settings.section`
        // is what third-party plugins use (dsh-at-file, the skins, …); the
        // `settings.plugins.tab` list only grows a tab bar once a second entry
        // exists, so it is the wrong surface for a single settings page.
        try {
          ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: 'batch-review',
            order: 60,
            label: () => T('settings.title'),
          }, SettingsTab));
        } catch (error) {
          try {
            console.warn('[dsh-batch-review] settings section not registered:', error);
          } catch {
            /* nothing left to do */
          }
        }
      },
    };
  },
});
