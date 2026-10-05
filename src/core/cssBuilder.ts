/**
 * Layer 2 of blocking: turns hide rules into a stylesheet.
 *
 * CSS is the first choice for hiding because it applies before the page
 * paints (no flash), costs nothing per DOM change, and keeps working as the
 * site re-renders. Each selector becomes its own CSS rule: a selector the
 * browser doesn't understand only drops that one rule, never the sheet.
 *
 * Every declaration is written here. Rules only supply selectors and labels,
 * which is what makes remote rules safe (see core/types.ts).
 */
import { compilePathPattern, pathMatches } from './routeMatcher';
import { isActive, type PlatformRules, type Toggles } from './types';

/** Attributes the engine's JavaScript sets on elements it hides (text matches, feed limit). */
export const MARK = {
  hide: 'data-ls-hide',
  collapse: 'data-ls-collapse',
  rule: 'data-ls-rule',
  limit: 'data-ls-limit',
} as const;

const BAR_STYLE =
  'display:block!important;margin:4px 0;padding:10px 16px;border-radius:8px;' +
  'background:rgba(128,128,128,.12);color:#8e8e8e;font:13px/1.4 -apple-system,system-ui,sans-serif;text-align:center';

const CARD_STYLE =
  'display:block!important;margin:24px 16px;padding:28px 20px;border-radius:14px;' +
  'background:rgba(128,128,128,.12);color:inherit;font:15px/1.5 -apple-system,system-ui,sans-serif;text-align:center;white-space:pre-line';

export const DEFAULT_COLLAPSE_LABEL = 'Hidden by Lite Social';

export function buildCss(rules: PlatformRules, toggles: Toggles, path: string, feedLimit: number): string {
  const css: string[] = [
    // Elements marked by the engine's JS layer.
    `[${MARK.hide}]{display:none!important}`,
    `[${MARK.collapse}]>*{display:none!important}`,
    `[${MARK.collapse}]::before{content:attr(${MARK.collapse});${BAR_STYLE}}`,
    `[${MARK.limit}="rest"]{display:none!important}`,
    `[${MARK.limit}="first"]>*{display:none!important}`,
    `[${MARK.limit}="first"]::before{content:${cssString(feedLimitMessage(feedLimit))};${CARD_STYLE}}`,
  ];

  for (const rule of rules.hide) {
    if (!isActive(rule, toggles)) continue;
    if (rule.paths && !pathMatches(path, rule.paths.map(compilePathPattern))) continue;
    for (const selector of rule.selectors) {
      if (rule.mode === 'collapse') {
        // :is() lets one rule target the element itself, its children and its ::before.
        css.push(`:is(${selector})>*{display:none!important}`);
        css.push(`:is(${selector})::before{content:${cssString(rule.label ?? DEFAULT_COLLAPSE_LABEL)};${BAR_STYLE}}`);
      } else {
        css.push(`${selector}{display:none!important}`);
      }
    }
  }
  return css.join('\n');
}

export function feedLimitMessage(limit: number): string {
  return `That's ${limit} posts. You're all caught up for now.\nPull down or tap reload later for new posts.`;
}

/** Quote a string for CSS `content:`. Labels are validated too, but this never relies on that. */
export function cssString(text: string): string {
  return `"${text.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\A ').replace(/[\r\u2028\u2029]/g, ' ')}"`;
}
