import { test, expect } from "@playwright/test";
import { dismissWelcomeGate, pinFullTier } from "./helpers";
test.setTimeout(180_000);
// Media-tiering task 7.3: every test here walks the pinned runway or asserts
// the reduced-motion collapse, so the verdict must be `full` (or reduced
// motion), never a measured `lite` from a busy-machine burst.
test.beforeEach(({ page }) => {
  pinFullTier(page);
});

/**
 * The center cover scale is measured from the stage rect (100svh), never from
 * `window.innerHeight`, so the finale's crop is identical whichever state the
 * browser chrome is in — that invariance is what makes it safe to skip re-init
 * on height-only resizes.
 */
test("center image still covers the stage after a height-only resize", async ({ page }) => {
  await page.goto("/");
  await dismissWelcomeGate(page);

  // Scroll to the end of the runway, where the center image holds fully scaled.
  await page.evaluate(() => {
    const container = document.getElementById("zoom-parallax-container")!;
    const top = container.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + container.offsetHeight - window.innerHeight });
  });
  await page.waitForTimeout(500);

  const { width, height } = page.viewportSize()!;
  await page.setViewportSize({ width, height: height - 60 });
  await page.waitForTimeout(1_000);

  const covers = await page.evaluate(() => {
    const stage = document.querySelector(".zoom-stage")!.getBoundingClientRect();
    const image = document
      .querySelector('[data-is-center="true"] .zoom-image')!
      .getBoundingClientRect();
    return {
      widthRatio: image.width / stage.width,
      heightRatio: image.height / stage.height,
    };
  });

  // 1.01 headroom is baked into the scale factor; allow a hair of rounding.
  expect(covers.widthRatio).toBeGreaterThanOrEqual(1);
  expect(covers.heightRatio).toBeGreaterThanOrEqual(1);
});

/**
 * The runway, the sticky stage and the bento slot geometry are sized in `lvh`
 * (with a `vh` fallback), never `svh`/`dvh` — scroll-motion spec: "Pinned stages
 * are sized to the chrome-hidden viewport". On a phone `100svh` is ~60-80px
 * shorter than the screen once the URL bar retracts, which exposed a band of page
 * background under the stage for the whole pinned run. Playwright's device
 * emulation has no collapsible chrome (svh === lvh === vh there), so this asserts
 * the declarations rather than a measured difference.
 */
test("pinned runway and stage are sized to the chrome-hidden viewport", async ({ page }) => {
  await page.goto("/");
  await dismissWelcomeGate(page);

  const css = await page.evaluate(() => {
    const text: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin sheet
      }
      const walk = (list: CSSRuleList) => {
        for (const rule of Array.from(list)) {
          const nested = rule as CSSStyleRule & { cssRules?: CSSRuleList };
          if (nested.cssRules && nested.cssRules.length > 0) {
            walk(nested.cssRules);
          } else if (rule.cssText && rule.cssText.includes("zoom-")) {
            text.push(rule.cssText);
          }
        }
      };
      walk(rules);
    }
    return text.join("\n");
  });

  expect(css).toContain("400lvh"); // runway
  expect(css).toContain("100lvh"); // stage (and the reduced-motion collapse)
  expect(css).not.toContain("svh");
  expect(css).not.toContain("dvh");

  // And it resolves: the stage is exactly the chrome-hidden viewport, so nothing
  // shows beneath it while pinned.
  const fills = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:100lvh;visibility:hidden;pointer-events:none;";
    document.body.appendChild(probe);
    const lvh = probe.getBoundingClientRect().height;
    probe.remove();
    const stage = document.querySelector(".zoom-stage")!.getBoundingClientRect();
    return { ratio: stage.height / lvh };
  });
  expect(fills.ratio).toBeCloseTo(1, 5);
});

/**
 * Reduced motion (scroll-motion spec: "ZoomParallax honors reduced motion"): the
 * bento grid is static, readable content in one viewport — no pin, no scrub, no
 * hidden images. The lvh collapse must match the other pinned sections so the
 * single screen fills the chrome-hidden viewport too.
 */
test("reduced motion collapses the pin to one full viewport of static grid", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await dismissWelcomeGate(page);
  await page.locator("#zoom-parallax-container").scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);

  const info = await page.evaluate(() => {
    const container = document.getElementById("zoom-parallax-container")!;
    const stage = document.querySelector(".zoom-stage") as HTMLElement;
    const image = document.querySelector(".zoom-image") as HTMLElement;
    const wrapper = document.querySelector(".zoom-wrapper") as HTMLElement;
    return {
      containerH: Math.round(container.getBoundingClientRect().height),
      // window.innerHeight is the *layout* viewport under mobile emulation (and
      // the dynamic viewport on phones) — the document element is the honest
      // visible-viewport measure here.
      viewportH: document.documentElement.clientHeight,
      stagePosition: getComputedStyle(stage).position,
      imageOpacity: getComputedStyle(image).opacity,
      wrapperTransform: wrapper.style.transform || "none",
    };
  });

  expect(info.containerH).toBe(info.viewportH);
  expect(info.stagePosition).toBe("relative");
  expect(info.imageOpacity).toBe("1");
  expect(info.wrapperTransform).toBe("none");
});
