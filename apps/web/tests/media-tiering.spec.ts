import { test, expect, type Page } from "@playwright/test";
import {
  CONNECTION_FULL,
  CONNECTION_LITE,
  CONNECTION_SLOW_NO_SAVE_DATA,
  currentTier,
  dismissWelcomeGate,
  pinFullTier,
  recordTierEvents,
  stubNetworkConnection,
  waitForLoaderDismissed,
} from "./helpers";

/**
 * Media-tiering end-to-end behavior (adaptive-media-tiering tasks 7.2,
 * 7.4–7.8, 7.10, 7.12).
 *
 * The tier is driven through `navigator.connection` stubs installed before any
 * page script runs. Tests that need network throttling or request abort
 * observations use CDP and are Chromium-only; everything else runs on the
 * chromium, mobile-chrome and webkit projects (the webkit project exists as
 * the 7.5/7.10 archive gate).
 */

test.setTimeout(180_000);

type ContainerInfo = {
  height: number;
  viewport: number;
  stagePosition: string;
  promoted: number;
  videoControls: boolean | null;
  videoPaused: boolean | null;
};

const containerInfo = (page: Page) =>
  page.evaluate<ContainerInfo>(() => {
    const container = document.getElementById("zoom-parallax-container")!;
    const video = document.getElementById("timeline-video") as HTMLVideoElement | null;
    return {
      height: Math.round(container.getBoundingClientRect().height),
      viewport: document.documentElement.clientHeight,
      stagePosition: getComputedStyle(container.querySelector(".zoom-stage")!).position,
      promoted: document.querySelectorAll("#zoom-parallax-container img[data-promoted]").length,
      videoControls: video?.hasAttribute("controls") ?? null,
      videoPaused: video?.paused ?? null,
    };
  });

/** Track network requests whose URL matches a string fragment or RegExp pattern. */
function trackRequests(page: Page, pattern: string | RegExp) {
  const urls: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    const match = typeof pattern === "string" ? url.includes(pattern) : pattern.test(url);
    if (match) urls.push(url);
  });
  return urls;
}

const tierEvents = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __tierEvents?: Array<{ tier: string; previous: string | null }> })
        .__tierEvents ?? [],
  );

const scrollCollageIntoView = (page: Page) =>
  page.evaluate(() => {
    document.getElementById("zoom-parallax-container")!.scrollIntoView({ block: "start" });
  });

/**
 * Find the page scroll that puts at least half of the timeline video card
 * inside the viewport. The timeline is a pinned horizontal scrub, so the
 * card's position is a function of scroll progress — sample the scrub until
 * the video's measured ratio clears the component's VISIBLE_RATIO (0.5).
 */
async function findVideoProgress(page: Page) {
  const at = await page.evaluate(async () => {
    const video = document.getElementById("timeline-video");
    const section = document.getElementById("timeline-section");
    if (!video || !section) return null;
    const stage = section.querySelector(".timeline-stage") as HTMLElement | null;
    if (!stage) return null;
    const top = section.getBoundingClientRect().top + window.scrollY;
    const travel = section.offsetHeight - stage.offsetHeight;
    for (let f = 0.02; f <= 1.0001; f += 0.02) {
      window.scrollTo(0, top + f * travel);
      await new Promise((r) => setTimeout(r, 80));
      const r = video.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const xOverlap = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const yOverlap = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      // IntersectionObserver's ratio is area-based; match it.
      const visible = (xOverlap * yOverlap) / (r.width * r.height);
      if (visible >= 0.5) return { f, top, travel };
    }
    return null;
  });
  return at;
}

const videoPaused = (page: Page) =>
  page.evaluate(
    () => (document.getElementById("timeline-video") as HTMLVideoElement | null)?.paused ?? null,
  );

/** Collect console errors and uncaught page errors. */
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

/** Chromium-only CDP network throttling. */
async function throttle(
  page: Page,
  opts: { downloadThroughput?: number; latency?: number; offline?: boolean },
) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: opts.offline ?? false,
    latency: opts.latency ?? 150,
    downloadThroughput: opts.downloadThroughput ?? 1024 * 1024,
    uploadThroughput: 256 * 1024,
  });
  return cdp;
}

