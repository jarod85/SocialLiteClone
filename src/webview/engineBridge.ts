/**
 * App-side half of the page <-> app bridge: builds the scripts we inject and
 * validates what the page posts back.
 */
import type { PlatformConfig } from '@/platforms/types';
import type { EnginePayload, PageMessage, PlatformRules, Toggles } from '@/core/types';
import { ENGINE_SOURCE } from '@/injected/generated/engineSource';

export function buildPayload(
  platform: PlatformConfig,
  rules: PlatformRules,
  toggles: Toggles,
  feedLimit: number,
  homeUrl: string,
): EnginePayload {
  return { siteHosts: platform.siteHosts, homeUrl, neverBlock: platform.neverBlock, rules, toggles, feedLimit };
}

/** JSON is valid JavaScript, so data goes into the page as a literal: no string-building of code. */
function callEngine(method: 'apply' | 'stats' | 'pauseMedia', arg?: unknown): string {
  const args = arg === undefined ? '' : JSON.stringify(arg);
  return `(function(){var e=window.__liteSocial;if(e)e.${method}(${args});})();`;
}

/** Installs the engine (if needed) and applies the payload. Injected before and after each page load. */
export function bootScript(payload: EnginePayload): string {
  return `${ENGINE_SOURCE};\n${callEngine('apply', payload)}\ntrue;`;
}

/** Re-applies changed settings to the current page without reloading it. */
export function applyScript(payload: EnginePayload): string {
  return `${callEngine('apply', payload)}true;`;
}

export function statsScript(requestId: string): string {
  return `${callEngine('stats', requestId)}true;`;
}

export const PAUSE_MEDIA_SCRIPT = `${callEngine('pauseMedia')}true;`;

/**
 * Parse a message from the page. The site's own scripts can call
 * ReactNativeWebView.postMessage too, so anything that isn't exactly one of our
 * message shapes, naming one of our rules, is ignored. A valid message can only
 * show the "blocked" notice or answer a stats request; it can never change settings.
 */
export function parsePageMessage(data: string, knownRuleIds: ReadonlySet<string>): PageMessage | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof message !== 'object' || message === null) return null;
  const m = message as Record<string, unknown>;

  if (m.type === 'blocked') {
    if (typeof m.ruleId !== 'string' || !knownRuleIds.has(m.ruleId)) return null;
    if (typeof m.path !== 'string' || m.path.length > 300) return null;
    return { type: 'blocked', ruleId: m.ruleId, path: m.path };
  }
  if (m.type === 'stats') {
    if (typeof m.requestId !== 'string' || typeof m.counts !== 'object' || m.counts === null) return null;
    const counts: Record<string, number> = {};
    for (const [ruleId, n] of Object.entries(m.counts as Record<string, unknown>)) {
      if (knownRuleIds.has(ruleId) && typeof n === 'number' && Number.isFinite(n)) counts[ruleId] = n;
    }
    return { type: 'stats', requestId: m.requestId, counts };
  }
  return null;
}

export function ruleIds(rules: PlatformRules): Set<string> {
  const ids = new Set<string>();
  for (const r of rules.routes) ids.add(r.id);
  for (const r of rules.hide) ids.add(r.id);
  for (const r of rules.textHide) ids.add(r.id);
  if (rules.feedLimit) ids.add(rules.feedLimit.id);
  return ids;
}
