import { test, expect, type Page } from "@playwright/test";
import { waitForLoaderDismissed } from "./helpers";

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
  test("swipe past threshold reveals, unlocks scroll, starts music, fires the metric once", async ({
    page,
    context,
  }) => {
    test.slow(); // loader gates on audio canplay + hero image decode

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

  test("desktop wheel dismisses the gate without firing the metric", async ({ page }) => {
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

    // Stall the music so the loader stays up deterministically (its hide waits
    // on canplay) — removes any dependence on machine/network speed.
    let releaseAudio: (() => void) | undefined;
    const audioGate = new Promise<void>((resolve) => {
      releaseAudio = resolve;
    });
    await page.route("**/*.mp3", async (route) => {
      await audioGate;
      await route.continue();
    });

    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      // The loader is up (audio blocked). A stray keypress must be ignored.
      await expect(page.locator("#loading-screen")).toHaveCount(1);
      const gate = page.locator("#welcome-gate");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await expect(gate).toHaveCount(1); // still armed
      expect(metric.posts).toBe(0);

      // Once the loader is gone, the same keypress dismisses normally.
      releaseAudio!();
      await waitForLoaderDismissed(page);
      await page.keyboard.press("Escape");
      await expect(gate).toHaveCount(0);
    } finally {
      releaseAudio!();
      await page.unroute("**/*.mp3");
    }
  });
});
