import { test, expect } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

test.describe("scroll-fade animation on key sections", () => {
  test("all specified elements carry data-scroll-fade and animate on scroll", async ({ page }) => {
    await page.goto("/");
    await dismissWelcomeGate(page);

    // 1. "Show Our Memories..."
    const memoriesHeading = page.locator("#memories-section [data-scroll-fade]");
    await expect(memoriesHeading).toBeAttached();
    await expect(memoriesHeading).toContainText("Show Our Memories Together");
    await expect(memoriesHeading.locator("h2")).toHaveClass(/font-serif/);

    // 2. "Venue, Graha 58..., Surakarta..."
    const venueHeader = page.locator("#venue-map [data-scroll-fade]");
    await expect(venueHeader).toBeAttached();
    await expect(venueHeader).toContainText("Venue");
    await expect(venueHeader).toContainText("Graha 58 Gedung Serbaguna UMS");

    // 3. "Number ticker, confirmed text"
    const tickerBlock = page.locator("#rsvp-section [role='status'][data-scroll-fade]");
    await expect(tickerBlock).toBeAttached();
    await expect(tickerBlock).toContainText("confirmed");

    // 4. "confirmation button" / RSVP link block
    const rsvpAction = page.locator("#rsvp-section [data-scroll-fade]").filter({
      hasText: /RSVP through your personal invitation link|Confirm Reservation/i,
    });
    await expect(rsvpAction).toBeAttached();

    // 5. "Merupakan suatu kehormatan..."
    const closingText = page.locator("#rsvp-section p[data-scroll-fade]").filter({
      hasText: /Merupakan suatu kehormatan bagi kami/i,
    });
    await expect(closingText).toBeAttached();

    // Test scroll-fade on one of the elements (e.g. venueHeader)
    // Scroll directly to it
    await venueHeader.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);

    const inViewOpacity = await venueHeader.evaluate((el) => parseFloat(el.style.opacity || "1"));
    expect(inViewOpacity).toBeGreaterThanOrEqual(0.85);

    // Scroll away (downward by 900px)
    await page.evaluate(() => window.scrollBy(0, 900));
    await page.waitForTimeout(150);

    const outViewOpacity = await venueHeader.evaluate((el) => parseFloat(el.style.opacity || "1"));
    expect(outViewOpacity).toBeLessThan(0.85);

    // Scroll back
    await page.evaluate(() => window.scrollBy(0, -900));
    await page.waitForTimeout(150);

    const returnOpacity = await venueHeader.evaluate((el) => parseFloat(el.style.opacity || "0"));
    expect(returnOpacity).toBeGreaterThanOrEqual(0.85);
  });

  test("honors prefers-reduced-motion across all scroll-fade elements", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await dismissWelcomeGate(page);

    const fadeElements = page.locator("[data-scroll-fade]");
    const count = await fadeElements.count();
    expect(count).toBeGreaterThanOrEqual(5);

    for (let i = 0; i < count; i++) {
      const el = fadeElements.nth(i);
      const state = await el.evaluate((node) => ({
        opacity: node.style.opacity,
        transform: node.style.transform,
      }));
      expect(state.opacity).toBe("1");
      expect(state.transform).toBe("none");
    }
  });

  test("all data-scroll-fade participants are visible with JavaScript disabled", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.goto("/");
      const fadeElements = page.locator("[data-scroll-fade]");
      const count = await fadeElements.count();
      expect(count).toBeGreaterThanOrEqual(5);

      for (let i = 0; i < count; i++) {
        const el = fadeElements.nth(i);
        const style = await el.evaluate((node) => {
          const s = window.getComputedStyle(node);
          return {
            opacity: parseFloat(s.opacity),
            visibility: s.visibility,
            display: s.display,
          };
        });
        expect(style.display).not.toBe("none");
        expect(style.visibility).not.toBe("hidden");
        expect(style.opacity).toBe(1);
      }
    } finally {
      await context.close();
    }
  });
});
