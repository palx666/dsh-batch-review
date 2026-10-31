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
.brx-title{margin:0;font-size:15px;font-weight:500;line-height:22px}
.brx-sub{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.brx-progress{height:4px;border-radius:4px;background:var(--dsw-alias-bg-overlay);overflow:hidden;margin-top:8px}
.brx-progress i{display:block;height:100%;background:var(--dsw-alias-state-business-primary);transition:width .15s}
.brx-list{overflow-y:auto;padding:6px 8px;display:flex;flex-direction:column;gap:2px}
.brx-row{padding:10px 10px 8px;border-radius:var(--dsw-radius-md);border:1px solid transparent}
.brx-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.brx-row-t{display:flex;gap:8px;align-items:baseline;font-size:14px;line-height:22px}
.brx-multi{margin-left:6px;padding:0 5px;border-radius:4px;background:var(--dsw-alias-bg-overlay);
  color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;align-self:center}
.brx-num{flex:0 0 auto;min-width:20px;text-align:right;color:var(--dsw-alias-label-tertiary);font-size:12px}
.brx-detail{margin:2px 0 0 28px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.brx-line{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:8px 0 0 28px}
.brx-acts{display:flex;flex-wrap:nowrap;gap:4px;margin:0;overflow-x:auto;padding-bottom:2px}
.brx-btn{box-sizing:border-box;min-height:26px;padding:0 9px;border-radius:6px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);
  font:inherit;font-size:11px;line-height:1;white-space:nowrap;flex:0 0 auto}
.brx-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.brx-btn.on{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.brx-btn.pass.on{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.brx-btn.fail.on{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.brx-note{box-sizing:border-box;flex:1 1 160px;min-width:120px;min-height:26px;margin:0;
  padding:5px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-module-platform);color:inherit;font:inherit;font-size:12px;resize:vertical}
.brx-note:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.brx-ft{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1)}
.brx-stat{font-size:12px;color:var(--dsw-alias-label-secondary)}
.brx-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;padding:0 16px 8px}
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

    async function request(name, init) {
      if (typeof fetch !== 'function') throw new Error('fetch unavailable');
      const base = document.baseURI ?? document.location?.href ?? '/';
      const url = new URL(ROUTE + name, base).toString();
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller === null ? null : setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          cache: 'no-store',
          credentials: 'same-origin',
          ...init,
          signal: controller?.signal,
        });
        const text = await response.text();
        const body = text === '' ? {} : JSON.parse(text);
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
        const tone = label === '通过' || label === '是'
          ? 'pass'
          : label === '不通过' || label === '否'
            ? 'fail'
            : label === '待定' || label === '未测'
              ? 'skip'
              : 'choice';
        return { label, tone };
      });
    }

    /** Choice options get A/B/C prefixes; fixed verdict/bool/scale sets do not. */
    function isChoiceSet(options) {
      const labels = options.map((option) => String(option.label ?? ''));
      if (labels.length <= 3 && labels.every((label) => label === '通过' || label === '不通过' || label === '待定')) return false;
      if (labels.every((label) => label === '是' || label === '否')) return false;
      return !labels.every((label) => /^\d+$/.test(label));
    }

    function ReviewPanel() {
      const [view, setView] = React.useState({ pending: null, available: false });
      const [draft, setDraft] = React.useState({});
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');

      React.useEffect(() => {
        let alive = true;
        let timer = null;
        const poll = async () => {
          let pending = null;
          try {
            const body = await request('state');
            if (!alive) return;
            setView({ pending: body.pending ?? null, available: body.available === true });
            pending = body.pending ?? null;
          } catch {
            if (alive) setView({ pending: null, available: false });
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

      // A new review resets the draft; the panel is keyed by review id.
      React.useEffect(() => {
        setDraft({});
        setError('');
        setBusy(false);
      }, [pending === null ? '' : pending.id]);

      if (pending === null) return null;

      const items = Array.isArray(pending.items) ? pending.items : [];
      const filled = items.filter((item) => {
        const entry = draft[item.id] ?? {};
        const selected = Array.isArray(entry.selected) ? entry.selected : [];
        return selected.length > 0 || (entry.note ?? '').trim() !== '';
      }).length;

      const setVerdict = (id, label, multi) => {
        setDraft((prev) => {
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
        setDraft((prev) => ({ ...prev, [id]: { ...prev[id], note } }));
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
            setView({ pending: null, available: true });
            setDraft({});
          } else {
            setError(body?.error ?? '提交失败');
          }
        } catch (err) {
          setError(String(err?.message ?? err));
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
          setView({ pending: null, available: true });
          setDraft({});
        } catch (err) {
          setError(String(err?.message ?? err));
        } finally {
          setBusy(false);
        }
      };

      const rows = items.map((item, index) => {
        const options = verdictsOf(item);
        const entry = draft[item.id] ?? {};
        const selected = Array.isArray(entry.selected) ? entry.selected : [];
        const numbered = isChoiceSet(options);
        return h('div', { key: item.id, className: 'brx-row' },
          h('div', { className: 'brx-row-t' },
            h('span', { className: 'brx-num' }, String(index + 1)),
            h('span', {}, item.question ?? String(item.id)),
            item.multiSelect ? h('span', { className: 'brx-multi' }, '多选') : null,
          ),
          item.detail ? h('div', { className: 'brx-detail' }, item.detail) : null,
          h('div', { className: 'brx-line' },
            options.length > 0
              ? h('div', { className: 'brx-acts' },
                  options.map((option, optionIndex) => h('button', {
                    key: option.label,
                    type: 'button',
                    className: 'brx-btn ' + option.tone + (selected.includes(option.label) ? ' on' : ''),
                    disabled: busy,
                    onClick: () => setVerdict(item.id, option.label, item.multiSelect === true),
                  }, numbered ? String.fromCharCode(65 + optionIndex) + '. ' + option.label : option.label)),
                )
              : null,
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
      });

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
        h('div', { className: 'brx-list' }, rows),
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
      },
    };
  },
});
