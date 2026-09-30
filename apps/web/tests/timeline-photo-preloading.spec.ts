import { test, expect } from "@playwright/test";
import { dismissWelcomeGate, stubNetworkConnection, CONNECTION_FULL } from "./helpers";

test.describe("timeline photo preloading", () => {
  test("initial page load does not request timeline photos above the fold", async ({ page }) => {
    stubNetworkConnection(page, CONNECTION_FULL);
    const requestedTimelineUrls: string[] = [];

    page.on("request", (req) => {
      const url = req.url();
      if (
        req.resourceType() === "image" &&
        (url.includes("awal-perkenalan") ||
          url.includes("keluarga-yofri") ||
          url.includes("keluarga-acik"))
      ) {
        requestedTimelineUrls.push(url);
      }
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_500);

    expect(requestedTimelineUrls.length).toBe(0);
  });

  test("approaching #timeline-section triggers preloading, loading='eager', and data-loaded='true'", async ({
    page,
  }) => {
    stubNetworkConnection(page, CONNECTION_FULL);
    const requestedTimelineUrls: string[] = [];

    page.on("request", (req) => {
      const url = req.url();
      if (
        req.resourceType() === "image" &&
        (url.includes("awal-perkenalan") ||
          url.includes("keluarga-yofri") ||
          url.includes("keluarga-acik"))
      ) {
        requestedTimelineUrls.push(url);
      }
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await dismissWelcomeGate(page);

    // Scroll to within approach distance of #timeline-section (e.g. 1 viewport above section)
    await page.evaluate(() => {
      const section = document.getElementById("timeline-section");
      if (!section) return;
      const top = section.getBoundingClientRect().top + window.scrollY;
      const vh = window.innerHeight;
      window.scrollTo(0, Math.max(0, top - vh * 0.8));
    });

    // Wait for the approach observer to fire and images to be promoted and decoded
    const timelineImages = page.locator("#timeline-track img");
    await expect(timelineImages).toHaveCount(3);

    // Verify all 3 images are promoted to eager
    await expect
      .poll(async () => {
        return await timelineImages.evaluateAll((imgs) =>
          imgs.map((img: HTMLImageElement) => img.loading),
        );
      })
      .toEqual(["eager", "eager", "eager"]);

    // Verify network requests were issued
    await expect.poll(() => requestedTimelineUrls.length).toBeGreaterThanOrEqual(3);

    // Verify data-loaded="true" is set on all 3 images
    await expect
      .poll(async () => {
        return await timelineImages.evaluateAll((imgs) =>
          imgs.map((img: HTMLImageElement) => img.dataset.loaded),
        );
      })
      .toEqual(["true", "true", "true"]);

    // Verify computed opacity transitions to 1
    await expect
      .poll(async () => {
        return await timelineImages.evaluateAll((imgs) =>
          imgs.map((img) => window.getComputedStyle(img).opacity),
        );
      })
      .toEqual(["1", "1", "1"]);
  });

  test("horizontal scrub reveals nodes with decoded images at full opacity", async ({ page }) => {
    stubNetworkConnection(page, CONNECTION_FULL);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await dismissWelcomeGate(page);

    // Scrub through the timeline section
    await page.evaluate(async () => {
      const section = document.getElementById("timeline-section");
      if (!section) return;
      const stage = section.querySelector(".timeline-stage") as HTMLElement;
      if (!stage) return;
      const top = section.getBoundingClientRect().top + window.scrollY;
      const travel = section.offsetHeight - stage.offsetHeight;

      // Scrub through Node 2, Node 3, and Node 4
      for (let f = 0.2; f <= 0.8; f += 0.1) {
        window.scrollTo(0, top + f * travel);
        await new Promise((r) => setTimeout(r, 60));
      }
    });

    const timelineImages = page.locator("#timeline-track img");
    await expect
      .poll(async () => {
        return await timelineImages.evaluateAll((imgs) =>
          imgs.map((img: HTMLImageElement) => img.dataset.loaded),
        );
      })
      .toEqual(["true", "true", "true"]);

    const opacities = await timelineImages.evaluateAll((imgs) =>
      imgs.map((img) => window.getComputedStyle(img).opacity),
    );
    expect(opacities).toEqual(["1", "1", "1"]);
  });

  test("noscript renders timeline images with opacity 1", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.goto("/");
      const images = page.locator(".timeline-node img");
      await expect(images).toHaveCount(3);
      const opacities = await images.evaluateAll((imgs) =>
        imgs.map((img) => window.getComputedStyle(img).opacity),
      );
      expect(opacities).toEqual(["1", "1", "1"]);
    } finally {
      await context.close();
    }
  });
});
