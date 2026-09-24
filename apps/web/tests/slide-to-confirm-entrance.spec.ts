import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// Use the generated, real component (including its script), with a scrollable
// wrapper matching RSVP. No invitation or RSVP POST is needed for this reveal.
const fixture = readFileSync(new URL("./fixtures/slide-to-confirm.html", import.meta.url), "utf8");
const FRESH = "#slide-fresh";
const TARGET = "[data-slide-entrance-target]";
type EntranceWindow = Window & { __slideEntranceAnimations?: Animation[] };

async function openEntrance(page: Page, { inView = false, pause = false } = {}) {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
  if (pause) {
    await page.addInitScript(() => {
      const observer = new MutationObserver(() => {
        const button = document.querySelector<HTMLElement>("#slide-fresh");
        if (button?.dataset.slideEntrance !== "revealing") return;
        observer.disconnect();
        const animations = button.getAnimations({ subtree: true });
        animations.forEach((animation) => animation.pause());
        (window as EntranceWindow).__slideEntranceAnimations = animations;
      });
      observer.observe(document, {
        subtree: true,
        attributes: true,
        attributeFilter: ["data-slide-entrance"],
      });
    });
  }
  const html = fixture
    .replace("<body>", "<body><div data-slide-entrance-target>")
    .replace("</button>", "</button></div>")
    .replace(
      "</head>",
      `<style>
      body { display: flow-root; padding: 0; min-height: 260vh; }
      [data-slide-entrance-target] {
        display: flex; justify-content: center; padding: 0 1.5rem;
        margin-top: ${inView ? "3rem" : "120vh"}; margin-bottom: 100vh;
      }
      #slide-confirmed { position: absolute; top: 0; left: -1000px; }
    </style></head>`,
    );
  await page.route("**/__slide-entrance-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: html,
    }),
  );
  await page.goto("/__slide-entrance-fixture");
  await expect(page.locator("#slide-confirmed")).toHaveClass(/slide-to-confirm--confirmed/);
  if (!inView) await expect(page.locator(FRESH)).toHaveAttribute("data-slide-entrance", "pending");
}

async function revealPaused(page: Page) {
  await page.locator(TARGET).scrollIntoViewIfNeeded();
  await page.waitForFunction(() => (window as EntranceWindow).__slideEntranceAnimations?.length);
}

