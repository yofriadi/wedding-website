import { test, expect, type Page } from "@playwright/test";

test.setTimeout(180_000);

/**
 * scroll-motion spec: "Pinned stages are sized to the chrome-hidden viewport".
 *
 * Every pinned runway and sticky stage is sized in `lvh` and never in `svh`/`dvh`.
 * On a phone `100svh` is ~60-80px shorter than the screen once the URL bar and
 * bottom toolbar retract, which exposed a band of page background under the stage
 * for the whole pinned run; `dvh` re-resolves mid-scroll and jumps the scrub.
 *
 * Scope: `ZoomParallax` is already covered by `zoom-reveal-once.spec.ts` ("pinned
 * runway and stage are sized to the chrome-hidden viewport"). This file closes the
 * gap for the other two pinned sections, `HeroZoom` and `TimelineScroll`.
 *
 * Playwright's device emulation has no collapsible chrome (`svh === lvh === vh`
 * there), so these assert the *declarations* plus the resolved stage geometry. The
 * headline defect this guards — the Mobile Safari bottom gap — is only observable
 * on physical iOS hardware (tasks 4.1/4.2).
 *
 * KNOWN GAP, deliberately not asserted here: the spec also requires a `vh`
 * fallback *preceding* each `lvh` declaration, and the authored source has one
 * (`height: 1249vh; height: 1249lvh;`). It does not survive the build — Vite 8
 * defaults `build.cssMinify` to `"lightningcss"`, Astro's
 * `plugin-css-target-lowering` returns early whenever `cssMinify` is set, and
 * LightningCSS with no configured browser targets treats the `vh` declaration as
 * dead code and deletes it. `dist/client/_astro/index.*.css` therefore ships
 * `height:1249lvh` alone, so a browser without `lvh` support drops the
 * declaration entirely and the runway collapses to `height:auto`. Fixing that is a
 * build-target decision with site-wide blast radius, tracked separately from this
 * suite; re-add the pair assertion once it lands.
 *
 * No `dismissWelcomeGate` and no tier pinning: the loader and both gates are
 * `fixed` overlays that cannot change document-flow heights, and neither
 * `HeroZoom` nor `TimelineScroll` has `html[data-tier]` geometry rules (only
 * `ZoomParallax` collapses on `lite`).
 */

/** Selector fragments identifying each pinned component's own rules. */
const HERO_PREFIXES = [".hero-scroll", ".hero-stage"];
const TIMELINE_PREFIXES = [".timeline-", "#timeline-track", "#node-", "#dot-"];

type ScopedRule = { selector: string; cssText: string };

/**
 * Collect the CSSOM text of every rule whose selector matches one of `prefixes`,
 * recursing into `@media`/`@supports` blocks so conditional declarations are
 * swept too. A rule is recorded before descending, so a nested style rule cannot
 * shadow its own declarations.
 */
async function collectScopedCss(page: Page, prefixes: string[]): Promise<ScopedRule[]> {
  return page.evaluate((wanted) => {
    const out: Array<{ selector: string; cssText: string }> = [];
    const matches = (selector: string) => wanted.some((prefix) => selector.includes(prefix));

    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        const selector = (rule as CSSStyleRule).selectorText;
        if (selector && matches(selector)) {
          out.push({ selector, cssText: rule.cssText });
        }
        const group = rule as CSSRule & { cssRules?: CSSRuleList };
        if (group.cssRules && group.cssRules.length > 0) walk(group.cssRules);
      }
    };

    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin sheet
      }
      walk(rules);
    }
    return out;
  }, prefixes);
}

/**
 * CSSOM `cssText` never carries comments — the parser discards them — so this is
 * a no-op on the path used here. It is kept because the assertion it protects is
 * "no `svh`/`dvh` *declaration*", and every component explains that rule in a
 * comment that literally names both units (`HeroZoom.astro:92-101`,
 * `TimelineScroll.astro:437-442`). Stripping first keeps the check honest if the
 * source ever becomes raw CSS text, such as reading the built bundle.
 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The comment-stripped declarations of every swept rule matching `fragment`. */
