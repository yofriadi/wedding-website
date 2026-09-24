import { test, expect, type Page } from "@playwright/test";
import { pinFullTier, waitForLoaderDismissed } from "./helpers";

// Well-formed invite id (12 chars of [A-Za-z0-9_-]). Deliberately NOT seeded:
// these tests assert client-side gate behavior, which must not depend on
// server-side invite state (the metric is fire-and-forget by design). The
// server contract itself is verified via curl against a controlled build.
const INVITE_ID = "Playwright01";

/**
 * A real touchscreen drag. Playwright's touchscreen API only taps, so drive
 * Chromium's touch input through CDP — the touchstart/move/end DOM events are
 * indistinguishable from device input.
 */
async function touchDrag(
  page: Page,
  opts: { fromY: number; toY: number; steps?: number; stepDelayMs?: number },
) {
  const { fromY, toY, steps = 10, stepDelayMs = 0 } = opts;
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("viewport not set");
  const x = viewport.width / 2;

  const cdp = await page.context().newCDPSession(page);
  try {
    const points = (y: number) => [{ x, y, radiusX: 5, radiusY: 5 }];
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points(fromY),
    });
    for (let i = 1; i <= steps; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: points(fromY + ((toY - fromY) * i) / steps),
      });
      if (stepDelayMs > 0) await page.waitForTimeout(stepDelayMs);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

function countOpenMetricPosts(page: Page) {
  const counter = { posts: 0 };
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/invite/opened") {
      counter.posts++;
    }
  });
  return counter;
}

const heroMusicPaused = (page: Page) =>
  page.evaluate(() => (document.getElementById("hero-music") as HTMLAudioElement | null)?.paused);

