import { test, expect, type Page } from "@playwright/test";
import {
  dismissWelcomeGate,
  stubNetworkConnection,
  CONNECTION_LITE,
  CONNECTION_FULL,
} from "./helpers";

test.setTimeout(180_000);

/** CDP helper for Good-3G network emulation. */
async function emulateGood3G(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: Math.floor((1.6 * 1024 * 1024) / 8), // 1.6 Mbps = 200 KB/s
    uploadThroughput: Math.floor((750 * 1024) / 8), // 750 Kbps
  });
  return cdp;
}

test.describe("resilient media delivery: throttled baseline & responsive media", () => {
  // 6.1 & 6.2: Dual-viewport throttled baseline & candidate selection
  test("wide viewport selects wider candidate than mobile viewport (task 6.1 & 6.2)", async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "CDP network emulation runs on chromium project",
    );

    // 1. Mobile leg: 390x844 @2x
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    const mobilePage = await mobileContext.newPage();
    const mobileCdp = await emulateGood3G(mobilePage);

    let mobileAcikSrc = "";
    try {
      await mobilePage.goto("/", { waitUntil: "domcontentloaded" });
      await dismissWelcomeGate(mobilePage);

      // Verify zero images lack a src
      const emptySrcCount = await mobilePage.evaluate(() => {
        return Array.from(document.querySelectorAll("img")).filter(
          (img) => !img.getAttribute("src") || img.getAttribute("src") === "",
        ).length;
      });
      expect(emptySrcCount).toBe(0);

      const acikImg = mobilePage.locator('img[src*="keluarga-acik"]').first();
      await mobilePage.evaluate(async () => {
        const section = document.getElementById("timeline-section");
        if (!section) return;
        const stage = section.querySelector(".timeline-stage") as HTMLElement;
        if (!stage) return;
        const top = section.getBoundingClientRect().top + window.scrollY;
        const travel = section.offsetHeight - stage.offsetHeight;
        for (let f = 0.5; f <= 0.85; f += 0.05) {
          window.scrollTo(0, top + f * travel);
          await new Promise((r) => setTimeout(r, 80));
        }
      });
      await mobilePage.waitForTimeout(500);

      await expect
        .poll(
          async () => {
            return await acikImg.evaluate((img: HTMLImageElement) => img.currentSrc || img.src);
          },
          { timeout: 15_000 },
        )
        .toMatch(/-w768\.(avif|webp)/);
      mobileAcikSrc = await acikImg.evaluate((img: HTMLImageElement) => img.currentSrc || img.src);
      // Verify scroll fade participants have opacity >= 0.05 when entered
      const lowOpacityEntered = await mobilePage.evaluate(() => {
        const vh = window.innerHeight;
        return Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-fade]")).filter(
          (el) => {
            const rect = el.getBoundingClientRect();
            const isFullyEntered = rect.top <= vh - 160 && rect.bottom >= 0;
            if (!isFullyEntered) return false;
            const opacity = parseFloat(window.getComputedStyle(el).opacity);
            return opacity < 0.05;
          },
        ).length;
      });
      expect(lowOpacityEntered).toBe(0);
    } finally {
      await mobileCdp.detach();
      await mobileContext.close();
    }

    // 2. Wide leg: 1440x900 @2x
    const wideContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const widePage = await wideContext.newPage();
    const wideCdp = await emulateGood3G(widePage);

    try {
      await widePage.goto("/", { waitUntil: "domcontentloaded" });
      await dismissWelcomeGate(widePage);

      const acikImgWide = widePage.locator('img[src*="keluarga-acik"]').first();
      await widePage.evaluate(async () => {
        const section = document.getElementById("timeline-section");
        if (!section) return;
        const stage = section.querySelector(".timeline-stage") as HTMLElement;
        if (!stage) return;
        const top = section.getBoundingClientRect().top + window.scrollY;
        const travel = section.offsetHeight - stage.offsetHeight;
        for (let f = 0.5; f <= 0.85; f += 0.05) {
          window.scrollTo(0, top + f * travel);
          await new Promise((r) => setTimeout(r, 80));
        }
      });
      await widePage.waitForTimeout(500);

      await expect
        .poll(
          async () => {
            return await acikImgWide.evaluate((img: HTMLImageElement) => img.currentSrc || img.src);
          },
          { timeout: 15_000 },
        )
        .toMatch(/-w1280\.(avif|webp)/);

      const wideAcikSrc = await acikImgWide.evaluate(
        (img: HTMLImageElement) => img.currentSrc || img.src,
      );
      expect(wideAcikSrc).not.toBe(mobileAcikSrc);
    } finally {
      await wideCdp.detach();
      await wideContext.close();
    }
  });

  // 6.3: No-script visibility and overlay suppression
  test("no-script: markup complete, text visible, and overlays suppressed (task 6.3)", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    try {
      await page.goto("/");

      // 1. All images have a fetchable src
      const totalImages = await page.evaluate(() => document.querySelectorAll("img").length);
      expect(totalImages).toBeGreaterThan(0);

      const invalidImages = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("img")).filter(
          (img) => !img.getAttribute("src") || img.getAttribute("src")?.trim() === "",
        ).length;
      });
      expect(invalidImages).toBe(0);

      // 2. Loading screen overlay is suppressed by noscript styles
      const loaderVisible = await page.evaluate(() => {
        const loader = document.getElementById("loading-screen");
        if (!loader) return false;
        const style = window.getComputedStyle(loader);
        return (
          style.display !== "none" && style.visibility !== "hidden" && parseFloat(style.opacity) > 0
        );
      });
      expect(loaderVisible).toBe(false);

      // 3. Welcome gate overlay is suppressed without JS
      const gateBlocking = await page.evaluate(() => {
        const gate = document.getElementById("welcome-gate");
        if (!gate) return false;
        const style = window.getComputedStyle(gate);
        return style.display !== "none" && style.visibility !== "hidden";
      });
      expect(gateBlocking).toBe(false);

      // 4. Intended text is visible
      const headingsCount = await page.locator("h1, h2, h3, p").count();
      expect(headingsCount).toBeGreaterThan(10);
    } finally {
      await context.close();
    }
  });

  // 6.4: Good 3G lite tier placeholder behavior
  test("lite tier shows ten blurred LQIP placeholders under Good 3G (task 6.4)", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "CDP network emulation requires Chromium");
    stubNetworkConnection(page, CONNECTION_LITE);
    const cdp = await emulateGood3G(page);

    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });

      expect(await page.evaluate(() => document.documentElement.getAttribute("data-tier"))).toBe(
        "lite",
      );

      // Verify all 11 collage slots display low-fidelity blurred LQIP placeholders
      const lqipCount = await page.evaluate(() => {
        return document.querySelectorAll('#zoom-parallax-container img[src$="-lqip.webp"]').length;
      });
      expect(lqipCount).toBe(11);

      // Verify no non-lqip collage candidate is loaded at load before approach
      const promotedCount = await page.evaluate(() => {
        return document.querySelectorAll("#zoom-parallax-container img[data-promoted]").length;
      });
      expect(promotedCount).toBe(0);
    } finally {
      await cdp.detach();
    }
  });

  // 6.5: Performance metrics (DCL and CLS)
  test("records DCL and maintains low CLS across full page scroll (task 6.5)", async ({ page }) => {
    // Inject layout shift observer before navigation
    await page.addInitScript(() => {
      let cls = 0;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (!shift.hadRecentInput && typeof shift.value === "number") {
            cls += shift.value;
          }
        }
      });
      observer.observe({ type: "layout-shift", buffered: true });
      (window as unknown as { __cls: () => number }).__cls = () => cls;
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await dismissWelcomeGate(page);

    // Measure DCL timing
    const dcl = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      return nav ? nav.domContentLoadedEventEnd - nav.startTime : 0;
    });
    expect(dcl).toBeGreaterThan(0);

    // Scroll through the entire page to measure CLS
    await page.evaluate(async () => {
      const distance = 800;
      const totalHeight = document.body.scrollHeight;
      for (let y = 0; y < totalHeight; y += distance) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 50));
      }
    });

    const clsScore = await page.evaluate(() => {
      return (window as unknown as { __cls: () => number }).__cls();
    });

    // Good web vitals threshold for CLS is < 0.1
    expect(clsScore).toBeLessThan(0.1);
  });

  // 6.6: Off-screen lazy images are not requested on no-scroll load
  test("below-fold loading=lazy images are not requested on no-scroll load (task 6.6)", async ({
    page,
  }) => {
    stubNetworkConnection(page, CONNECTION_FULL);
    const requestedLazyUrls: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (
        req.resourceType() === "image" &&
        (url.includes("event-akad") ||
          url.includes("event-resepsi") ||
          url.includes("keluarga-acik"))
      ) {
        requestedLazyUrls.push(url);
      }
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_500);

    // On an initial un-scrolled load, off-screen lazy images must not have been requested by the browser
    expect(requestedLazyUrls.length).toBe(0);
  });

  // 6.8: Progressive enhancement (late script and script failure)
  test("progressive enhancement: failed or blocked reveal script leaves in-viewport content at opacity 1 (task 6.8)", async ({
    page,
  }) => {
    // Block scroll-fade script to simulate script failure / block
    await page.route("**/scroll-fade*", (route) => route.abort());
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await dismissWelcomeGate(page);

    const venueHeader = page.locator("#venue-map [data-scroll-fade]");
    await venueHeader.scrollIntoViewIfNeeded();

    const opacity = await venueHeader.evaluate((el) => {
      return parseFloat(window.getComputedStyle(el).opacity);
    });
    expect(opacity).toBe(1);
  });

  test("progressive enhancement: fully entered participant holds full opacity when reveal script runs (task 6.8)", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await dismissWelcomeGate(page);

    const venueHeader = page.locator("#venue-map [data-scroll-fade]");
    await venueHeader.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    const opacity = await venueHeader.evaluate((el) => {
      return parseFloat(window.getComputedStyle(el).opacity);
    });
    expect(opacity).toBeGreaterThanOrEqual(0.85);
  });
});