function declarationsFor(rules: ScopedRule[], fragment: string): string {
  return stripCssComments(
    rules
      .filter((r) => r.selector.includes(fragment))
      .map((r) => r.cssText)
      .join("\n"),
  );
}

/** Assert some swept rule for `fragment` declares `height: <value>lvh`. */
function expectLvhHeight(rules: ScopedRule[], fragment: string, value: string) {
  const css = declarationsFor(rules, fragment);
  expect(css, `${fragment} must have a scoped rule`).not.toBe("");
  expect(css, `${fragment} must declare height: ${value}lvh`).toMatch(
    new RegExp(`height:\\s*${value}lvh`),
  );
}

/** Assert no swept rule declares a small- or dynamic-viewport height unit. */
function expectNoSvhDvh(rules: ScopedRule[], label: string) {
  for (const rule of rules) {
    const css = stripCssComments(rule.cssText);
    expect(css, `${label}: ${rule.selector} must not use svh`).not.toMatch(/svh/);
    expect(css, `${label}: ${rule.selector} must not use dvh`).not.toMatch(/dvh/);
  }
}

test("HeroZoom runway and stage are sized to the chrome-hidden viewport", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".hero-stage");

  const rules = await collectScopedCss(page, HERO_PREFIXES);
  expect(rules.length, "sweep must find HeroZoom's own rules").toBeGreaterThan(0);

  expectLvhHeight(rules, ".hero-scroll", "350"); // runway
  expectLvhHeight(rules, ".hero-stage", "100"); // sticky stage

  expectNoSvhDvh(rules, "HeroZoom");
});

test("TimelineScroll runway, stage, track and node tops are sized to the chrome-hidden viewport", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForSelector(".timeline-stage");

  const rules = await collectScopedCss(page, TIMELINE_PREFIXES);
  expect(rules.length, "sweep must find TimelineScroll's own rules").toBeGreaterThan(0);

  expectLvhHeight(rules, ".timeline-section", "1249"); // runway
  expectLvhHeight(rules, ".timeline-stage", "100"); // sticky stage
  expectLvhHeight(rules, "#timeline-track", "250"); // track

  // Node verticals are lvh too, so dot-6 lands on the expansion-circle centre on
  // phones — the JS `vUnit` detection resolves the same unit.
  for (const node of ["#node-1", "#node-2", "#node-3", "#node-4", "#node-5", "#dot-6-anchor"]) {
    const css = declarationsFor(rules, node);
    expect(css, `${node} must have a scoped rule`).not.toBe("");
    expect(css, `${node} must position with top: <n>lvh`).toMatch(/top:\s*\d+(?:\.\d+)?lvh/);
  }

  expectNoSvhDvh(rules, "TimelineScroll");
});

/**
 * Declarations are only half the contract: the stages must *resolve* to exactly
 * the chrome-hidden viewport, which is what makes the pinned frame cover the
 * screen with no band of section background beneath it.
 */
test("HeroZoom and TimelineScroll stages resolve to exactly one large viewport", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForSelector(".timeline-stage");

  const measured = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:100lvh;visibility:hidden;pointer-events:none;";
    document.body.appendChild(probe);
    const lvh = probe.getBoundingClientRect().height;
    probe.remove();

    const heightOf = (selector: string) => {
      const el = document.querySelector(selector);
      return el ? el.getBoundingClientRect().height : null;
    };

    return {
      lvh,
      heroStage: heightOf(".hero-stage"),
      timelineStage: heightOf(".timeline-stage"),
    };
  });

  expect(measured.lvh).toBeGreaterThan(0);
  expect(measured.heroStage, ".hero-stage must be present").not.toBeNull();
  expect(measured.timelineStage, ".timeline-stage must be present").not.toBeNull();
  expect(measured.heroStage! / measured.lvh).toBeCloseTo(1, 5);
  expect(measured.timelineStage! / measured.lvh).toBeCloseTo(1, 5);
});
