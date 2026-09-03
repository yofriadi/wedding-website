import { test, expect, type Page } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

// Wish marquee display states (guest-submissions 2.4/2.5).
//
// No-seed convention (see welcome-gate.spec.ts): client-side states are tested
// by routing /api/submissions responses, so these tests never depend on
// server-side DB state. The API contract itself is verified via curl.

const INVITE_ID = "Playwright01";

const MARQUEE = "[data-wish-marquee]";

interface SubmissionsPayload {
  mine: { wishText: string | null; photos: unknown[] } | null;
  wall: { wishes: { text: string }[]; stories: unknown[] };
}

async function routeSubmissions(page: Page, payload: SubmissionsPayload) {
  await page.route("**/api/submissions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify(payload),
    });
  });
}

async function gotoMarquee(page: Page) {
  await page.goto("/");
  await dismissWelcomeGate(page);
  await page.locator(MARQUEE).scrollIntoViewIfNeeded();
}

test.describe("wish marquee", () => {
  test("public + empty wall: one fetch, demo + CTA state (zero-request guarantee retired)", async ({
    page,
  }) => {
    const submissionsRequests: string[] = [];
    page.on("request", (req) => {
      if (new URL(req.url()).pathname === "/api/submissions") {
        submissionsRequests.push(req.url());
      }
    });
    // No cookie: the public wall answers mine: null + empty wall — the same
    // empty state invitees see (public-wall D2).
    await routeSubmissions(page, { mine: null, wall: { wishes: [], stories: [] } });

    await gotoMarquee(page);

    // Exactly one request per page load (shared module instance).
    await expect.poll(() => submissionsRequests.length, { timeout: 5_000 }).toBe(1);

    await expect(page.locator(MARQUEE)).toHaveAttribute("data-state", "empty");
    await expect(page.locator(MARQUEE)).toContainText("Be the first to leave a wish ✨");
    // Demo wishes survive in the empty state.
    await expect(page.locator(MARQUEE)).toContainText(
      "Wishing you a lifetime of love and happiness",
    );
  });

  test("public + real wishes: real-only, demo evicted", async ({ page }) => {
    // No cookie; the wall carries a real wish — the marquee swaps to the
    // real state exactly like an invitee's would.
    await routeSubmissions(page, {
      mine: null,
      wall: { wishes: [{ text: "So happy for you both!" }], stories: [] },
    });

    await gotoMarquee(page);

    await expect(page.locator(MARQUEE)).toHaveAttribute("data-state", "real");
    await expect(page.locator(MARQUEE)).not.toContainText(
      "Wishing you a lifetime of love and happiness",
    );
    await expect(page.locator(MARQUEE)).toContainText("So happy for you both!");
  });

  test("invitee + 0 real wishes: demo + leading CTA card", async ({ page, context }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await routeSubmissions(page, {
      mine: null,
      wall: { wishes: [], stories: [] },
    });

    await gotoMarquee(page);

    await expect(page.locator(MARQUEE)).toHaveAttribute("data-state", "empty");
    // CTA card is the leading item of each row (the row unit repeats to
    // fill width, so the CTA recurs with each repetition — the first item
    // of every row's first copy is the CTA).
    const firstItems = await page.evaluate(() => {
      const root = document.querySelector("[data-wish-marquee]");
      if (!root) throw new Error("marquee root missing");
      return Array.from(root.querySelectorAll(".marquee-track")).map((track) => {
        const copy = track.querySelector(".marquee-content");
        return copy?.querySelector(".marquee-item")?.textContent ?? null;
      });
    });
    expect(firstItems).toHaveLength(4);
    for (const text of firstItems) {
      expect(text).toBe("Be the first to leave a wish ✨");
    }
    // ...and demo wishes survive (not evicted in the empty state).
    await expect(page.locator(MARQUEE)).toContainText(
      "Wishing you a lifetime of love and happiness",
    );
  });

  test("invitee + ≥1 real wishes: real-only, demo evicted, loop filled, sane speed", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    // One real wish only — the single-wish loop-fill case.
    await routeSubmissions(page, {
      mine: null,
      wall: { wishes: [{ text: "So happy for you both!" }], stories: [] },
    });

    await gotoMarquee(page);

    await expect(page.locator(MARQUEE)).toHaveAttribute("data-state", "real");

    // Demo evicted.
    await expect(page.locator(MARQUEE)).not.toContainText(
      "Wishing you a lifetime of love and happiness",
    );
    // Real wish rendered.
    await expect(page.locator(MARQUEE)).toContainText("So happy for you both!");

    // Two-copy structure preserved per track and content fills the track
    // width (loop integrity: unit repeated until wider than the track).
    const rowInfo = await page.evaluate(() => {
      const root = document.querySelector("[data-wish-marquee]")!;
      return Array.from(root.querySelectorAll<HTMLElement>(".marquee-track")).map((track) => {
        const copies = track.querySelectorAll(".marquee-content");
        const first = copies[0] as HTMLElement;
        const items = first.querySelectorAll(".marquee-item");
        return {
          copies: copies.length,
          trackWidth: track.offsetWidth,
          contentWidth: first.offsetWidth,
          itemTexts: Array.from(items).map((el) => el.textContent),
          animationDuration: first.style.animationDuration,
        };
      });
    });

    expect(rowInfo).toHaveLength(4);
    for (const row of rowInfo) {
      expect(row.copies).toBe(2);
      // Fill-to-width: one copy is wider than the track → no blank gap.
      expect(row.contentWidth).toBeGreaterThan(row.trackWidth);
      // Single wish repeated to fill.
      expect(row.itemTexts.length).toBeGreaterThan(1);
      expect(new Set(row.itemTexts).size).toBe(1);
      expect(row.itemTexts[0]).toBe("So happy for you both!");
      // Speed derived from width: duration = width / speed with speed ~35–48
      // px/s. A frozen ~200s fixed duration would mean width/speed broke.
      const durationSec = parseFloat(row.animationDuration);
      expect(Number.isFinite(durationSec)).toBe(true);
      expect(durationSec).toBeGreaterThan(0);
      expect(durationSec).toBeLessThan(60);
    }
  });

  test("caller's own wish renders once (mine + wall not duplicated server-side)", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    // mine AND a wall wish: both render (own wish is part of the real set).
    await routeSubmissions(page, {
      mine: { wishText: "My own wish", photos: [] },
      wall: { wishes: [{ text: "A wall wish" }], stories: [] },
    });

    await gotoMarquee(page);

    await expect(page.locator(MARQUEE)).toHaveAttribute("data-state", "real");
    await expect(page.locator(MARQUEE)).toContainText("My own wish");
    await expect(page.locator(MARQUEE)).toContainText("A wall wish");
  });

  test("XSS attempt renders as literal text, never markup", async ({ page, context }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);
    await routeSubmissions(page, {
      mine: null,
      wall: {
        wishes: [
          {
            text: '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>',
          },
        ],
        stories: [],
      },
    });

    await gotoMarquee(page);

    await expect(page.locator(MARQUEE)).toHaveAttribute("data-state", "real");
    // The payload renders as literal text content.
    await expect(page.locator(MARQUEE)).toContainText('<img src=x onerror="window.__pwned=1">');
    await expect(page.locator(MARQUEE + " img.marquee-item")).toHaveCount(0);
    await expect(page.locator(MARQUEE + " script.marquee-item")).toHaveCount(0);
    expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  // Adversarial-review fix regression: a slow INITIAL GET resolving after
  // a post-submit re-sync used to repaint the marquee with the pre-post
  // (empty/demo) state — the marquee now keeps only the latest generation.
  test("slow initial GET never repaints over the post-submit state", async ({ page, context }) => {
    await context.addCookies([
      { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
    ]);

    // Initial GET: held until AFTER the post-submit re-sync has applied.
    let posted = false;
    let releaseInitial: (() => void) | undefined;
    await page.route("**/api/submissions", async (route) => {
      if (route.request().method() === "POST") {
        posted = true;
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ id: "BBBBBBBBBBBB", wishText: "Best wishes!", photos: [] }),
        });
      } else if (posted) {
        // Fresh re-sync: the caller's wish is on the wall.
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Cache-Control": "no-store" },
          body: JSON.stringify({
            mine: { id: "BBBBBBBBBBBB", wishText: "Best wishes!", photos: [] },
            inviteValid: true,
            wall: { wishes: [{ text: "Best wishes!" }], stories: [] },
          }),
        });
      } else {
        // Initial GET (pre-post): empty wall — hold it.
        await new Promise<void>((resolve) => {
          releaseInitial = resolve;
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Cache-Control": "no-store" },
          body: JSON.stringify({
            mine: null,
            wall: { wishes: [], stories: [] },
          }),
        });
      }
    });

    await gotoMarquee(page);
    // Marquee still SSR/demo while the initial GET hangs.
    await expect(page.locator(MARQUEE)).not.toHaveAttribute("data-state", "real");

    // The add-story tile is gated on the SAME initial GET (it stays hidden
    // until `mine` is known), which normally makes this interleaving
    // unreachable through the UI. Reveal it synthetically to simulate a tile
    // that is usable while the initial GET is still in flight — then drive
    // the REAL post path: invalidate → submissions:posted → fresh GET → the
    // marquee swaps to the real state.
    await page.evaluate(() => {
      document.querySelector("[data-add-story-root]")?.classList.remove("hidden");
    });
    await page.locator("[data-add-story-open]").click();
    await page.locator("[data-wish-input]").fill("Best wishes!");
    await page.locator("[data-flow-submit]").click();
    await expect(page.locator("#add-story-flow")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(MARQUEE)).toHaveAttribute("data-state", "real");
    await expect(page.locator(MARQUEE)).toContainText("Best wishes!");

    // NOW let the stale initial GET resolve (empty wall): it must NOT
    // repaint the marquee back to the demo/empty state.
    releaseInitial?.();
    await page.waitForTimeout(1000);
    await expect(page.locator(MARQUEE)).toHaveAttribute("data-state", "real");
    await expect(page.locator(MARQUEE)).toContainText("Best wishes!");
  });
});
