import { test, expect, type Page } from "@playwright/test";
import {
  CONNECTION_FULL,
  CONNECTION_LITE,
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
      promoted: document.querySelectorAll("#zoom-parallax-container img[src]").length,
      videoControls: video?.hasAttribute("controls") ?? null,
      videoPaused: video?.paused ?? null,
    };
  });

/** Track network requests whose URL contains a fragment. */
function trackRequests(page: Page, fragment: string) {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(fragment)) urls.push(request.url());
  });
  return urls;
}

const tierEvents = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __tierEvents?: Array<{ tier: string; previous: string | null }> })
        .__tierEvents ?? [],
  );

/** Collage asset names (everything ZoomParallax defers behind data-src). */

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
        .toBe(10);

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
      expect(info.promoted).toBe(10);

      // Pinned runway: 400lvh of travel, sticky stage.
      expect(info.height).toBeGreaterThan(3.5 * info.viewport);
      expect(info.stagePosition).toBe("sticky");

      // No parse-time video fetch on any tier; controls stay off on full.
      expect(info.videoControls).toBe(false);
      expect(videos).toEqual([]);

      // The soundtrack restores eager preloading at the verdict.
      await expect.poll(() => mp3s.length, { timeout: 15_000 }).toBeGreaterThan(0);

      // An API-derived `full` never fires net-tier:change.
      expect(await tierEvents(page)).toEqual([]);
    });
  });

  test.describe("pending", () => {
    test("resolves to full on a fast link by measurement", async ({ page }) => {
      // Engine without the Network Information API (Safari/Firefox shape).
      stubNetworkConnection(page, null);
      recordTierEvents(page);

      await page.goto("/");
      await expect.poll(() => currentTier(page), { timeout: 20_000 }).toBe("full");

      // The collage promoted at resolution; the pin bound.
      const info = await containerInfo(page);
      expect(info.promoted).toBe(10);
      expect(info.height).toBeGreaterThan(3.5 * info.viewport);
      expect(info.stagePosition).toBe("sticky");

      // Exactly one resolution, one-way, announced once.
      expect(await tierEvents(page)).toEqual([{ tier: "full", previous: "pending" }]);
    });

    test("warm cache resolves pending to full on locality evidence, second visit included (7.10)", async ({
      page,
      browserName,
    }) => {
      test.slow();
      stubNetworkConnection(page, null);
      recordTierEvents(page);

      // First visit seeds the cache (module chunks, public/ revalidations).
      await page.goto("/");
      await page.waitForLoadState("load");
      await page.waitForTimeout(500);

      // Second visit: the burst revalidates instead of transferring.
      await page.reload();
      await page.waitForLoadState("load");
      await page.waitForTimeout(1_000);

      const tier = await currentTier(page);
      const events = await tierEvents(page);

      // The resource list the verdict saw: the revalidation/memory-hit class
      // must be present and sizable, and the counted payload must sit under
      // the 8 KB load floor — i.e. the verdict came from locality, not from a
      // measured burst.
      const probe = await page.evaluate(() => {
        const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        const locality = entries.filter(
          (e) =>
            (e.encodedBodySize ?? 0) === 0 &&
            ((e.transferSize ?? 0) > 0 || (e.decodedBodySize ?? 0) > 0),
        );
        return { total: entries.length, localityHits: locality.length };
      });

      // The revalidation/memory-hit class the verdict saw (Chromium measured:
      // headers-only 304s). On WebKit this doubles as the 9.16 archive gate —
      // if that engine reports no sizes for same-origin revalidations, the
      // locality branch never fires and the outcome assertion below fails.
      if (browserName === "chromium") {
        expect(probe.localityHits).toBeGreaterThanOrEqual(5);
      }

      // Option A (9.13): full — the deferred media is already on the device.
      expect(tier).toBe("full");
      const info = await containerInfo(page);
      expect(info.height).toBeGreaterThan(3.5 * info.viewport);
      expect(events[events.length - 1]).toEqual({ tier: "full", previous: "pending" });
    });
  });

  test.describe("measured downgrade (chromium/CDP)", () => {
    test("a slow burst downgrades API-full to lite and the downgrade is one-way (7.2)", async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== "chromium", "CDP network emulation");
      stubNetworkConnection(page, CONNECTION_FULL);
      recordTierEvents(page);

      // ~100 KB/s: under the 220 KB/s verdict floor.
      const cdp = await throttle(page, { downloadThroughput: 100 * 1024 });
      try {
        await page.goto("/", { waitUntil: "domcontentloaded" });

        // The throttle slows module loads past DCL, so the measurement can
        // resolve before we look; the recorded event's `previous` proves the
        // synchronous API verdict was `full` before the burst spoke.
        await expect.poll(() => currentTier(page), { timeout: 30_000 }).toBe("lite");

        // The downgrade collapses the pin and hands the video over.
        const info = await containerInfo(page);
        expect(info.height).toBe(info.viewport);
        expect(info.stagePosition).toBe("relative");
        expect(info.videoControls).toBe(true);

        // One-way: nothing upgrades it back mid-pageview.
        await page.waitForTimeout(1_000);
        expect(await currentTier(page)).toBe("lite");
        expect(await tierEvents(page)).toEqual([{ tier: "lite", previous: "full" }]);
      } finally {
        await cdp.detach();
      }
    });

    test("downgrade aborts a soundtrack preload already in flight (7.6)", async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== "chromium", "CDP request abort observations");
      stubNetworkConnection(page, CONNECTION_FULL);
      recordTierEvents(page);

      // Hold the 3.1 MB preload in flight so the abort is observable: the
      // request stays pending until after the downgrade.
      let releaseMp3 = () => {};
      const mp3Gate = new Promise<void>((resolve) => {
        releaseMp3 = resolve;
      });
      const mp3Requests: string[] = [];
      const mp3Failures: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes(".mp3")) mp3Requests.push(request.url());
      });
      page.on("requestfailed", (request) => {
        if (request.url().includes(".mp3")) mp3Failures.push(request.failure()?.errorText ?? "?");
      });
      await page.route("**/*.mp3", async (route) => {
        try {
          await mp3Gate;
          await route.continue();
        } catch {
          /* the abort we are asserting cancelled this request */
        }
      });

      // Keep the burst measurement silent for the first 3 s (empty buffer),
      // then let it read a genuinely slow burst — long after the parse-time
      // preload began. Without the hold, a localhost preload finishes before
      // any real measurement could speak.
      await page.addInitScript(() => {
        const real = performance.getEntriesByType.bind(performance);
        const slowBurst = [
          {
            name: "/slow-burst.webp",
            initiatorType: "img",
            startTime: 100,
            responseEnd: 1100,
            duration: 1000,
            transferSize: 60 * 1024,
            encodedBodySize: 60 * 1024,
            decodedBodySize: 60 * 1024,
          },
        ];
        let injected = false;
        setTimeout(() => {
          injected = true;
        }, 3000);
        performance.getEntriesByType = (type: string) =>
          type === "resource"
            ? injected
              ? (slowBurst as unknown as PerformanceResourceTiming[])
              : []
            : real(type);
      });

      try {
        await page.goto("/", { waitUntil: "domcontentloaded" });

        // The soundtrack preloaded at the API-full verdict — and is held
        // mid-flight by the route above.
        await expect.poll(() => mp3Requests.length, { timeout: 10_000 }).toBeGreaterThan(0);

        // The slow burst lands: full downgrades to lite.
        await expect.poll(() => currentTier(page), { timeout: 20_000 }).toBe("lite");
        expect(await tierEvents(page)).toEqual([{ tier: "lite", previous: "full" }]);

        // disableSoundtrack(): pause, drop the sources, load() — the only
        // reliable media abort. The dropped <source> children are its marker.
        await expect
          .poll(() => page.evaluate(() => document.querySelectorAll("#hero-music source").length))
          .toBe(0);

        // The in-flight mp3 fetch was cancelled, not completed.
        await expect.poll(() => mp3Failures.length, { timeout: 10_000 }).toBeGreaterThan(0);
      } finally {
        releaseMp3();
        await page.unroute("**/*.mp3");
      }
    });
  });

  test.describe("warm-cache regression (7.4, chromium)", () => {
    test("payload-free asset burst + large slow API calls keeps the API-full verdict", async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== "chromium", "Chromium resource-timing shapes");
      // The 9.1 profile, modeled at the probe's input boundary: a payload-free
      // asset burst (revalidation-shaped entries, 23 locality hits) plus the
      // page's own API responses moving 80 KB over a slow round trip. If the
      // probe counted programmatic entries, it would measure idle RTT as
      // throughput and downgrade an API-full guest mid-session, after the
      // collage and soundtrack were already promoted. (Real dev-server reloads
      // re-download the media payload, so the warm shape is injected rather
      // than reproduced; the ladder itself is pinned by the node harness.)
      stubNetworkConnection(page, CONNECTION_FULL);
      recordTierEvents(page);
      await page.addInitScript(() => {
        const synthetic = [
          ...Array.from({ length: 23 }, (_, i) => ({
            name: `/revalidated-${i}.webp`,
            initiatorType: "img",
            startTime: 100 + i * 50,
            responseEnd: 140 + i * 50,
            duration: 40,
            transferSize: 300,
            encodedBodySize: 0,
            decodedBodySize: 0,
          })),
          {
            name: "/api/guest-photos",
            initiatorType: "fetch",
            startTime: 1500,
            responseEnd: 5300,
            duration: 3800,
            transferSize: 70_000,
            encodedBodySize: 70_000,
            decodedBodySize: 70_000,
          },
          {
            name: "/api/invite/me",
            initiatorType: "fetch",
            startTime: 1600,
            responseEnd: 4400,
            duration: 2800,
            transferSize: 10_000,
            encodedBodySize: 10_000,
            decodedBodySize: 10_000,
          },
        ];
        const real = performance.getEntriesByType.bind(performance);
        performance.getEntriesByType = (type: string) =>
          type === "resource" ? (synthetic as unknown as PerformanceResourceTiming[]) : real(type);
      });

      await page.goto("/");
      await page.waitForLoadState("load");
      await page.waitForTimeout(1_500); // past the load handler

      // The verdict must not have moved: an API-derived `full` whose only
      // payload is programmatic stays full and announces nothing.
      expect(await currentTier(page)).toBe("full");
      expect(await tierEvents(page)).toEqual([]);

      // Assert the resource list the verdict saw — the exclusion was
      // exercised, not vacuous: the buffer's fetch entries moved enough bytes
      // to cross the 48 KB probe floor, and every asset entry is payload-free.
      const probe = await page.evaluate(() => {
        const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        const api = entries.filter(
          (e) => e.initiatorType === "fetch" || e.initiatorType === "xmlhttprequest",
        );
        const assets = entries.filter(
          (e) =>
            e.initiatorType !== "fetch" &&
            e.initiatorType !== "xmlhttprequest" &&
            e.initiatorType !== "beacon" &&
            e.initiatorType !== "ping",
        );
        return {
          apiCount: api.length,
          apiPayloadBytes: api.reduce((n, e) => n + (e.encodedBodySize ?? 0), 0),
          assetPayloadBytes: assets.reduce((n, e) => n + (e.encodedBodySize ?? 0), 0),
          assetLocalHits: assets.filter(
            (e) => (e.encodedBodySize ?? 0) === 0 && (e.transferSize ?? 0) > 0,
          ).length,
        };
      });
      expect(probe.apiCount).toBe(2);
      expect(probe.apiPayloadBytes).toBeGreaterThanOrEqual(48 * 1024);
      expect(probe.assetPayloadBytes).toBe(0);
      expect(probe.assetLocalHits).toBe(23);
    });

    test("a real second visit keeps the API-full verdict and the full experience", async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== "chromium", "Chromium resource-timing shapes");
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
      expect(info.promoted).toBe(10);
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
        promoted: 10,
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

  test.describe("pending → lite is silent (7.12, chromium/CDP)", () => {
    test("disableSoundtrack()'s load() on a now-sourceless element raises no console error", async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== "chromium", "CDP network emulation");
      stubNetworkConnection(page, null);
      recordTierEvents(page);
      const errors = collectErrors(page);

      const cdp = await throttle(page, { downloadThroughput: 100 * 1024 });
      try {
        await page.goto("/", { waitUntil: "domcontentloaded" });

        // The measured slow burst resolves pending → lite — the common path,
        // not only a downgrade from a promoted full. The throttle can resolve
        // it before DCL, so assert the transition through the recorded events.
        await expect.poll(() => currentTier(page), { timeout: 30_000 }).toBe("lite");
        expect(await tierEvents(page)).toEqual([{ tier: "lite", previous: "pending" }]);

        // The abort ran: sourceless element, no-source network state.
        await page.waitForFunction(
          () => {
            const state = (document.getElementById("hero-music") as HTMLAudioElement).networkState;
            return state === 1 /* NETWORK_IDLE */ || state === 3; /* NETWORK_NO_SOURCE */
          },
          undefined,
          { timeout: 10_000 },
        );

        // Nothing listened for the resulting error — and nothing logged one.
        await page.waitForTimeout(1_000);
        expect(errors).toEqual([]);
      } finally {
        await cdp.detach();
      }
    });
  });

  test.describe("field check under network emulation (7.8, chromium/CDP)", () => {
    test("Good 3G: measured lite renders a readable static grid and the timeline story", async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== "chromium", "CDP network emulation");
      const errors = collectErrors(page);

      // ~1.6 Mbps ≈ 190 KB/s: Good-3G territory, below the 220 KB/s floor.
      const cdp = await throttle(page, { downloadThroughput: 190 * 1024, latency: 150 });
      try {
        await page.goto("/");
        await expect.poll(() => currentTier(page), { timeout: 45_000 }).toBe("lite");
        await waitForLoaderDismissed(page);

        const info = await containerInfo(page);
        expect(info.height).toBe(info.viewport);
        expect(info.stagePosition).toBe("relative");

        // The story still ships: the timeline's photos are real markup.
        const timelinePhotos = await page.evaluate(
          () => document.querySelectorAll("#timeline-section img[src]").length,
        );
        expect(timelinePhotos).toBeGreaterThan(0);

        // And the collage promotes on approach.
        await scrollCollageIntoView(page);
        await expect
          .poll(async () => (await containerInfo(page)).promoted, { timeout: 45_000 })
          .toBe(10);

        expect(errors).toEqual([]);
      } finally {
        await cdp.detach();
      }
    });

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
        expect(info.promoted).toBe(10);
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