test.describe("media tiering", () => {
  test.describe("lite from the initial verdict", () => {
    test("defers the collage, collapses the pin, hands the video to the guest, never touches the soundtrack", async ({
      page,
    }) => {
      stubNetworkConnection(page, CONNECTION_LITE);
      recordTierEvents(page);
      const mp3s = trackRequests(page, ".mp3");
      const videos = trackRequests(page, ".mp4");
      await page.goto("/");
      await waitForLoaderDismissed(page);

      expect(await currentTier(page)).toBe("lite");

      // No collage bytes on approach-free load (spec: "Lite tier pays per
      // approach" — the collage sits ~5 viewports down, far below the
      // promotion margin).
      const far = await containerInfo(page);
      expect(far.promoted).toBe(0);
      const placeholderCount = await page.evaluate(
        () => document.querySelectorAll('#zoom-parallax-container img[src$="-lqip.webp"]').length,
      );
      expect(placeholderCount).toBe(11);
      expect(mp3s).toEqual([]);
      expect(videos).toEqual([]);

      // Static grid: one viewport, un-pinned stage.
      expect(far.height).toBe(far.viewport);
      expect(far.stagePosition).toBe("relative");

      // The video is the guest's: controls, never auto-played.
      expect(far.videoControls).toBe(true);
      expect(far.videoPaused).toBe(true);

      // Approaching the collage promotes it (idempotent promoter).
      await scrollCollageIntoView(page);
      await expect
        .poll(async () => (await containerInfo(page)).promoted, { timeout: 20_000 })
        .toBe(11);
      // And the whole pageview stayed byte-free where it must be.
      expect(mp3s).toEqual([]);
      expect(videos).toEqual([]);
      expect(await tierEvents(page)).toEqual([]);
    });
  });

  test.describe("full from the API verdict", () => {
    test("promotes the collage at parse, binds the pin, preloads the soundtrack, hides video controls", async ({
      page,
    }) => {
      pinFullTier(page);
      recordTierEvents(page);
      const mp3s = trackRequests(page, ".mp3");
      const videos = trackRequests(page, ".mp4");

      await page.goto("/", { waitUntil: "domcontentloaded" });

      // Every collage source promoted synchronously during the parse.
      const info = await containerInfo(page);
      expect(info.promoted).toBe(11);

      // Pinned runway: 400lvh of travel, sticky stage.
      expect(info.height).toBeGreaterThan(3.5 * info.viewport);
      expect(info.stagePosition).toBe("sticky");

      // No parse-time video fetch on any tier; controls stay off on full.
      expect(info.videoControls).toBe(false);
      expect(videos).toEqual([]);

      // The soundtrack enables eager preloading before the gate commits.
      await expect.poll(() => mp3s.length, { timeout: 15_000 }).toBeGreaterThan(0);
      const gateDismissed = await page.evaluate(
        () =>
          document.getElementById("welcome-gate")?.getAttribute("data-gate-state") === "dismissed",
      );
      expect(gateDismissed).toBe(false);
      // An API-derived `full` never fires net-tier:change.
      expect(await tierEvents(page)).toEqual([]);
    });
  });

  test.describe("default full verdict without connection API (Safari/Firefox)", () => {
    test("defaults to full at parse, promotes collage, binds pin, preloads soundtrack", async ({
      page,
    }) => {
      stubNetworkConnection(page, null);
      recordTierEvents(page);
      const mp3s = trackRequests(page, ".mp3");

      await page.goto("/", { waitUntil: "domcontentloaded" });
      expect(await currentTier(page)).toBe("full");

      const info = await containerInfo(page);
      expect(info.promoted).toBe(11);
      expect(info.height).toBeGreaterThan(3.5 * info.viewport);
      expect(info.stagePosition).toBe("sticky");
      expect(info.videoControls).toBe(false);
      await expect.poll(() => mp3s.length, { timeout: 15_000 }).toBeGreaterThan(0);
      expect(await tierEvents(page)).toEqual([]);
    });
  });

  test.describe("connection stability", () => {
    test("a slow effectiveType without Save-Data is not downgraded", async ({ page }) => {
      stubNetworkConnection(page, CONNECTION_SLOW_NO_SAVE_DATA);
      recordTierEvents(page);
      const mp3s = trackRequests(page, ".mp3");

      await page.goto("/", { waitUntil: "domcontentloaded" });
      expect(await currentTier(page)).toBe("full");

      const info = await containerInfo(page);
      expect(info.promoted).toBe(11);
      expect(info.height).toBeGreaterThan(3.5 * info.viewport);
      expect(info.stagePosition).toBe("sticky");
      expect(info.videoControls).toBe(false);
      await expect.poll(() => mp3s.length, { timeout: 15_000 }).toBeGreaterThan(0);
      expect(await tierEvents(page)).toEqual([]);
    });
    test("Safari shape without connection API stays full even under slow network (production regression)", async ({
      page,
      browserName,
    }, testInfo) => {
      test.skip(
        browserName !== "chromium" || Boolean(testInfo.project.use.isMobile),
        "CDP network emulation on desktop Chromium only",
      );
      stubNetworkConnection(page, null);
      recordTierEvents(page);
      const mp3s = trackRequests(page, ".mp3");

      const cdp = await throttle(page, { downloadThroughput: 100 * 1024, latency: 100 });
      try {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2_000);

        expect(await currentTier(page)).toBe("full");
        const info = await containerInfo(page);
        expect(info.promoted).toBe(11);
        expect(info.height).toBeGreaterThan(3.5 * info.viewport);
        expect(info.stagePosition).toBe("sticky");
        expect(info.videoControls).toBe(false);
        await expect.poll(() => mp3s.length, { timeout: 15_000 }).toBeGreaterThan(0);
        expect(await tierEvents(page)).toEqual([]);
      } finally {
        await cdp.detach();
      }
    });
  });

  test.describe("warm-cache return visit", () => {
    test("a real second visit keeps the API-full verdict and the full experience", async ({
      page,
    }) => {
      // Outcome-level companion over the real cache: the first visit seeds it,
      // the reload revalidates. Whatever the burst turns out to measure on the
      // local server, an API-full guest must not end up lite.
      stubNetworkConnection(page, CONNECTION_FULL);

      await page.goto("/");
      await waitForLoaderDismissed(page);
      await page.waitForTimeout(1_000);

      await page.reload();
      await page.waitForLoadState("load");
      await page.waitForTimeout(1_500);

      expect(await currentTier(page)).toBe("full");
      const info = await containerInfo(page);
      expect(info.promoted).toBe(11);
      expect(info.height).toBeGreaterThan(3.5 * info.viewport);
    });
  });

  test.describe("rollback (7.7)", () => {
    test("no data-tier attribute degrades to the untiered full behavior", async ({ page }) => {
      // Model a build without the head script: swallow every data-tier write.
      await page.addInitScript(() => {
        const original = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function (name, value) {
          if (name === "data-tier") return;
          return original.call(this, name, value);
        };
      });
      recordTierEvents(page);
      const mp3s = trackRequests(page, ".mp3");

      await page.goto("/", { waitUntil: "domcontentloaded" });

      expect(await page.evaluate(() => document.documentElement.hasAttribute("data-tier"))).toBe(
        false,
      );

      // Collage promoted, pin bound, video plays in view, soundtrack preloads.
      expect(await containerInfo(page)).toMatchObject({
        promoted: 11,
        videoControls: false,
      });
      const info = await containerInfo(page);
      expect(info.height).toBeGreaterThan(3.5 * info.viewport);

      await expect.poll(() => mp3s.length, { timeout: 15_000 }).toBeGreaterThan(0);

      // Play-in-view policy is live on the untiered page too.
      await dismissWelcomeGate(page);
      const at = await findVideoProgress(page);
      expect(at).not.toBeNull();
      await page.evaluate(({ top, travel, f }) => window.scrollTo(0, top + f * travel), at!);
      await expect.poll(() => videoPaused(page), { timeout: 15_000 }).toBe(false);
    });
  });

  test.describe("timeline video lifecycle on full (7.5)", () => {
    test("plays once half the card is in view and pauses on the way out", async ({ page }) => {
      pinFullTier(page);
      const videos = trackRequests(page, ".mp4");

      await page.goto("/");
      await dismissWelcomeGate(page);

      // No bytes moved for the video until the card approaches.
      expect(videos).toEqual([]);

      const at = await findVideoProgress(page);
      expect(at).not.toBeNull();

      await page.evaluate(({ top, travel, f }) => window.scrollTo(0, top + f * travel), at!);
      await expect.poll(() => videoPaused(page), { timeout: 15_000 }).toBe(false);
      // Playing fetched the file — exactly once, on visibility.
      await expect.poll(() => videos.length, { timeout: 15_000 }).toBeGreaterThan(0);

      // Scrolling the card out pauses it (ratio < 0.5 must be delivered —
      // the threshold list carries 0 for exactly that reason).
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => videoPaused(page), { timeout: 15_000 }).toBe(true);
    });
  });

  test.describe("field check under network emulation (7.8, chromium/CDP)", () => {
    test("a fast link: full matches the pre-change behavior", async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "CDP network emulation");
      const errors = collectErrors(page);
      const mp3s = trackRequests(page, ".mp3");

      // LTE-class: comfortably above the 220 KB/s floor, so the measured
      // verdict agrees with the API and stays full.
      const cdp = await throttle(page, { downloadThroughput: 9 * 1024 * 1024, latency: 50 });
      try {
        await page.goto("/");
        await expect.poll(() => currentTier(page), { timeout: 30_000 }).toBe("full");
        await waitForLoaderDismissed(page);

        const info = await containerInfo(page);
        expect(info.promoted).toBe(11);
        expect(info.height).toBeGreaterThan(3.5 * info.viewport);
        expect(info.videoControls).toBe(false);
        await expect.poll(() => mp3s.length, { timeout: 30_000 }).toBeGreaterThan(0);

        expect(errors).toEqual([]);
      } finally {
        await cdp.detach();
      }
    });

    test("offline after load: the page stays interactive and silent", async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== "chromium", "CDP network emulation");
      pinFullTier(page);
      const errors = collectErrors(page);

      await page.goto("/");
      await dismissWelcomeGate(page);

      const cdp = await throttle(page, { offline: true });
      try {
        await page.evaluate(() => window.scrollTo(0, 600));
        await page.waitForTimeout(1_000);
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
        expect(errors).toEqual([]);
      } finally {
        await cdp.detach();
      }
    });
  });
});
