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

    // The dock unmounts when the user opens Settings or switches pages; a
    // component-local draft would silently drop every click. Keep it here,
    // keyed by review id, and restore it when the panel mounts again.
    const draftMemory = { id: null, draft: {} };

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

      // A new review resets the draft; the panel is keyed by review id.
      // A remount of the same review restores whatever was already clicked.
      React.useEffect(() => {
        const id = pending === null ? '' : pending.id;
        if (draftMemory.id === id) {
          setDraft(draftMemory.draft);
        } else {
          draftMemory.id = id;
          draftMemory.draft = {};
          commitDraft({});
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
        for (const group of gs) {
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
          setView((prev) => ({ ...prev, pending: null, available: true }));
          commitDraft({});
        } catch (err) {
          setError(String(err?.message ?? err));
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
                  }, numbered && !/^[A-Za-z][.、．]\s*/.test(option.label) ? String.fromCharCode(65 + optionIndex) + '. ' + option.label : option.label)),
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
      };

      // Group consecutive items by `group` (falling back to the card header). A
      // batch of 100 is workable when it arrives sorted into a handful of groups;
      // a flat list of 100 is not.
      const groups = model.groups;

      const groupNodes = groups.map((group, groupIndex) => h('div', {
        key: group.key + ':' + groupIndex,
        className: 'brx-group',
      },
        h('div', { className: 'brx-group-hd' },
          h('span', {}, h('b', {}, group.key), group.items.length + ' 条'),
          h('div', { className: 'brx-group-acts' },
            h('button', { type: 'button', className: 'brx-btn sm', disabled: busy, onClick: () => bulkGroup(group.items, '通过') }, '全通过'),
            h('button', { type: 'button', className: 'brx-btn sm', disabled: busy, onClick: () => bulkGroup(group.items, '不通过') }, '全不通过'),
            h('button', { type: 'button', className: 'brx-btn sm', disabled: busy, onClick: () => bulkGroup(group.items, '待定') }, '全待定'),
            h('button', { type: 'button', className: 'brx-btn sm', disabled: busy, onClick: () => clearGroup(group.items) }, '清空'),
          ),
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
              h('div', { className: 'brx-group-acts' },
                h('button', { type: 'button', className: 'brx-btn sm', disabled: busy, onClick: () => bulkGroup(entry.group.items, '通过') }, '全通过'),
                h('button', { type: 'button', className: 'brx-btn sm', disabled: busy, onClick: () => bulkGroup(entry.group.items, '不通过') }, '全不通过'),
                h('button', { type: 'button', className: 'brx-btn sm', disabled: busy, onClick: () => bulkGroup(entry.group.items, '待定') }, '全待定'),
                h('button', { type: 'button', className: 'brx-btn sm', disabled: busy, onClick: () => clearGroup(entry.group.items) }, '清空'),
              ),
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
