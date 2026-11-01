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

    const PANEL_ID = 'batch-review-panel';
    const ROUTE = 'api/batch-review/';
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
.brx-list.virtual{display:block;gap:0;position:relative}
.brx-vlist{position:relative;width:100%}
.brx-vitem{position:absolute;left:0;right:0;overflow:hidden}
.brx-vitem > .brx-row{margin:0}
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
        const body = text === '' ? {} : JSON.parse(text);
        if (response.status === 403) {
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
        const tone = label === '通过' || label === '是'
          ? 'pass'
          : label === '不通过' || label === '否'
            ? 'fail'
            : label === '待定' || label === '未测'
              ? 'skip'
              : 'choice';
        return { label, tone, note };
      });
    }

    /** Choice options get A/B/C prefixes; fixed verdict/bool/scale sets do not. */
    function isChoiceSet(options) {
      const labels = options.map((option) => String(option.label ?? ''));
      if (labels.length <= 3 && labels.every((label) => label === '通过' || label === '不通过' || label === '待定')) return false;
      if (labels.every((label) => label === '是' || label === '否')) return false;
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
            const body = await request('state');
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

      // Virtual windowing for very large batches: rendering one DOM row per
      // item froze the browser on a 100k-item review.
      const VIRTUAL_THRESHOLD = Number.isInteger(view.virtual_threshold) ? view.virtual_threshold : 500;
      const GROUP_H = 30;
      const ROW_H = 100;
      const OVERSCAN_PX = 300;

      const [scrollTop, setScrollTop] = React.useState(0);
      const [viewportH, setViewportH] = React.useState(480);
      const onListScroll = (event) => {
        const node = event && event.currentTarget;
        if (!node) return;
        setScrollTop(Number(node.scrollTop) || 0);
        const height = Number(node.clientHeight) || 0;
        if (height > 0) setViewportH(height);
      };

      // Group + flatten once per review, never per scroll frame.
      const model = React.useMemo(() => {
        const source = view.pending;
        const its = source && Array.isArray(source.items) ? source.items : [];
        const gs = [];
        its.forEach((item, index) => {
          const key = String(item.group ?? item.header ?? '').trim() || '未分组';
          const last = gs[gs.length - 1];
          if (last !== undefined && last.key === key) last.items.push({ item, index });
          else gs.push({ key, items: [{ item, index }] });
        });
        const flat = [];
        let offset = 0;
        const BULK_LABELS = ['通过', '不通过', '待定'];
        for (const group of gs) {
          // Which bulk verdicts make sense for this group: only the labels its
          // items actually offer. A choice/scale/text group has none, so its
          // header keeps just 清空 instead of three dead buttons.
          const labels = new Set();
          for (const entry of group.items) {
            for (const option of verdictsOf(entry.item)) labels.add(option.label);
          }
          group.bulk = BULK_LABELS.filter((label) => labels.has(label));
          flat.push({ key: 'g:' + group.key + ':' + offset, kind: 'group', group, top: offset, h: GROUP_H });
          offset += GROUP_H;
          for (const entry of group.items) {
            flat.push({ key: 'r:' + entry.item.id, kind: 'row', item: entry.item, index: entry.index, top: offset, h: ROW_H });
            offset += ROW_H;
          }
        }
        return { groups: gs, flat, total: offset };
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
            setError(body?.error ?? '提交失败');
          }
        } catch (err) {
          setError(err?.code === 'STALE_TOKEN'
            ? '批阅凭证已过期（面板可能重启过），请稍等一秒再点一次；仍失败就重新发起批阅。'
            : String(err?.message ?? err));
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
          setError(err?.code === 'STALE_TOKEN'
            ? '批阅凭证已过期（面板可能重启过），请稍等一秒再点一次；仍失败就重新发起批阅。'
            : String(err?.message ?? err));
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
            item.multiSelect ? h('span', { className: 'brx-multi' }, '多选') : null,
          ),
          item.detail ? h('div', { className: 'brx-detail' }, item.detail) : null,
          h('div', { className: 'brx-line' },
            actions,
            h('textarea', {
              className: 'brx-note',
              placeholder: options.length > 0 ? '备注（可选）' : '填写内容',
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
        (Array.isArray(group.bulk) ? group.bulk : []).map((label) => h('button', {
          key: label,
          type: 'button',
          className: 'brx-btn sm',
          disabled: busy,
          onClick: () => bulkGroup(group.items, label),
        }, '全' + label)),
        h('button', { type: 'button', className: 'brx-btn sm', disabled: busy, onClick: () => clearGroup(group.items) }, '清空'),
      );

      const groupNodes = groups.map((group, groupIndex) => h('div', {
        key: group.key + ':' + groupIndex,
        className: 'brx-group',
      },
        h('div', { className: 'brx-group-hd' },
          h('span', {}, h('b', {}, group.key), group.items.length + ' 条'),
          groupActions(group),
        ),
        group.items.map(({ item, index }) => rowNode(item, index)),
      ));

      // Above this many rows, render only the visible window. Below it the
      // classic grouped render stays, so small batches look exactly as before.
      const virtualMode = items.length > VIRTUAL_THRESHOLD;

      const virtualList = () => {
        const from = scrollTop - OVERSCAN_PX;
        const to = scrollTop + viewportH + OVERSCAN_PX;
        const visible = model.flat.filter((entry) => entry.top + entry.h >= from && entry.top <= to);
        const rendered = visible.map((entry) => h('div', {
          key: entry.key,
          className: 'brx-vitem',
          style: { position: 'absolute', top: entry.top, left: 0, right: 0, height: entry.h },
        }, entry.kind === 'group'
          ? h('div', { className: 'brx-group-hd' },
              h('span', {}, h('b', {}, entry.group.key), entry.group.items.length + ' 条'),
              groupActions(entry.group),
            )
          : rowNode(entry.item, entry.index)));

        return h('div', { className: 'brx-list virtual', onScroll: onListScroll },
          h('div', { className: 'brx-vlist', style: { height: model.total } }, rendered));
      };

      return h('div', { className: 'brx-card' },
        h('div', { className: 'brx-hd' },
          h('div', { style: { minWidth: 0 } },
            h('h3', { className: 'brx-title' }, pending.title || '批阅'),
            h('p', { className: 'brx-sub' }, '一次问完 · 逐条作答 · 共 ' + items.length + ' 条'),
            h('div', { className: 'brx-progress' },
              h('i', { style: { width: (items.length === 0 ? 0 : Math.round((filled / items.length) * 100)) + '%' } }),
            ),
          ),
        ),
        items.length >= 50
          ? h('div', { className: 'brx-hint' },
              '共 ' + items.length + ' 条，逐条作答会很慢；建议改用 CSV/Excel 批量填写（技能里的 build_review.py --format csv）。')
          : null,
        virtualMode ? virtualList() : h('div', { className: 'brx-list' }, groupNodes),
        error !== '' ? h('div', { className: 'brx-err' }, error) : null,
        h('div', { className: 'brx-ft' },
          h('span', { className: 'brx-stat' }, '已填 ' + filled + ' / ' + items.length + ' · 未填不当作通过'),
          h('div', { style: { display: 'flex', gap: 8 } },
            h('button', { type: 'button', className: 'brx-btn', disabled: busy, onClick: cancel }, '跳过'),
            h('button', {
              type: 'button',
              className: 'brx-btn on',
              disabled: busy,
              onClick: submit,
            }, busy ? '提交中…' : '提交'),
          ),
        ),
      );
    }

    /** Settings page: frequent tunables stay visible, the rest hides behind 高级设置. */
    const BASIC_FIELDS = [
      { key: 'panelThreshold', label: '面板阈值', hint: '条目数 ≥ 这个值时走插件面板，否则走原生卡片' },
      { key: 'maxItems', label: '单次条目上限', hint: '超过直接驳回，要求拆成多批' },
      { key: 'panelTimeoutMs', label: '等待上限（毫秒）', hint: '等人工作答的最长时间' },
    ];
    const ADVANCED_FIELDS = [
      { key: 'virtualThreshold', label: '虚拟滚动阈值', hint: '条目数超过该值时启用虚拟滚动' },
      { key: 'maxBodyBytes', label: '请求体上限（字节）', hint: '大批次提交的体积上限' },
    ];

    function SettingsTab() {
      const [state, setState] = React.useState({
        loading: true, error: '', config: {}, defaults: {}, limits: {}, path: '',
      });
      const [draft, setDraft] = React.useState({});
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
          })
          .catch((error) => {
            if (!alive) return;
            setState((prev) => ({ ...prev, loading: false, error: String(error?.message ?? error) }));
          });
        return () => { alive = false; };
      }, []);

      const save = () => {
        setBusy(true);
        setNote('');
        request('config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(draft),
        })
          .then((body) => {
            const next = body.config ?? draft;
            setState((prev) => ({ ...prev, config: next }));
            setDraft(next);
            setNote('已保存，立即生效');
          })
          .catch((error) => setNote('保存失败：' + String(error?.message ?? error)))
          .finally(() => setBusy(false));
      };

      if (state.loading) return h('div', { className: 'brx-set' }, '读取配置…');
      if (state.error !== '') {
        return h('div', { className: 'brx-set' }, h('div', { className: 'brx-err' }, state.error));
      }

      const fieldRow = (field) => {
        const limit = state.limits?.[field.key] ?? {};
        const range = limit.min === undefined ? '' : '（' + limit.min + '–' + limit.max + '）';
        return h('label', { key: field.key, className: 'brx-set-row' },
          h('span', { className: 'brx-set-k' }, field.label),
          h('input', {
            type: 'number',
            className: 'brx-set-in',
            min: limit.min,
            max: limit.max,
            value: draft[field.key] ?? '',
            disabled: busy,
            onChange: (event) => setDraft((prev) => ({ ...prev, [field.key]: Number(event.target.value) })),
          }),
          h('span', { className: 'brx-set-d' }, field.hint + range),
        );
      };

      return h('div', { className: 'brx-set' },
        h('p', { className: 'brx-set-hd' },
          '批阅面板的运行时参数。保存后立即生效，并写入 ' + (state.path || '配置文件') + '。'),
        BASIC_FIELDS.map(fieldRow),
        h('button', {
          type: 'button',
          className: 'brx-set-toggle',
          disabled: busy,
          onClick: () => setAdvanced((prev) => !prev),
        }, advanced ? '收起高级设置' : '高级设置'),
        advanced
          ? h('div', { className: 'brx-set-adv' },
              h('p', { className: 'brx-set-hd' }, '以下参数一般不需要改，调整前请确认影响。'),
              ADVANCED_FIELDS.map(fieldRow),
              h('label', { className: 'brx-set-row' },
                h('span', { className: 'brx-set-k' }, '允许把结果存到工作目录之外'),
                h('input', {
                  type: 'checkbox',
                  checked: draft.allowExternalPersist === true,
                  disabled: busy,
                  onChange: (event) => setDraft((prev) => ({ ...prev, allowExternalPersist: event.target.checked })),
                }),
                h('span', { className: 'brx-set-d' },
                  'agent 的 persist 参数默认只能写当前工作目录内；开启后允许任意路径。一般保持关闭。'),
              ),
            )
          : null,
        h('div', { className: 'brx-set-ft' },
          note !== '' ? h('span', { className: 'brx-set-note' }, note) : h('span'),
          h('button', {
            type: 'button',
            className: 'brx-btn',
            disabled: busy,
            onClick: () => { setDraft(state.config ?? {}); setNote(''); },
          }, '重置'),
          h('button', {
            type: 'button',
            className: 'brx-btn on',
            disabled: busy,
            onClick: save,
          }, busy ? '保存中…' : '保存'),
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => installStyles());
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
            label: () => '批阅面板',
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
