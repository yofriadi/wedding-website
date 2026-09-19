import { test, expect } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

// No-seed convention (see welcome-gate.spec.ts): these tests assert anonymous
// client-side behavior only. The invite-cookie contract (submit,
// change-of-mind, count aggregation) is verified via curl against a controlled
// build — no test-DB seeding infrastructure.

const SECTION = "#rsvp-section";

async function scrollToRsvp(page: import("@playwright/test").Page) {
  await dismissWelcomeGate(page);
  await page.locator(SECTION).scrollIntoViewIfNeeded();
}

test.describe("rsvp section", () => {
  test("anonymous markup: venue copy, SSR count, no controls, no identity requests", async ({
    page,
  }) => {
    const rsvpRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      // /api/rsvp (exact) is the identity-gated status endpoint; the public
      // /api/rsvp/count poll is allowed.
      if (url.endsWith("/api/rsvp")) rsvpRequests.push(url);
    });

    await page.goto("/");
    await scrollToRsvp(page);

    // Venue copy in venue map, placeholder gone.
    await expect(page.locator("#venue-map")).toContainText("Graha 58 Gedung Serbaguna UMS");
    await expect(page.locator("#venue-map")).toContainText("Surakarta, Central Java");
    await expect(page.getByText("The Grand Estate")).toHaveCount(0);

    // SSR count is truthful plain text in the markup (no-JS safe).
    const ticker = page.locator(`${SECTION} number-ticker`);
    await expect(ticker).toBeAttached();

    // Anonymous guidance line instead of any RSVP control. (The section also
    // hosts EventTimes' panel buttons, so the assertion is the RSVP control
    // itself, not a blanket button count.)
    await expect(page.locator(SECTION)).toContainText("RSVP through your personal invitation link");
    await expect(page.locator("[data-rsvp-form]")).toHaveCount(0);
    await expect(page.locator(`${SECTION} [data-rsvp-confirm]`)).toHaveCount(0);
    await expect(page.locator(`${SECTION} [data-slide-to-confirm]`)).toHaveCount(0);

    // No identity-lookup request of any kind.
    expect(rsvpRequests).toHaveLength(0);
  });

  test("counter announces an accessible labeled value", async ({ page }) => {
    await page.goto("/");
    await scrollToRsvp(page);
    const status = page.locator(`${SECTION} [role="status"]`);
    await expect(status).toHaveAttribute("aria-label", /reservations confirmed/);
  });

  test("poll rolls the ticker when the count changes", async ({ page }) => {
    let count = 5;
    await page.route("**/api/rsvp/count", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({ count }),
      });
    });

    await page.goto("/");
    await scrollToRsvp(page);

    const ticker = page.locator(`${SECTION} number-ticker`);
    await expect(ticker).toBeAttached();

    // Change the count behind the route, then trigger a poll via a
    // visibility cycle (the poll interval itself is 30s — too slow for a test).
    count = 12;
    // Force the visibilitychange handler's hidden branch (visibilityState is
    // read-only), then restore and dispatch — the handler polls on visible.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await expect(ticker).toHaveAttribute("value", "12", { timeout: 10_000 });
    await expect(page.locator(`${SECTION} [role="status"]`)).toHaveAttribute(
      "aria-label",
      "12 reservations confirmed",
    );
  });

  test("reduced motion: value swaps instantly with no rolling columns", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await scrollToRsvp(page);

    const ticker = page.locator(`${SECTION} number-ticker`);
    // Plain text forever: no digit-column enhancement happened.
    await expect(ticker.locator("span[aria-hidden='true']")).toHaveCount(0);
    await expect(ticker).toHaveText(/\d+/);
  });

  // rsvp-star-confirm 3.1: the section follows the device color scheme (the
  // --rsvp-* tokens live in index.astro's style block; the component reads them
  // by inheritance). Dark is the baseline, light inverts.
  test("theme: light inverts the section, dark is the baseline", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await scrollToRsvp(page);

    await expect(page.locator(SECTION)).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.locator(`${SECTION} number-ticker`)).toHaveCSS("color", "rgb(10, 10, 10)");
    await expect(page.locator(`${SECTION} p`).first()).toHaveCSS("color", "rgb(82, 82, 82)");

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator(SECTION)).toHaveCSS("background-color", "rgb(10, 10, 10)");
    await expect(page.locator(`${SECTION} number-ticker`)).toHaveCSS("color", "rgb(250, 250, 250)");
    await expect(page.locator(`${SECTION} p`).first()).toHaveCSS("color", "rgb(163, 163, 163)");
  });

  test("theme follows the device, not a control, and stores nothing", async ({ page }) => {
    await page.goto("/");
    await scrollToRsvp(page);

    // No toggle of any kind names a theme, and nothing theme-shaped is stored.
    await expect(page.getByRole("button", { name: /theme|dark|light/i })).toHaveCount(0);
    const stored = await page.evaluate(() => ({
      local: Object.keys(localStorage).filter((k) => /theme|dark|light|scheme/i.test(k)),
      cookie: document.cookie
        .split(";")
        .map((c) => c.trim().split("=")[0])
        .filter(Boolean),
    }));
    expect(stored.local).toEqual([]);
    expect(stored.cookie.filter((c) => /theme|dark|light|scheme/i.test(c))).toEqual([]);

    // The presentation comes from the media query: flipping it flips the page.
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator(SECTION)).toHaveCSS("background-color", "rgb(255, 255, 255)");
  });

  test("invitee controls are absent for anonymous visitors", async ({ page }) => {
    await page.goto("/");
    await scrollToRsvp(page);

    await expect(page.locator("[data-rsvp-form]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Attending$|^Decline$/i })).toHaveCount(0);
  });
});
