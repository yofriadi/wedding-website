import { test, expect } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

const EVENT_TIMES = "#event-times";

async function scrollToEvents(page: import("@playwright/test").Page) {
  await dismissWelcomeGate(page);
  await page.locator(EVENT_TIMES).scrollIntoViewIfNeeded();
}

test.describe("EventTimes cards — stacked, full-bleed blurred image, centered white text with shadow", () => {
  test("renders before number-ticker with full-bleed blurred image and centered bold white text with shadow", async ({
    page,
  }) => {
    await page.goto("/");
    await scrollToEvents(page);

    const container = page.locator(EVENT_TIMES);
    await expect(container).toBeAttached();

    // Verify EventTimes comes before number-ticker in the DOM
    const isBeforeNumberTicker = await page.evaluate(() => {
      const eventTimes = document.getElementById("event-times");
      const numberTicker = document.querySelector("number-ticker");
      if (!eventTimes || !numberTicker) return false;
      return (
        (eventTimes.compareDocumentPosition(numberTicker) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      );
    });
    expect(isBeforeNumberTicker).toBe(true);

    // Verify "Rangkaian Acara" header is present with font-serif (matching Venue)
    const heading = page.getByRole("heading", { name: "Rangkaian Acara" });
    await expect(heading).toBeAttached();
    await expect(heading).toHaveClass(/font-serif/);

    // Verify both event cards are present in stacked order (above and below)
    const cards = container.locator("[data-event-card]");
    await expect(cards).toHaveCount(2);

    // Card 1: Akad Nikah
    const akadCard = cards.nth(0);
    const akadTitle = akadCard.locator("h3");
    await expect(akadTitle).toContainText("Akad Nikah");
    await expect(akadTitle).toHaveClass(/font-serif/);
    await expect(akadTitle).toHaveClass(/font-bold/);
    await expect(akadTitle).toHaveClass(/text-white/);
    await expect(akadCard).toContainText("08:00 WIB");

    // Card 2: Resepsi
    const resepsiCard = cards.nth(1);
    const resepsiTitle = resepsiCard.locator("h3");
    await expect(resepsiTitle).toContainText("Resepsi");
    await expect(resepsiTitle).toHaveClass(/font-serif/);
    await expect(resepsiTitle).toHaveClass(/font-bold/);
    await expect(resepsiTitle).toHaveClass(/text-white/);
    await expect(resepsiCard).toContainText("10:00 WIB");

    // Verify stacked layout (Card 1 is above Card 2)
    const isStacked = await page.evaluate(() => {
      const cards = document.querySelectorAll("[data-event-card]");
      if (cards.length < 2) return false;
      const r0 = cards[0].getBoundingClientRect();
      const r1 = cards[1].getBoundingClientRect();
      return r0.bottom < r1.top;
    });
    expect(isStacked).toBe(true);

    // Verify full-bleed image covering the card and centered text with shadow
    for (let i = 0; i < 2; i++) {
      const card = cards.nth(i);
      const img = card.locator("picture img");
      await expect(img).toBeAttached();
      await expect(img).toHaveClass(/times-img/);
      await expect(img).toHaveClass(/object-cover/);
      await expect(img).toHaveClass(/absolute/);
      await expect(img).toHaveClass(/inset-0/);

      // Centered text container
      const centerBox = card.locator(".times-center-text");
      await expect(centerBox).toBeAttached();
      await expect(centerBox).toHaveClass(/items-center/);
      await expect(centerBox).toHaveClass(/justify-center/);

      // Text shadow class applied
      const h3 = centerBox.locator("h3");
      await expect(h3).toHaveClass(/times-text-shadow/);
      const timeSpan = centerBox.locator("span");
      await expect(timeSpan).toHaveClass(/times-text-shadow/);
    }
  });

  test("animates fade-in and fade-out on scroll back and forth", async ({ page }) => {
    await page.goto("/");
    await dismissWelcomeGate(page);

    const cards = page.locator(`${EVENT_TIMES} [data-event-card]`);
    const card0 = cards.nth(0);

    // Scroll directly to Card 0 centered in viewport
    await card0.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);

    // In viewport: opacity should be high
    const inViewOpacity = await card0.evaluate((el) => parseFloat(el.style.opacity || "1"));
    expect(inViewOpacity).toBeGreaterThanOrEqual(0.85);

    // Scroll away (downwards by 900px so card 0 exits top)
    await page.evaluate(() => window.scrollBy(0, 900));
    await page.waitForTimeout(150);

    const exitedTopOpacity = await card0.evaluate((el) => parseFloat(el.style.opacity || "1"));
    expect(exitedTopOpacity).toBeLessThan(0.85);

    // Scroll BACK UP (backward) so Card 0 re-enters the viewport
    await page.evaluate(() => window.scrollBy(0, -900));
    await page.waitForTimeout(150);

    const returnedOpacity = await card0.evaluate((el) => parseFloat(el.style.opacity || "0"));
    expect(returnedOpacity).toBeGreaterThanOrEqual(0.85);
  });

  test("honors prefers-reduced-motion with instant visibility and no transforms", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await dismissWelcomeGate(page);

    const cards = page.locator(`${EVENT_TIMES} [data-event-card]`);
    const count = await cards.count();
    expect(count).toBe(2);

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const state = await card.evaluate((el) => ({
        opacity: el.style.opacity,
        transform: el.style.transform,
      }));
      expect(state.opacity).toBe("1");
      expect(state.transform).toBe("none");
    }
  });
});
