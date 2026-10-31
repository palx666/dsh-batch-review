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

/** Services this plugin needs from the host. `webServer` is optional. */
export const inject = ['tools', 'userQuestions', 'skills'];

/** Reviews with at least this many items use the panel when it is mounted. */
const PANEL_THRESHOLD = 2;

export function apply(ctx) {
  const panel = new BatchReviewPanel({ logger: ctx.logger });

  ctx.effect(() => {
    const dispose = ctx.tools.register(makeBatchReviewTool(ctx, { panel, panelThreshold: PANEL_THRESHOLD }));
    return () => dispose();
  });

  ctx.effect(() => {
    const dispose = registerSkill(ctx);
    return () => dispose();
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
