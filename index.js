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
import { DEFAULTS, LIMITS, configPath, normalize, resolveConfig, writeFileConfig } from './lib/config.js';

/** Services this plugin needs from the host. `webServer` is optional. */
export const inject = ['tools', 'userQuestions', 'skills'];

export function apply(ctx, rawConfig) {
  /** Defaults < cordis config < settings file; the section mutates this in place. */
  const settingsFile = configPath();
  const { errors: cordisErrors } = normalize(rawConfig);
  if (cordisErrors.length > 0) {
    // A typo in the profile patch used to be dropped without a trace: the value
    // silently fell back to the default while the operator believed it applied.
    ctx.logger?.warn?.('dsh-batch-review: cordis config 值非法已忽略：' + cordisErrors.join('；'));
  }
  const config = resolveConfig(rawConfig, settingsFile);
  const panel = new BatchReviewPanel({
    logger: ctx.logger,
    timeoutMs: config.panelTimeoutMs,
    maxBodyBytes: config.maxBodyBytes,
    virtualThreshold: config.virtualThreshold,
    // The Settings → left-nav ［批阅面板］ section reads and writes these through
    // GET/POST /config.
    settings: {
      path: settingsFile,
      defaults: DEFAULTS,
      limits: LIMITS,
      config,
      save(patch) {
        // The settings page reports its UI language on every request, so a bad
        // value is reported in the language the owner is reading.
        const { values, errors, removals } = normalize(patch, panel.locale);
        if (errors.length > 0) {
          const error = new Error(errors.join('；'));
          error.status = 400;
          throw error;
        }
        // Only the keys the page actually changed arrive here (null = drop the
        // stored override), so saving one field no longer freezes every other
        // tunable at its resolved value and silently shadows the cordis layer.
        const next = { ...values };
        for (const key of removals) next[key] = null;
        writeFileConfig(next, settingsFile);
        Object.assign(config, resolveConfig(rawConfig, settingsFile));
        // Panel-side tunables live on the instance, so apply them now instead of
        // asking for a restart.
        panel.timeoutMs = config.panelTimeoutMs;
        panel.maxBodyBytes = config.maxBodyBytes;
        panel.virtualThreshold = config.virtualThreshold;
        return { ...config };
      },
    },
  });

  ctx.effect(() => {
    const dispose = ctx.tools.register(makeBatchReviewTool(ctx, { panel, config }));
    return () => dispose();
  });

  ctx.effect(() => {
    const dispose = registerSkill(ctx);
    return () => dispose();
  });

  // Routing rule as a prompt section: present on every request, so other users do
  // not have to copy an AGENTS.md rule by hand. Optional — a composition without
  // the systemPrompt service still gets the tool and the skill. Users who prefer
  // to own the rule can switch it off with `injectRoutingRule: false`; the section
  // is registered at apply time, so the change takes a restart.
  ctx.effect(() => {
    if (config.injectRoutingRule === false) return () => {};
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
