import { test, expect } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

test.setTimeout(180_000);

const STAGE = "#zoom-parallax-container .zoom-stage";

/**
 * Regression: the blur reveal replayed at the end of the pinned ZoomParallax
 * runway on mobile. Every mobile browser emits height-only `resize` events as
 * its URL bar collapses/expands while the guest scrolls up and down; that re-ran
 * init, which rebuilt the closure holding `revealed`, so the freshly bound
 * inView() observer delivered its initial "already intersecting" callback and
 * played the whole stagger again.
 *
 * The reveal state now lives on the stage element (`data-zoom-reveal`) and the
 * observer is only bound while that state is unset, so it fires once per page —
 * and height-only resizes no longer re-init at all.
 */
test("zoom blur reveal plays once per page, not once per resize", async ({ page }) => {
  await page.goto("/");
  await dismissWelcomeGate(page);

  const stage = page.locator(STAGE);
  const images = page.locator("#zoom-parallax-container .zoom-image");
  expect(await images.count()).toBe(9);

  // Far above the section: the script has hidden the grid for the reveal.
  await expect(stage).toHaveClass(/\bjs\b/);
  expect(await images.first().evaluate((el) => getComputedStyle(el).opacity)).toBe("0");

  // Scroll the stage in and let the stagger finish
  // (400ms delay + 8 * 250ms stagger + 500ms duration).
  await page.evaluate(() => {
    const container = document.getElementById("zoom-parallax-container")!;
    window.scrollTo({ top: container.getBoundingClientRect().top + window.scrollY });
  });
  await page.waitForFunction(
    () => {
      const all = Array.from(document.querySelectorAll<HTMLElement>(".zoom-image"));
      return all.every((img) => getComputedStyle(img).opacity === "1");
    },
    undefined,
    { timeout: 30_000 },
  );
  await expect(stage).toHaveAttribute("data-zoom-reveal", "done");
  await expect(stage).not.toHaveClass(/\bjs\b/);

  // Park at the end of the runway — the spot where the sticky stage unpins and
  // the URL bar toggles as the guest scrolls up and down.
  await page.evaluate(() => {
    const container = document.getElementById("zoom-parallax-container")!;
    const top = container.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + container.offsetHeight - window.innerHeight * 1.2 });
  });

  // Sample opacity every frame so a replay (which dips back to 0) cannot hide
  // between assertions.
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll<HTMLElement>(".zoom-image"));
    const w = window as unknown as { __minOpacity: number[]; __stopSampler: () => void };
    w.__minOpacity = all.map(() => 1);
    let running = true;
    const sample = () => {
      all.forEach((img, i) => {
        w.__minOpacity[i] = Math.min(w.__minOpacity[i], parseFloat(getComputedStyle(img).opacity));
      });
      if (running) requestAnimationFrame(sample);
    };
    sample();
    w.__stopSampler = () => {
      running = false;
    };
  });

  const { width, height } = page.viewportSize()!;

  // Mobile browser chrome collapsing, then reappearing: height-only.
  await page.setViewportSize({ width, height: height - 60 });
  await page.waitForTimeout(500);
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(500);

  // A rotation-style width change does re-init (vw geometry really changed) —
  // the reveal must still not replay.
  await page.setViewportSize({ width: width - 40, height });
  await page.waitForTimeout(1_500);
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(3_000);

  const minOpacity = await page.evaluate(() => {
    (window as unknown as { __stopSampler: () => void }).__stopSampler();
    return (window as unknown as { __minOpacity: number[] }).__minOpacity;
  });
  expect(minOpacity).toEqual(minOpacity.map(() => 1));
  await expect(stage).toHaveAttribute("data-zoom-reveal", "done");
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
  await page.waitForFunction(
    () => document.querySelector(".zoom-stage")?.getAttribute("data-zoom-reveal") === "done",
    undefined,
    { timeout: 30_000 },
  );

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
          if (nested.cssRules) walk(nested.cssRules);
          if (rule.cssText.includes("zoom-")) text.push(rule.cssText);
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
      hasJsClass: stage.classList.contains("js"),
      revealState: stage.dataset.zoomReveal ?? null,
      imageOpacity: getComputedStyle(image).opacity,
      wrapperTransform: wrapper.style.transform || "none",
    };
  });

  expect(info.containerH).toBe(info.viewportH);
  expect(info.stagePosition).toBe("relative");
  expect(info.hasJsClass).toBe(false);
  expect(info.revealState).toBe(null);
  expect(info.imageOpacity).toBe("1");
  expect(info.wrapperTransform).toBe("none");
});