for (const inView of [false, true]) {
  test(`${inView ? "already visible" : "scrolling into view"}: circle rises, pill expands, then label appears`, async ({
    page,
  }) => {
    await openEntrance(page, { inView, pause: true });
    if (!inView) await expect(page.locator(FRESH)).toHaveCSS("opacity", "0");
    await revealPaused(page);

    // Seek the actual CSS transitions rather than racing wall-clock delays.
    const phases = await page.locator(FRESH).evaluate((button) => {
      const animations = (window as EntranceWindow).__slideEntranceAnimations!;
      const label = button.querySelector<HTMLElement>("[data-slide-to-confirm-text]")!;
      const handle = button.querySelector<HTMLElement>("[data-slide-to-confirm-handle]")!;
      const sample = (time: number) => {
        animations.forEach((animation) => {
          animation.currentTime = time;
        });
        const style = getComputedStyle(button);
        const width = (button as HTMLElement).offsetWidth;
        // Percentage insets stay as calc() in computed styles, including while
        // interpolating. Resolve against the border box, as clip-path does.
        const calc = style.clipPath.match(/calc\(([-\d.]+)%\s*([+-])\s*([\d.]+)px\)/);
        const inset = calc
          ? (width * Number(calc[1])) / 100 + (calc[2] === "-" ? -1 : 1) * Number(calc[3])
          : Number(style.clipPath.match(/^inset\([^ ]+ ([\d.]+)px/)?.[1] ?? 0);
        const rect = button.getBoundingClientRect();
        const handleRect = handle.getBoundingClientRect();
        return {
          layoutWidth: width,
          height: (button as HTMLElement).offsetHeight,
          visibleWidth: width - inset * 2,
          y: new DOMMatrixReadOnly(style.transform).m42,
          handleCenterOffset: handleRect.x + handleRect.width / 2 - (rect.x + rect.width / 2),
          handleX: new DOMMatrixReadOnly(getComputedStyle(handle).transform).m41,
          labelOpacity: Number(getComputedStyle(label).opacity),
        };
      };
      const phases = {
        rising: sample(100),
        landed: sample(200),
        expanding: sample(450),
        expanded: sample(700),
        fading: sample(740),
        labeled: sample(860),
      };
      animations.forEach((animation) => animation.finish());
      return phases;
    });

    expect(phases.rising.visibleWidth).toBeCloseTo(phases.rising.height, 1);
    expect(phases.rising.y).toBeGreaterThan(0);
    expect(Math.abs(phases.rising.handleCenterOffset)).toBeLessThan(1);
    expect(phases.rising.labelOpacity).toBe(0);
    expect(phases.landed.y).toBeCloseTo(0, 1);
    expect(phases.landed.visibleWidth).toBeCloseTo(phases.landed.height, 1);
    expect(phases.landed.labelOpacity).toBe(0);
    expect(phases.expanding.visibleWidth).toBeGreaterThan(phases.landed.visibleWidth);
    expect(phases.expanding.visibleWidth).toBeLessThan(phases.expanded.visibleWidth);
    expect(phases.expanding.handleX).toBeLessThan(phases.landed.handleX);
    expect(phases.expanding.labelOpacity).toBe(0);
    expect(phases.expanded.visibleWidth).toBeCloseTo(phases.expanded.layoutWidth, 1);
    expect(phases.expanded.handleX).toBe(0);
    expect(phases.expanded.labelOpacity).toBe(0);
    expect(phases.fading.labelOpacity).toBeGreaterThan(0);
    expect(phases.fading.labelOpacity).toBeLessThan(1);
    expect(phases.labeled.labelOpacity).toBe(1);
    expect(new Set(Object.values(phases).map((phase) => phase.layoutWidth)).size).toBe(1);

    const button = page.locator(FRESH);
    await expect(button).toHaveAttribute("data-slide-entrance", "revealing");
    await expect(button).toHaveCSS("opacity", "1");
    await expect(button.locator("[data-slide-to-confirm-text]")).toHaveCSS("opacity", "1");
    await expect(button).toHaveAccessibleName("Confirm Reservation");

    // Going past the section keeps the pill expanded and visible (matching AddImageButton)
    await page.evaluate(() =>
      window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }),
    );
    await expect(button).toHaveAttribute("data-slide-entrance", "revealing");
    await expect(button).toHaveCSS("opacity", "1");
  });
}

test("keyboard focus skips the entrance immediately, including its clipping", async ({ page }) => {
  await openEntrance(page);
  await page.keyboard.press("Tab");
  const button = page.locator(FRESH);
  await expect(button).toBeFocused();
  const focused = await button.evaluate((el) => ({
    entrance: el.getAttribute("data-slide-entrance"),
    opacity: getComputedStyle(el).opacity,
    clip: getComputedStyle(el).clipPath,
    transform: getComputedStyle(el).transform,
    labelOpacity: getComputedStyle(el.querySelector("[data-slide-to-confirm-text]")!).opacity,
    outline: getComputedStyle(el).outlineStyle,
    animations: el.getAnimations({ subtree: true }).length,
  }));
  expect(focused).toEqual({
    entrance: null,
    opacity: "1",
    clip: "none",
    transform: "none",
    labelOpacity: "1",
    outline: "solid",
    animations: 0,
  });
});

