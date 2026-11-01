/**
 * dsh-batch-review — host half.
 *
 * Registers three things with the host:
 *
 * 1. the `batch_review` tool — the agent hands over N items; they are answered
 *    either through the paged native card (`ctx.userQuestions.ask()`) or, when
 *    the review is large enough and the client panel is mounted, through the
 *    one-screen panel (`lib/panel.js` + `lib/client.js`);
 * 2. the panel's HTTP surface under `/api/batch-review` (only when the host
 *    exposes `webServer` — leaner compositions fall back to the native card);
 * 3. the `batch-review-table` skill — the routing rules and the HTML fallback
 *    that ships in `skills/`.
 *
 * See `lib/tool.js` for the mapping/report helpers and `lib/skill.js` for the
 * skill provider.
 */

import { makeBatchReviewTool } from './lib/tool.js';
import { registerSkill } from './lib/skill.js';
import { BatchReviewPanel } from './lib/panel.js';
import { registerPrompt } from './lib/prompt.js';

/** Services this plugin needs from the host. `webServer` is optional. */
export const inject = ['tools', 'userQuestions', 'skills'];

/**
 * Tunables, overridable per profile in `cordis.patch.yml` under the plugin's
 * `config` key. `maxItems` is a rejection rule, not a rendering limit: reviews
 * above it are refused so the caller splits the batch instead of asking the
 * user to click through a wall of rows.
 */
const DEFAULTS = {
  panelThreshold: 2,
  maxItems: 100,
  virtualThreshold: 500,
  panelTimeoutMs: 15 * 60 * 1000,
  maxBodyBytes: 64 * 1024 * 1024,
};

function readConfig(raw) {
  const src = raw !== null && typeof raw === 'object' ? raw : {};
  const num = (value, fallback, min) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
  };
  return {
    panelThreshold: num(src.panelThreshold, DEFAULTS.panelThreshold, 1),
    maxItems: num(src.maxItems, DEFAULTS.maxItems, 1),
    virtualThreshold: num(src.virtualThreshold, DEFAULTS.virtualThreshold, 1),
    panelTimeoutMs: num(src.panelTimeoutMs, DEFAULTS.panelTimeoutMs, 1000),
    maxBodyBytes: num(src.maxBodyBytes, DEFAULTS.maxBodyBytes, 1024),
  };
}

export function apply(ctx, rawConfig) {
  const config = readConfig(rawConfig);
  const panel = new BatchReviewPanel({
    logger: ctx.logger,
    timeoutMs: config.panelTimeoutMs,
    maxBodyBytes: config.maxBodyBytes,
    virtualThreshold: config.virtualThreshold,
  });

  ctx.effect(() => {
    const dispose = ctx.tools.register(makeBatchReviewTool(ctx, {
      panel,
      panelThreshold: config.panelThreshold,
      maxItems: config.maxItems,
    }));
    return () => dispose();
  });

  ctx.effect(() => {
    const dispose = registerSkill(ctx);
    return () => dispose();
  });

  // Routing rule as a prompt section: present on every request, so other users do
  // not have to copy an AGENTS.md rule by hand. Optional — a composition without
  // the systemPrompt service still gets the tool and the skill.
  ctx.effect(() => {
    const dispose = registerPrompt(ctx);
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  });

  // The panel is an optional surface: without a web server the native card still
  // works, and `panel.available()` stays false so the tool never waits for it.
  try {
    ctx.inject(['webServer'], (webCtx) => {
      const disposers = panel.routes().map((definition) => webCtx.webServer.register(definition));
      return () => {
        for (const dispose of disposers) {
          try {
            dispose?.();
          } catch {
            /* unloading must not throw */
          }
        }
      };
    });
  } catch (error) {
    ctx.logger?.warn?.(`dsh-batch-review: panel routes not registered: ${String(error?.message ?? error)}`);
  }
}
