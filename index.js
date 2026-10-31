/**
 * dsh-batch-review — host half.
 *
 * Registers two things with the host:
 *
 * 1. the `batch_review` tool — the agent hands over N items, they are mapped onto
 *    `AskUserQuestionItem[]` and answered through `ctx.userQuestions.ask()`, so the
 *    host renders its own question cards (no added UI, no browser page, no local
 *    HTTP service), and the answers come back as one structured result;
 * 2. the `batch-review-table` skill — the decision-channel routing rules and the
 *    HTML fallback that ships in `skills/`.
 *
 * See `lib/tool.js` for the mapping/report helpers and `lib/skill.js` for the
 * skill provider.
 */

import { makeBatchReviewTool } from './lib/tool.js';
import { registerSkill } from './lib/skill.js';

/** Services this plugin needs from the host. */
export const inject = ['tools', 'userQuestions', 'skills'];

export function apply(ctx) {
  ctx.effect(() => {
    const dispose = ctx.tools.register(makeBatchReviewTool(ctx));
    return () => dispose();
  });

  ctx.effect(() => {
    const dispose = registerSkill(ctx);
    return () => dispose();
  });
}