test("a tap during the circle reveal skips the entrance without confirming", async ({ page }) => {
  await openEntrance(page, { pause: true });
  await revealPaused(page);
  await page.evaluate(() => {
    (window as EntranceWindow).__slideEntranceAnimations!.forEach((animation) => {
      animation.currentTime = 100;
    });
  });
  const button = page.locator(FRESH);
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(button).not.toHaveAttribute("data-slide-entrance");
  await page.mouse.up();
  await expect(button).not.toHaveClass(/slide-to-confirm--confirmed/);
  await expect(button).toHaveCSS("clip-path", "none");
  await expect(button.locator("[data-slide-to-confirm-text]")).toHaveCSS("opacity", "1");
  await expect
    .poll(() =>
      button
        .locator("[data-slide-to-confirm-handle]")
        .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41),
    )
    .toBe(0);
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("enabling reduced motion during the reveal leaves the full control ready", async ({
  page,
}) => {
  await openEntrance(page, { pause: true });
  await revealPaused(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const button = page.locator(FRESH);
  await expect(button).not.toHaveAttribute("data-slide-entrance");
  await expect(button).toHaveCSS("opacity", "1");
  await expect(button).toHaveCSS("clip-path", "none");
  await expect(button).toHaveCSS("transform", "none");
  await expect(button.locator("[data-slide-to-confirm-text]")).toHaveCSS("opacity", "1");
  expect(await button.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(button).not.toHaveAttribute("data-slide-entrance");
});

test("scrolling back collapses the pill before lowering it", async ({ page }) => {
  await openEntrance(page, { inView: false });
  const button = page.locator(FRESH);
  await page.locator(TARGET).scrollIntoViewIfNeeded();
  await expect(button).toHaveAttribute("data-slide-entrance", "revealing");
  await expect(button).toHaveCSS("opacity", "1");
  await expect(button.locator("[data-slide-to-confirm-text]")).toHaveCSS("opacity", "1");
  await expect(button.locator("[data-slide-to-confirm-handle]")).toHaveCSS(
    "transform",
    "matrix(1, 0, 0, 1, 0, 0)",
  );

  const phases = await button.evaluate(async (el) => {
    const exit = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (el.getAttribute("data-slide-entrance") === "collapsed") {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(el, { attributes: true, attributeFilter: ["data-slide-entrance"] });
    });
    window.scrollTo({ top: 0, behavior: "instant" });
    await exit;
    const transitions = el.getAnimations({ subtree: true });
    transitions.forEach((a) => a.pause());
    const label = el.querySelector<HTMLElement>("[data-slide-to-confirm-text]")!;
    const width = (el as HTMLElement).offsetWidth;
    const sample = (time: number) => {
      transitions.forEach((a) => {
        a.currentTime = time;
      });
      const style = getComputedStyle(el);
      const calc = style.clipPath.match(/calc\(([-\d.]+)%\s*([+-])\s*([\d.]+)px\)/);
      const inset = calc
        ? (width * Number(calc[1])) / 100 + (calc[2] === "-" ? -1 : 1) * Number(calc[3])
        : Number(style.clipPath.match(/^inset\([^ ]+ ([\d.]+)px/)?.[1] ?? 0);
      return {
        layoutWidth: width,
        visibleWidth: width - inset * 2,
        y: new DOMMatrixReadOnly(style.transform).m42,
        opacity: Number(style.opacity),
        labelOpacity: Number(getComputedStyle(label).opacity),
      };
    };
    const collapsing = sample(250);
    const phases = {
      collapsing,
      collapsed: sample(500),
      lowering: sample(600),
      gone: sample(700),
    };
    transitions.forEach((a) => a.finish());
    return phases;
  });

  expect(phases.collapsing.visibleWidth).toBeGreaterThan(58);
  expect(phases.collapsing.visibleWidth).toBeLessThan(phases.collapsing.layoutWidth);
  expect(phases.collapsing.y).toBe(0);
  expect(phases.collapsing.opacity).toBe(1);
  expect(phases.collapsing.labelOpacity).toBe(0);
  expect(phases.collapsed.visibleWidth).toBeCloseTo(58, 1);
  expect(phases.collapsed.y).toBe(0);
  expect(phases.collapsed.opacity).toBe(1);
  expect(phases.lowering.y).toBeGreaterThan(0);
  expect(phases.lowering.opacity).toBeLessThan(1);
  expect(phases.gone.opacity).toBe(0);

  // Scrolling back down reveals it again
  await page.locator(TARGET).scrollIntoViewIfNeeded();
  await expect(button).toHaveAttribute("data-slide-entrance", "revealing");
  await expect(button).toHaveCSS("opacity", "1");
});

test("when confirmed: circle rises, black pill expands, checkmark glides to far end, then label appears", async ({
  page,
}) => {
  // Wrap the CONFIRMED button in the scrollable stage. Anchored on its id
  // and whitespace-tolerant: the dev server pretty-prints the generated
  // fixture's markup (attributes split across lines), so exact-string
  // replaces silently no-op and the wrapper never exists.
  const html = fixture
    .replace(/<button(?=[^>]*id="slide-confirmed")/, "<div data-confirmed-target><button")
    .replace(/<\/button>(?=\s*<\/body>)/, "</button></div>")
    .replace(
      "</head>",
      `<style>
      body { display: flow-root; padding: 0; min-height: 260vh; }
      #slide-fresh { position: absolute; top: 0; left: -1000px; }
      [data-confirmed-target] { display: flex; justify-content: center; padding: 0 1.5rem; margin-top: 120vh; margin-bottom: 100vh; }
    </style></head>`,
    );
  await page.route("**/__confirmed-entrance-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const button = document.querySelector<HTMLElement>("#slide-confirmed");
      if (button?.dataset.slideEntrance !== "revealing") return;
      observer.disconnect();
      const animations = button.getAnimations({ subtree: true });
      animations.forEach((animation) => animation.pause());
      (window as EntranceWindow).__slideEntranceAnimations = animations;
    });
    observer.observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-slide-entrance"],
    });
  });
  await page.goto("/__confirmed-entrance-fixture");
  const button = page.locator("#slide-confirmed");
  await expect(button).toHaveAttribute("data-slide-entrance", "pending");
  await expect(button).toHaveCSS("opacity", "0");

  await button.scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.evaluate(() => Boolean((window as EntranceWindow).__slideEntranceAnimations)))
    .toBe(true);

  const phases = await button.evaluate((btn) => {
    const animations = (window as EntranceWindow).__slideEntranceAnimations!;
    const label = btn.querySelector<HTMLElement>("[data-slide-to-confirm-text]")!;
    const handle = btn.querySelector<HTMLElement>("[data-slide-to-confirm-handle]")!;
    const sample = (time: number) => {
      animations.forEach((animation) => {
        animation.currentTime = time;
      });
      const style = getComputedStyle(btn);
      const width = (btn as HTMLElement).offsetWidth;
      const calc = style.clipPath.match(/calc\(([-\d.]+)%\s*([+-])\s*([\d.]+)px\)/);
      const inset = calc
        ? (width * Number(calc[1])) / 100 + (calc[2] === "-" ? -1 : 1) * Number(calc[3])
        : Number(style.clipPath.match(/^inset\([^ ]+ ([\d.]+)px/)?.[1] ?? 0);
      const rect = btn.getBoundingClientRect();
      const handleRect = handle.getBoundingClientRect();
      return {
        layoutWidth: width,
        height: (btn as HTMLElement).offsetHeight,
        visibleWidth: width - inset * 2,
        y: new DOMMatrixReadOnly(style.transform).m42,
        handleCenterOffset: handleRect.x + handleRect.width / 2 - (rect.x + rect.width / 2),
        handleX: new DOMMatrixReadOnly(getComputedStyle(handle).transform).m41,
        labelOpacity: Number(getComputedStyle(label).opacity),
      };
    };
    const phases = {
      rising: sample(100),
      landed: sample(200),
      expanding: sample(450),
      expanded: sample(700),
      fading: sample(740),
      labeled: sample(860),
    };
    animations.forEach((animation) => animation.finish());
    return phases;
  });

  expect(phases.rising.visibleWidth).toBeCloseTo(phases.rising.height, 1);
  expect(phases.rising.y).toBeGreaterThan(0);
  expect(Math.abs(phases.rising.handleCenterOffset)).toBeLessThan(1);
  expect(phases.rising.labelOpacity).toBe(0);
  expect(phases.landed.y).toBeCloseTo(0, 1);
  expect(phases.landed.visibleWidth).toBeCloseTo(phases.landed.height, 1);
  expect(phases.landed.labelOpacity).toBe(0);
  expect(phases.expanding.visibleWidth).toBeGreaterThan(phases.landed.visibleWidth);
  expect(phases.expanding.visibleWidth).toBeLessThan(phases.expanded.visibleWidth);
  expect(phases.expanding.handleX).toBeGreaterThan(phases.landed.handleX);
  expect(phases.expanding.labelOpacity).toBe(0);
  expect(phases.expanded.visibleWidth).toBeCloseTo(phases.expanded.layoutWidth, 1);
  expect(phases.expanded.handleX).toBeGreaterThan(phases.expanding.handleX);
  expect(phases.expanded.labelOpacity).toBe(0);
  expect(phases.fading.labelOpacity).toBeGreaterThan(0);
  expect(phases.fading.labelOpacity).toBeLessThan(1);
  expect(phases.labeled.labelOpacity).toBe(1);

  await expect(button).toHaveAttribute("data-slide-entrance", "revealing");
  await expect(button).toHaveCSS("opacity", "1");
  await expect(button.locator("[data-slide-to-confirm-text]")).toHaveCSS("opacity", "1");
  await expect(button).toHaveAccessibleName("Reservation Confirmed");
});

