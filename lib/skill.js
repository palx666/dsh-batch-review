/**
 * The bundled `batch-review-table` skill.
 *
 * The package ships the skill under `skills/batch-review-table/` and registers it
 * through `ctx.skills.registerProvider()`, so one `dsh plugin add` installs both
 * the `batch_review` tool and the routing skill behind it. The provider reads the
 * Markdown at load time; the resource base points at the skill directory so the
 * model can resolve `scripts/…` and `assets/…` relative paths.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const SKILL_NAME = 'batch-review-table';

const PROVIDER_NAME = 'batch-review';
const SKILL_DIR_URL = new URL('../skills/batch-review-table/', import.meta.url);
const SKILL_MD_URL = new URL('SKILL.md', SKILL_DIR_URL);

const DESCRIPTION =
  'Use whenever the user owes a decision — anything where they must confirm, choose, approve, ' +
  'reject, rate, or comment, on one item or many. Skip only when the user owes no decision ' +
  '(pure information, authoring, or explanation requests).';

const CANDIDATE = {
  name: SKILL_NAME,
  description: DESCRIPTION,
  invocation: { modelInvocable: true, userInvocable: true },
  provider: PROVIDER_NAME,
  source: 'bundled',
  // 250 sits above the user skill roots (400/500) so an installed plugin wins over a
  // stale hand-copied ~/.dsh/skills copy; project roots (100/200) still win.
  rank: 250,
  resourceBase: { kind: 'directory', path: fileURLToPath(SKILL_DIR_URL) },
};

/** Strip the YAML frontmatter: the registry already has name and description. */
function stripFrontmatter(text) {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return text;
  const after = text.indexOf('\n', end + 4);
  return after === -1 ? '' : text.slice(after + 1);
}

export function skillProvider() {
  return {
    name: PROVIDER_NAME,
    list: () => Promise.resolve([{ ...CANDIDATE }]),
    async get() {
      const raw = await readFile(SKILL_MD_URL, 'utf8');
      return { ...CANDIDATE, content: stripFrontmatter(raw) };
    },
  };
}

/**
 * Register the bundled skill on the host skill registry.
 *
 * @param ctx host context carrying `skills`
 * @returns the disposer that removes the provider again
 */
export function registerSkill(ctx) {
  return ctx.skills.registerProvider(() => skillProvider());
}
