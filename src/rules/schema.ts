/**
 * Validates and sanitizes a rules file before anything uses it, whether it's
 * the bundled copy, a cached copy or a fresh download.
 *
 * Structure errors at the top level reject the whole file (the app keeps its
 * current rules). Problems inside a single rule only drop that rule or
 * selector, so one typo in a remote update can't switch off all blocking.
 */
import { z } from 'zod';

import { PATH_PATTERN_CHARS } from '@/core/routeMatcher';
import {
  ENGINE_VERSION,
  type FeedLimitRule,
  type HideRule,
  type PlatformRules,
  type RouteRule,
  type RulesFile,
  type TextHideRule,
} from '@/core/types';

export type ValidationResult = { ok: true; rules: RulesFile; warnings: string[] } | { ok: false; error: string };

const MAX_RULES = 200;
const MAX_ITEMS = 50;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const toggle = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional();
const pathPattern = z.string().max(200).regex(PATH_PATTERN_CHARS);
const label = z
  .string()
  .max(80)
  .transform((s) => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' '));
const text = z.string().min(1).max(80);
const mode = z.enum(['hide', 'collapse']).optional();

/**
 * A selector is only ever placed in front of a declaration block the app writes
 * itself. Blocking braces, semicolons, at-signs, backslashes (CSS escapes could
 * spell braces) and comments means a selector can't open its own block, so it
 * can't add declarations like background:url(...) that would send page data
 * anywhere. '<' never appears in a valid selector and is rejected as defence in
 * depth ('>' is the child combinator, so it stays).
 */
export function isSafeSelector(selector: string): boolean {
  return (
    selector.trim().length > 0 &&
    selector.length <= 300 &&
    !/[{};@\\<]/.test(selector) &&
    !/\/\*|\*\//.test(selector) &&
    !/url\s*\(/i.test(selector)
  );
}

/** Redirect targets stay on the platform's own site: a plain path with an optional simple query. */
const redirectTarget = z.string().regex(/^\/(?!\/)[A-Za-z0-9_\-.~/%]*(\?[A-Za-z0-9_\-.~%=&]*)?$/);

const routeSchema = z
  .object({
    id,
    toggle,
    unless: toggle,
    paths: z.array(z.unknown()).max(MAX_ITEMS),
    action: z.enum(['block', 'redirect']),
    to: redirectTarget.optional(),
  })
  .refine((r) => r.action !== 'redirect' || r.to !== undefined, { message: 'redirect needs "to"' });

const hideSchema = z.object({
  id,
  toggle,
  unless: toggle,
  selectors: z.array(z.unknown()).max(MAX_ITEMS),
  mode,
  label: label.optional(),
  paths: z.array(z.unknown()).max(MAX_ITEMS).optional(),
});

const textHideSchema = z.object({
  id,
  toggle,
  unless: toggle,
  match: z.array(text).min(1).max(MAX_ITEMS),
  containers: z.array(z.unknown()).max(MAX_ITEMS),
  mode,
  label: label.optional(),
  paths: z.array(z.unknown()).max(MAX_ITEMS).optional(),
});

const feedLimitSchema = z.object({
  id,
  toggle: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  itemSelector: z.string().refine(isSafeSelector),
  paths: z.array(pathPattern).min(1).max(MAX_ITEMS),
});

const platformSchema = z.object({
  routes: z.array(z.unknown()).max(MAX_RULES).default([]),
  hide: z.array(z.unknown()).max(MAX_RULES).default([]),
  textHide: z.array(z.unknown()).max(MAX_RULES).default([]),
  feedLimit: z.unknown().optional(),
});

const fileSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  updated: z.string().max(40),
  minEngineVersion: z.number().int().positive(),
  platforms: z.record(id, z.unknown()),
});

