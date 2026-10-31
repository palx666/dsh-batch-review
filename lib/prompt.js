/**
 * The system-prompt section that ships the routing rule with the plugin.
 *
 * The skill covers the same ground for models that load it, but a skill is
 * discovered per session and can be skipped; a prompt section is always present.
 * Keeping it to three sentences is deliberate — it is paid on every request, so
 * it must only say what changes behaviour, not repeat the tool description.
 */

export const PROMPT_SECTION = 'dsh-batch-review:routing';

export const PROMPT_TEXT = [
  'When the user owes a decision — confirming, choosing, approving, reviewing, rating,',
  'commenting — give them a clickable surface instead of prose.',
  'Use batch_review when two or more items need independent verdicts in one round;',
  'use ask_user_question for a single question or plan approval.',
  'An unanswered item is not an approval: follow it up, never assume it passed.',
].join(' ');

/**
 * Register the section on the host prompt assembly.
 *
 * @param ctx host context; `systemPrompt` is optional, so a composition without it
 *   still gets the tool and the skill.
 * @returns the disposer that removes the section again, or undefined
 */
export function registerPrompt(ctx) {
  let dispose = null;
  try {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      dispose = promptCtx.systemPrompt.section({
        name: PROMPT_SECTION,
        order: 50,
        text: PROMPT_TEXT,
      });
      return () => {
        try {
          dispose?.();
        } catch {
          /* unloading must not throw */
        }
        dispose = null;
      };
    });
  } catch (error) {
    ctx.logger?.warn?.(`dsh-batch-review: prompt section not registered: ${String(error?.message ?? error)}`);
    return undefined;
  }
  return () => {
    try {
      dispose?.();
    } catch {
      /* unloading must not throw */
    }
    dispose = null;
  };
}
