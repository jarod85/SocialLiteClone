/**
 * Decides whether a path on the platform's site is allowed, blocked or
 * redirected. The same compiled code runs in the app (for full page loads seen
 * by onShouldStartLoadWithRequest) and in the page (for single-page-app
 * navigation that never reaches the app), so both layers always agree.
 */
import { isActive, type RouteRule, type Toggles } from './types';
import { normalizePath, parseQuery, parseUrl } from './urls';

export type RouteDecision =
  | { type: 'allow' }
  | { type: 'block'; ruleId: string }
  | { type: 'redirect'; ruleId: string; to: string };

export interface CompiledRoutes {
  neverBlock: RegExp[];
  routes: { rule: RouteRule; patterns: RegExp[] }[];
}

/** Characters allowed in a path glob. Anything else is rejected when rules are validated. */
export const PATH_PATTERN_CHARS = /^\/[A-Za-z0-9_\-.~*/%@]*$/;

/**
 * Compile a path glob to an anchored, case-insensitive regex.
 *   `*`  matches exactly one segment     ('/reel/*'   -> '/reel/ABC')
 *   `**` matches zero or more segments   ('/reels/**' -> '/reels', '/reels/x/y')
 *   `a*` matches within a segment        ('/reel*'    -> '/reels')
 * Patterns are matched against normalizePath() output, so trailing slashes don't matter.
 */
export function compilePathPattern(pattern: string): RegExp {
  let source = '^';
  for (const segment of pattern.split('/').filter(Boolean)) {
    if (segment === '**') source += '(?:/[^/]+)*';
    else if (segment === '*') source += '/[^/]+';
    else source += `/${segment.split('*').map(escapeRegExp).join('[^/]*')}`;
  }
  return new RegExp(`${source}$`, 'i');
}

export function compileRoutes(routes: readonly RouteRule[], neverBlock: readonly string[]): CompiledRoutes {
  return {
    neverBlock: neverBlock.map(compilePathPattern),
    routes: routes.map((rule) => ({ rule, patterns: rule.paths.map(compilePathPattern) })),
  };
}

export function pathMatches(path: string, patterns: readonly RegExp[]): boolean {
  const normalized = normalizePath(path);
  return patterns.some((p) => p.test(normalized));
}

/**
 * First matching active rule wins. `neverBlock` paths are always allowed, so a
 * bad rule can never lock you out of login, 2FA or your messages.
 */
export function decideRoute(path: string, query: string, compiled: CompiledRoutes, toggles: Toggles): RouteDecision {
  const normalized = normalizePath(path);
  if (compiled.neverBlock.some((p) => p.test(normalized))) return { type: 'allow' };

  for (const { rule, patterns } of compiled.routes) {
    if (!isActive(rule, toggles)) continue;
    if (!patterns.some((p) => p.test(normalized))) continue;
    if (rule.action === 'block') return { type: 'block', ruleId: rule.id };
    if (rule.to !== undefined && !redirectSatisfied(normalized, query, rule.to)) {
      return { type: 'redirect', ruleId: rule.id, to: rule.to };
    }
  }
  return { type: 'allow' };
}

/**
 * A redirect is already satisfied when we're on its target path and every query
 * parameter it sets is present. This keeps '/' -> '/?variant=following' from looping.
 */
function redirectSatisfied(normalizedPath: string, query: string, to: string): boolean {
  const target = parseUrl(`x://h${to.startsWith('/') ? '' : '/'}${to}`);
  if (!target || normalizePath(target.path).toLowerCase() !== normalizedPath.toLowerCase()) return false;
  const have = parseQuery(query);
  for (const [key, value] of parseQuery(target.query)) {
    if (have.get(key) !== value) return false;
  }
  return true;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