test.describe("welcome gate", () => {
  // Media-tiering task 7.3: pin the tier so a stray burst measurement on a
  // busy machine cannot flip these assertions to the lite behavior.
  test.beforeEach(({ page }) => {
    pinFullTier(page);
  });

  test("swipe past threshold reveals, unlocks scroll, starts music, fires the metric once", async ({
    page,
    context,
  }) => {
    test.slow(); // loader holds for its minimum dwell plus hero fetch + decode

    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    const metric = countOpenMetricPosts(page);

    await page.goto("/");
    await waitForLoaderDismissed(page);

    const gate = page.locator("#welcome-gate");
    await expect(gate).toBeVisible();

    // Armed state: scroll locked at 0, autoplay still blocked in this fresh context.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");

    // Arming cancels the CSS failsafe auto-dismiss: the gate has no running
    // animations at all once armed (robust to scoped-keyframe renames).
    expect(
      await page.evaluate(() => document.getElementById("welcome-gate")!.getAnimations().length),
    ).toBe(0);
    expect(await heroMusicPaused(page)).toBe(true);

    // Commit by distance: ~42% of viewport height, past the ~28% threshold.
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("viewport not set");
    await touchDrag(page, {
      fromY: viewport.height * 0.75,
      toY: viewport.height * 0.33,
      stepDelayMs: 16,
    });

    // Gate animates off and is removed from the DOM.
    await expect(gate).toHaveCount(0);

    // Scroll unlocks.
    await page.evaluate(() => window.scrollTo(0, 400));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    // The committing touchend unlocked audio inside its activation window.
    await expect.poll(() => heroMusicPaused(page), { timeout: 5_000 }).toBe(false);

    // Exactly one fire-and-forget open metric...
    expect(metric.posts).toBe(1);

    // ...and later gestures never re-fire it for this pageview.
    await touchDrag(page, { fromY: viewport.height * 0.7, toY: viewport.height * 0.2 });
    await page.waitForTimeout(300);
    expect(metric.posts).toBe(1);
  });

  test("hero holds its zoomed-in state across the reveal (no end-state flash)", async ({
    page,
  }) => {
    test.slow();

    await page.goto("/");
    await waitForLoaderDismissed(page);
    await expect(page.locator("#welcome-gate")).toBeVisible();

    // The scroll lock is root-only. Locking <body> too makes body a scroll
    // container with no scrollable overflow, which deactivates the hero's
    // view-timeline: HeroZoom then falls back to its static base styles (the
    // fully revealed, zoomed-OUT hero) and the swipe uncovers that end state
    // before snapping back to scale(2.8).
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

    // Sample the hero every frame from armed, through the dismissal, until well
    // after the gate is gone. At scroll zero the hero must never leave its
    // initial state: scale(2.8) with the names/date still hidden.
    const samples = await page.evaluate(async () => {
      const img = document.querySelector<HTMLElement>("#hero-container .animate-image")!;
      const text = document.querySelector<HTMLElement>("#hero-container .animate-aisha")!;
      const seen: Array<{ scale: number; textOpacity: number; scrollY: number }> = [];
      let done = false;

      const tick = () => {
        const m = new DOMMatrixReadOnly(getComputedStyle(img).transform);
        seen.push({
          scale: m.a,
          textOpacity: Number(getComputedStyle(text).opacity),
          scrollY: window.scrollY,
        });
        if (!done) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      await new Promise((r) => setTimeout(r, 100));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise((r) => setTimeout(r, 900));
      done = true;
      return seen;
    });

    expect(samples.length).toBeGreaterThan(10);
    expect(await page.locator("#welcome-gate").count()).toBe(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // Every frame at scroll zero: fully zoomed in, overlay copy still hidden.
    for (const s of samples) {
      expect(s.scrollY).toBe(0);
      expect(s.scale).toBeCloseTo(2.8, 2);
      expect(s.textOpacity).toBe(0);
    }
  });

  test("short drag springs back and stays armed; keydown then dismisses", async ({ page }) => {
    test.slow();
    const metric = countOpenMetricPosts(page);

    await page.goto("/");
    await waitForLoaderDismissed(page);

    const gate = page.locator("#welcome-gate");
    await expect(gate).toBeVisible();

    const viewport = page.viewportSize();
    if (!viewport) throw new Error("viewport not set");

    // ~10% of viewport, slowly: below the distance threshold and flick velocity.
    await touchDrag(page, {
      fromY: viewport.height * 0.7,
      toY: viewport.height * 0.6,
      steps: 8,
      stepDelayMs: 40,
    });

    // Springs back to fully covering the viewport...
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const el = document.getElementById("welcome-gate");
            return el ? getComputedStyle(el).transform : "removed";
          }),
        { timeout: 3_000 },
      )
      .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    await expect(gate).toBeVisible();
    expect(metric.posts).toBe(0);

    // ...and stays armed: a keydown dismisses (still armed).
    await page.keyboard.press("Enter");
    await expect(gate).toHaveCount(0);

    // Anonymous (no cookie): no metric ever fires.
    expect(metric.posts).toBe(0);
  });
  test("swipe up below threshold turns back and bounces with height proportional to pull distance", async ({
    page,
  }) => {
    test.slow();
    await page.goto("/");
    await waitForLoaderDismissed(page);

    const gate = page.locator("#welcome-gate");
    await expect(gate).toBeVisible();

    const sampleReleaseBounce = async (pullPx: number) => {
      return await page.evaluate(async (pull) => {
        const el = document.getElementById("welcome-gate")!;
        let hitBottom = false;
        let reboundPeak = 0;
        let done = false;

        const tick = () => {
          const t = getComputedStyle(el).transform;
          if (t && t !== "none") {
            const m = new DOMMatrixReadOnly(t);
            // Once the curtain falls back to near 0, track the rebound height
            if (m.m42 >= -4) {
              hitBottom = true;
            }
            if (hitBottom && m.m42 < reboundPeak) {
              reboundPeak = m.m42;
            }
          }
          if (!done) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);

        // Pull up by `pull` px
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientY: 500, button: 0 }));
        await new Promise((r) => setTimeout(r, 30));
        window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientY: 500 - pull }));
        // Pause so velocity settles below flick threshold (> 100ms)
        await new Promise((r) => setTimeout(r, 150));
        window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientY: 500 - pull }));

        // Wait for bounce animation to complete
        await new Promise((r) => setTimeout(r, 700));
        done = true;
        return Math.abs(reboundPeak);
      }, pullPx);
    };

    const reboundShort = await sampleReleaseBounce(35);
    await page.waitForTimeout(200);
    const reboundHigh = await sampleReleaseBounce(90);

    // Rebound from 90px pull is significantly harder than from 35px pull
    expect(reboundHigh).toBeGreaterThan(reboundShort * 1.8);
    expect(reboundShort).toBeGreaterThan(4);

    // Settle back to rest at the bottom (translateY(0))
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const el = document.getElementById("welcome-gate");
            return el ? getComputedStyle(el).transform : "removed";
          }),
        { timeout: 3_000 },
      )
      .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);

    // Gate is still armed and scroll locked
    await expect(gate).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  });

  test("tapping bounces upward and settles to the bottom without opening the gate", async ({
    page,
  }) => {
    test.slow();
    const metric = countOpenMetricPosts(page);

    await page.goto("/");
    await waitForLoaderDismissed(page);

    const gate = page.locator("#welcome-gate");
    await expect(gate).toBeVisible();

    // Tap the gate and record translateY samples across the bounce
    const bounceResult = await page.evaluate(async () => {
      const el = document.getElementById("welcome-gate")!;
      let minTranslateY = 0;
      let sampledCount = 0;
      let done = false;

      const tick = () => {
        const t = getComputedStyle(el).transform;
        if (t && t !== "none") {
          const m = new DOMMatrixReadOnly(t);
          if (m.m42 < minTranslateY) minTranslateY = m.m42;
          sampledCount++;
        }
        if (!done) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      // Simulate a tap (mousedown + mouseup without dragging)
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientY: 400, button: 0 }));
      await new Promise((r) => setTimeout(r, 50));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientY: 400, button: 0 }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientY: 400 }));

      // Wait for bounce animation to complete (~520ms)
      await new Promise((r) => setTimeout(r, 700));
      done = true;
      return { minTranslateY, sampledCount };
    });

    // The curtain bounced up (negative translateY peaking around -54px)
    expect(bounceResult.minTranslateY).toBeLessThan(-30);

    // Settled back to rest at the bottom (translateY(0))
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const el = document.getElementById("welcome-gate");
            return el ? getComputedStyle(el).transform : "removed";
          }),
        { timeout: 3_000 },
      )
      .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);

    // Tapping did NOT open the gate: gate is still visible, scroll still locked, no metric fired
    await expect(gate).toBeVisible();
    expect(metric.posts).toBe(0);
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");

    // Can still swipe/drag past threshold to open
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("viewport not set");
    await touchDrag(page, {
      fromY: viewport.height * 0.75,
      toY: viewport.height * 0.33,
      stepDelayMs: 16,
    });
    await expect(gate).toHaveCount(0);
  });
  test("touch tap via touchscreen bounces and does not open gate", async ({ page }) => {
    test.slow();
    const metric = countOpenMetricPosts(page);

    await page.goto("/");
    await waitForLoaderDismissed(page);

    const gate = page.locator("#welcome-gate");
    await expect(gate).toBeVisible();

    const viewport = page.viewportSize();
    if (!viewport) throw new Error("viewport not set");

    // Real touch tap (0 travel)
    await touchDrag(page, {
      fromY: viewport.height * 0.5,
      toY: viewport.height * 0.5,
      steps: 1,
    });

    // Gate must NOT open
    await expect(gate).toBeVisible();
    expect(metric.posts).toBe(0);

    // Settle to rest at bottom
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const el = document.getElementById("welcome-gate");
            return el ? getComputedStyle(el).transform : "removed";
          }),
        { timeout: 3_000 },
      )
      .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);

    // Still armed and scroll locked
    await expect(gate).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  });

  test("reduced motion dismisses instantly on first click with no slide", async ({ page }) => {
    test.slow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const metric = countOpenMetricPosts(page);

    await page.goto("/");
    await waitForLoaderDismissed(page);

    const gate = page.locator("#welcome-gate");
    await expect(gate).toBeVisible();

    // Scroll lock still applies while armed.
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");

    // First click dismisses without a slide: the element is removed, not
    // translated. Sample transform after the click — it must never carry a
    // non-zero translateY.
    await gate.click({ position: { x: 10, y: 10 } });
    const sawSlide = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        let moved = false;
        const start = performance.now();
        const tick = () => {
          const el = document.getElementById("welcome-gate");
          if (!el) return resolve(moved);
          const t = getComputedStyle(el).transform;
          if (t && t !== "none" && !/matrix\(1, 0, 0, 1, 0, 0\)/.test(t)) moved = true;
          if (performance.now() - start > 700) return resolve(moved);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    });
    expect(sawSlide).toBe(false);
    await expect(gate).toHaveCount(0);

    // Scroll unlocks on dismissal.
    await page.evaluate(() => window.scrollTo(0, 300));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(metric.posts).toBe(0); // anonymous
  });

  test("desktop wheel dismisses the gate without firing the metric", async ({
    page,
    browserName,
    isMobile,
  }) => {
    // Desktop-pointer-only behavior: the mobile-chrome Playwright project
    // (venue-map-routes 5.15) also runs this suite, but a synthesized wheel
    // event is meaningless from a touch device profile.
    test.skip(isMobile === true, `desktop-pointer behavior (${browserName})`);
    test.slow();
    const metric = countOpenMetricPosts(page);

    await page.goto("/");
    await waitForLoaderDismissed(page);

    const gate = page.locator("#welcome-gate");
    await expect(gate).toBeVisible();

    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, 120);

    await expect(gate).toHaveCount(0);
    expect(metric.posts).toBe(0); // no cookie → the client stays quiet
  });

  test("no JavaScript: the gate is hidden entirely", async ({ browser }) => {
    // scripting: none media query applies when JS is disabled — the gate must
    // not render, so the page is usable for no-JS visitors.
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      await page.goto("/", { waitUntil: "domcontentloaded" });

      const gate = page.locator("#welcome-gate");
      await expect(gate).toHaveCount(1); // SSR'd, but…
      await expect(gate).toHaveCSS("display", "none"); // …hidden outright
    } finally {
      await context.close();
    }
  });

  test("throttled network: scroll locked at 0 while loading, loader → gate → hero, no deadlock", async ({
    page,
  }) => {
    test.slow();
    // Slow the network so the loader genuinely holds; the bug 6.1 guards
    // against is the guest scrolling behind the loader and landing mid-timeline.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 300,
      downloadThroughput: 1024 * 1024, // ~1 MB/s — assets crawl
      uploadThroughput: 256 * 1024,
    });

    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });

      // First-paint invariant: the inline gate script has already armed and
      // locked scroll, so the document cannot drift to a mid-timeline scroll
      // position while assets are still streaming in.
      expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
      expect(await page.evaluate(() => window.scrollY)).toBe(0);

      // No gate/loader deadlock: the loader hides on its own media readiness
      // (it never waits on gate JS) and reveals the gate, not the hero.
      await waitForLoaderDismissed(page);
      await expect(page.locator("#welcome-gate")).toBeVisible();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    } finally {
      await cdp.detach();
    }
  });

  test("anonymous SSR HTML ships the gate with an empty greeting, phrases-only loader", async ({
    request,
  }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");

    const html = await response.text();

    // Gate ships in the initial HTML, greeting element rendered empty.
    expect(html).toContain('id="welcome-gate"');
    expect(html).toMatch(/id="gate-greeting"[^>]*>\s*<\/div>/);
    expect(html).toContain("Swipe up to open");

    // Loader reverted to shimmer phrases only.
    expect(html).not.toContain("invite-greeting");
  });

  test("background content is inert while armed, released after reveal", async ({ page }) => {
    test.slow();
    await page.goto("/");
    await waitForLoaderDismissed(page);

    const gate = page.locator("#welcome-gate");
    await expect(gate).toBeVisible();

    // While armed, <main> is removed from the a11y/focus tree.
    const main = page.locator("main");
    await expect(main).toHaveAttribute("inert", "");

    await page.keyboard.press("Escape");
    await expect(gate).toHaveCount(0);
    await expect(main).not.toHaveAttribute("inert", "");
  });

  test("keydown while the loader is up does not burn the reveal", async ({ page }) => {
    test.slow();
    const metric = countOpenMetricPosts(page);

    // Stall the hero image so the loader stays up deterministically — its hide
    // waits on hero fetch + decode only (the retired audio gate no longer
    // holds it) — which removes any dependence on machine/network speed.
    let releaseHero: (() => void) | undefined;
    const heroGate = new Promise<void>((resolve) => {
      releaseHero = resolve;
    });
    await page.route(/\/wedding_photo.*\.(webp|avif)$/, async (route) => {
      await heroGate;
      await route.continue();
    });

    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      // The loader is up (hero image blocked). A stray keypress must be ignored.
      await expect(page.locator("#loading-screen")).toHaveCount(1);
      const gate = page.locator("#welcome-gate");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await expect(gate).toHaveCount(1); // still armed
      expect(metric.posts).toBe(0);

      // Once the loader is gone, the same keypress dismisses normally.
      releaseHero!();
      await waitForLoaderDismissed(page);
      await page.keyboard.press("Escape");
      await expect(gate).toHaveCount(0);
    } finally {
      releaseHero!();
      await page.unroute(/\/wedding_photo.*\.(webp|avif)$/);
    }
  });
});