export function validateRules(input: unknown): ValidationResult {
  const file = fileSchema.safeParse(input);
  if (!file.success) return { ok: false, error: `Invalid rules file: ${file.error.issues[0]?.message ?? 'unknown'}` };
  if (file.data.minEngineVersion > ENGINE_VERSION) {
    return { ok: false, error: `Rules need engine v${file.data.minEngineVersion}; this app has v${ENGINE_VERSION}. Update the app.` };
  }

  const warnings: string[] = [];
  const platforms: Record<string, PlatformRules> = {};
  for (const [platformId, raw] of Object.entries(file.data.platforms)) {
    const parsed = platformSchema.safeParse(raw);
    if (!parsed.success) {
      warnings.push(`${platformId}: skipped (invalid structure)`);
      continue;
    }
    const warn = (msg: string) => warnings.push(`${platformId}: ${msg}`);
    platforms[platformId] = {
      routes: collect(parsed.data.routes, (r) => sanitizeRoute(r, warn)),
      hide: collect(parsed.data.hide, (r) => sanitizeHide(r, warn)),
      textHide: collect(parsed.data.textHide, (r) => sanitizeTextHide(r, warn)),
      feedLimit: sanitizeFeedLimit(parsed.data.feedLimit, warn),
    };
  }

  return {
    ok: true,
    warnings,
    rules: {
      schemaVersion: 1,
      revision: file.data.revision,
      updated: file.data.updated,
      minEngineVersion: file.data.minEngineVersion,
      platforms,
    },
  };
}

function collect<T>(items: unknown[], sanitize: (item: unknown) => T | null): T[] {
  return items.map(sanitize).filter((x): x is T => x !== null);
}

function sanitizeRoute(raw: unknown, warn: (msg: string) => void): RouteRule | null {
  const r = routeSchema.safeParse(raw);
  if (!r.success) return reject(raw, warn);
  const paths = keepValid(r.data.paths, isPathPattern, r.data.id, 'path', warn);
  if (paths.length === 0) return reject(raw, warn, 'no valid paths');
  return { id: r.data.id, toggle: r.data.toggle, unless: r.data.unless, action: r.data.action, paths, to: r.data.to };
}

function sanitizeHide(raw: unknown, warn: (msg: string) => void): HideRule | null {
  const r = hideSchema.safeParse(raw);
  if (!r.success) return reject(raw, warn);
  const selectors = keepValid(r.data.selectors, isSelector, r.data.id, 'selector', warn);
  if (selectors.length === 0) return reject(raw, warn, 'no valid selectors');
  const paths = r.data.paths && keepValid(r.data.paths, isPathPattern, r.data.id, 'path', warn);
  if (paths && paths.length === 0) return reject(raw, warn, 'no valid paths'); // Never widen a scoped rule to "everywhere".
  return {
    id: r.data.id,
    toggle: r.data.toggle,
    unless: r.data.unless,
    selectors,
    mode: r.data.mode,
    label: r.data.label,
    paths,
  };
}

function sanitizeTextHide(raw: unknown, warn: (msg: string) => void): TextHideRule | null {
  const r = textHideSchema.safeParse(raw);
  if (!r.success) return reject(raw, warn);
  const containers = keepValid(r.data.containers, isSelector, r.data.id, 'container', warn);
  if (containers.length === 0) return reject(raw, warn, 'no valid containers');
  const paths = r.data.paths && keepValid(r.data.paths, isPathPattern, r.data.id, 'path', warn);
  if (paths && paths.length === 0) return reject(raw, warn, 'no valid paths');
  return {
    id: r.data.id,
    toggle: r.data.toggle,
    unless: r.data.unless,
    match: r.data.match,
    containers,
    mode: r.data.mode,
    label: r.data.label,
    paths,
  };
}

function sanitizeFeedLimit(raw: unknown, warn: (msg: string) => void): FeedLimitRule | undefined {
  if (raw === undefined) return undefined;
  const r = feedLimitSchema.safeParse(raw);
  if (!r.success) {
    warn('feedLimit dropped (invalid)');
    return undefined;
  }
  return r.data;
}

function isSelector(value: unknown): value is string {
  return typeof value === 'string' && isSafeSelector(value);
}

function isPathPattern(value: unknown): value is string {
  return pathPattern.safeParse(value).success;
}

function keepValid(
  items: unknown[],
  check: (item: unknown) => item is string,
  ruleId: string,
  kind: string,
  warn: (msg: string) => void,
): string[] {
  const valid = items.filter(check);
  if (valid.length !== items.length) warn(`${ruleId}: dropped ${items.length - valid.length} invalid ${kind}(s)`);
  return valid;
}

function reject(raw: unknown, warn: (msg: string) => void, reason = 'invalid'): null {
  const ruleId = typeof raw === 'object' && raw !== null && 'id' in raw ? String(raw.id) : '?';
  warn(`rule ${ruleId} dropped (${reason})`);
  return null;
}

/** Rules for one platform, or an empty set so the app still works (just unfiltered) if they're missing. */
export function platformRules(rules: RulesFile, platformId: string): PlatformRules {
  return rules.platforms[platformId] ?? { routes: [], hide: [], textHide: [] };
}
