/**
 * User-editable tunables for `batch_review`.
 *
 * Precedence (lowest to highest):
 *
 *   1. the built-in defaults below;
 *   2. the cordis `config` block, i.e. whatever the profile's `cordis.patch.yml`
 *      pins for this plugin;
 *   3. the JSON file written by the Settings → Plugins → 批阅面板 tab.
 *
 * The file exists because the cordis block can only be edited by hand, followed
 * by a restart. It lives in the DSH home (`DSH_HOME` when the host exports it,
 * otherwise `~/.dsh`) so a plugin update does not wipe it.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

/** Defaults are part of the public contract: the settings tab shows them. */
export const DEFAULTS = Object.freeze({
  panelThreshold: 2,
  maxItems: 100,
  virtualThreshold: 500,
  panelTimeoutMs: 15 * 60 * 1000,
  maxBodyBytes: 64 * 1024 * 1024,
  allowExternalPersist: false,
});

/** Hard bounds, also shown by the settings tab. Out-of-range values are errors. */
export const LIMITS = Object.freeze({
  panelThreshold: { min: 1, max: 100 },
  // 500 items is already 1-2 hours of human review; a higher ceiling has no use.
  maxItems: { min: 1, max: 500 },
  // Past ~2000 rows the DOM cost is the reason to virtualise, not a knob to raise.
  virtualThreshold: { min: 1, max: 2000 },
  panelTimeoutMs: { min: 1000, max: 24 * 60 * 60 * 1000 },
  // A 100k-item review measured 19.46 MB; 128 MB keeps a 6x margin.
  maxBodyBytes: { min: 1024, max: 128 * 1024 * 1024 },
});

const NUMERIC = ['panelThreshold', 'maxItems', 'virtualThreshold', 'panelTimeoutMs', 'maxBodyBytes'];

/** Absolute path of the user's settings file. */
export function configPath(env = process.env) {
  const configured = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
  const home = configured !== '' ? configured : join(homedir(), '.dsh');
  return join(home, 'dsh-batch-review.config.json');
}

function readNumber(key, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const rounded = Math.floor(n);
  const { min, max } = LIMITS[key];
  if (rounded < min || rounded > max) return undefined;
  return rounded;
}

/**
 * Validate a partial config. Unknown keys are ignored; bad values are reported
 * rather than silently clamped, so the settings tab can say what is wrong.
 */
export function normalize(raw) {
  const src = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const values = {};
  const errors = [];
  for (const key of NUMERIC) {
    if (src[key] === undefined || src[key] === null || src[key] === '') continue;
    const value = readNumber(key, src[key]);
    if (value === undefined) {
      const { min, max } = LIMITS[key];
      errors.push(`${key} 必须是 ${min}–${max} 之间的整数`);
    } else {
      values[key] = value;
    }
  }
  if (src.allowExternalPersist !== undefined && src.allowExternalPersist !== null) {
    if (typeof src.allowExternalPersist === 'boolean') values.allowExternalPersist = src.allowExternalPersist;
    else errors.push('allowExternalPersist 必须是 true / false');
  }
  return { values, errors };
}

/** Read the settings file; a missing or corrupt file is simply empty. */
export function readFileConfig(filePath = configPath()) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return normalize(parsed).values;
  } catch {
    return {};
  }
}

/** Merge `values` into the settings file, writing atomically. */
export function writeFileConfig(values, filePath = configPath()) {
  const next = { ...readFileConfig(filePath), ...values };
  const temp = filePath + '.tmp';
  writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  renameSync(temp, filePath);
  return next;
}

/** Defaults < cordis config < settings file. */
export function resolveConfig(cordisConfig, filePath = configPath()) {
  return {
    ...DEFAULTS,
    ...normalize(cordisConfig).values,
    ...readFileConfig(filePath),
  };
}