test("when confirmed: scrolling back collapses the pill before lowering it", async ({ page }) => {
  const html = fixture
    // Same id-anchored, whitespace-tolerant wrap as the confirmed-entrance
    // test above: pretty-printed fixture markup breaks exact-string matches.
    .replace(/<button(?=[^>]*id="slide-confirmed")/, "<div data-confirmed-target><button")
    .replace(/<\/button>(?=\s*<\/body>)/, "</button></div>")
    .replace(
      "</head>",
      `<style>
      body { display: flow-root; padding: 0; min-height: 260vh; }
      #slide-fresh { position: absolute; top: 0; left: -1000px; }
      [data-confirmed-target] { display: flex; justify-content: center; padding: 0 1.5rem; margin-top: 120vh; margin-bottom: 100vh; }
    </style></head>`,
    );
  await page.route("**/__confirmed-entrance-fixture-exit", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.goto("/__confirmed-entrance-fixture-exit");
  const button = page.locator("#slide-confirmed");
  await button.scrollIntoViewIfNeeded();
  await expect(button).toHaveAttribute("data-slide-entrance", "revealing");
  await expect(button).toHaveCSS("opacity", "1");
  await expect(button.locator("[data-slide-to-confirm-text]")).toHaveCSS("opacity", "1");

  const phases = await button.evaluate(async (el) => {
    const exit = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (el.getAttribute("data-slide-entrance") === "collapsed") {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(el, { attributes: true, attributeFilter: ["data-slide-entrance"] });
    });
    window.scrollTo({ top: 0, behavior: "instant" });
    await exit;
    const transitions = el.getAnimations({ subtree: true });
    transitions.forEach((a) => a.pause());
    const label = el.querySelector<HTMLElement>("[data-slide-to-confirm-text]")!;
    const width = (el as HTMLElement).offsetWidth;
    const sample = (time: number) => {
      transitions.forEach((a) => {
        a.currentTime = time;
      });
      const style = getComputedStyle(el);
      const calc = style.clipPath.match(/calc\(([-\d.]+)%\s*([+-])\s*([\d.]+)px\)/);
      const inset = calc
        ? (width * Number(calc[1])) / 100 + (calc[2] === "-" ? -1 : 1) * Number(calc[3])
        : Number(style.clipPath.match(/^inset\([^ ]+ ([\d.]+)px/)?.[1] ?? 0);
      return {
        layoutWidth: width,
        visibleWidth: width - inset * 2,
        y: new DOMMatrixReadOnly(style.transform).m42,
        opacity: Number(style.opacity),
        labelOpacity: Number(getComputedStyle(label).opacity),
      };
    };
    const collapsing = sample(250);
    const phases = {
      collapsing,
      collapsed: sample(500),
      lowering: sample(600),
      gone: sample(700),
    };
    transitions.forEach((a) => a.finish());
    return phases;
  });

  expect(phases.collapsing.visibleWidth).toBeGreaterThan(58);
  expect(phases.collapsing.visibleWidth).toBeLessThan(phases.collapsing.layoutWidth);
  expect(phases.collapsing.y).toBe(0);
  expect(phases.collapsing.opacity).toBe(1);
  expect(phases.collapsing.labelOpacity).toBe(0);
  expect(phases.collapsed.visibleWidth).toBeCloseTo(58, 1);
  expect(phases.collapsed.y).toBe(0);
  expect(phases.collapsed.opacity).toBe(1);
  expect(phases.lowering.y).toBeGreaterThan(0);
  expect(phases.lowering.opacity).toBeLessThan(1);
  expect(phases.gone.opacity).toBe(0);

  // Scrolling back down reveals it again
  await button.scrollIntoViewIfNeeded();
  await expect(button).toHaveAttribute("data-slide-entrance", "revealing");
  await expect(button).toHaveCSS("opacity", "1");
});
