import { test, expect, type Page } from "@playwright/test";
import { dismissWelcomeGate, skipUnlessEmptyWall } from "./helpers";

// StoryViewer mechanics (story-rail-attribution 6.3): the demo tiles these
// tests used to drive are gone, so each behavior is re-anchored on a real
// population —
//   multi-slide navigation + progress → a seeded guest submission with three
//     photos (routed payload; the rail's only tile once mocks are evicted);
//   viewer-to-viewer hand-off → the three single-story mock tiles, whose only
//     slide is exactly the hand-off boundary (advance past it → next viewer,
//     reverse at it → previous viewer).

const RAIL = "[data-story-rail]";

// Minimal valid WebP (1×1, lossless VP8L) — routed for the seeded originals so
// img.onload fires: slide progress and the hand-off readiness signal both hang
// off that event.
const TINY_WEBP = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");

const THREE_PHOTO_WALL = {
  mine: null,
  inviteValid: true,
  wall: {
    wishes: [],
    stories: [
      {
        photos: [1, 2, 3].map((n) => ({
          photoUrl: `/x-orig-${n}.webp`,
          thumbnailUrl: `/x-thumb-${n}.webp`,
        })),
        firstName: "Lita",
        createdAt: Date.now() - 2 * 60 * 60 * 1000, // → "2h ago"
      },
    ],
  },
};

/** Land on a rail whose only story tile is one guest submission of 3 photos. */
async function gotoSeededRail(page: Page) {
  await page.route("**/api/submissions", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(THREE_PHOTO_WALL),
    }),
  );
  await page.route("**/x-orig-*", (route) =>
    route.fulfill({ status: 200, contentType: "image/webp", body: TINY_WEBP }),
  );
  await page.goto("/");
  await dismissWelcomeGate(page);
  await page.locator(RAIL).scrollIntoViewIfNeeded();
  await expect(page.locator(`${RAIL} [data-guest]`)).toHaveCount(1);
  // The real story evicted the SSR mocks.
  await expect(page.locator(`${RAIL} [data-mock]`)).toHaveCount(0);
}

/** Land on an empty-wall rail: three unnamed single-story mocks. Skips when the
 * shared dev server's wall is non-empty — SSR mock presence reads the live DB
 * and cannot be routed around; mock-gate-ssr covers the seeded branches. */
async function gotoMockRail(page: Page) {
  await skipUnlessEmptyWall(page);
  await page.goto("/");
  await dismissWelcomeGate(page);
  await page.locator(RAIL).scrollIntoViewIfNeeded();
  await expect(page.locator(`${RAIL} [data-mock]`)).toHaveCount(3);
}

async function tapStageSide(page: Page, stage: ReturnType<Page["locator"]>, fraction: number) {
  const box = await stage.boundingBox();
  if (!box) throw new Error("stage not visible");
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}

test("guest story opens, shows one progress segment per photo, and navigates", async ({ page }) => {
  await gotoSeededRail(page);

  const trigger = page.locator(`${RAIL} [data-guest] [data-open]`).first();
  await expect(trigger).toBeVisible();
  await trigger.click();

  const modal = page.locator('[data-modal][aria-hidden="false"]');
  await expect(modal).toBeVisible();

  const stage = modal.locator("[data-stage]");
  await expect(stage.locator("img").first()).toBeVisible();
  await expect(stage.locator("img").first()).toHaveAttribute("src", "/x-orig-1.webp");

  // Three photos → three segments (a mock tile renders exactly one).
  await expect(modal.locator("[data-progress-item]")).toHaveCount(3);

  // A right-half tap advances WITHIN the viewer (slides remain, no hand-off).
  await tapStageSide(page, stage, 0.75);
  await expect(stage.locator("img").last()).toHaveAttribute("src", "/x-orig-2.webp");
  await expect(modal.locator("[data-progress-item]")).toHaveCount(3);

  // Close: no modal stays open anywhere.
  await modal.locator("[data-close]").click();
  await expect(page.locator('[data-modal][aria-hidden="false"]')).toHaveCount(0);
});

test("forward hand-off keeps a modal visible until the next viewer is ready", async ({ page }) => {
  await gotoMockRail(page);

  await page.locator(`${RAIL} [data-mock] [data-open]`).first().click();
  const visibleModal = page.locator('[data-modal][aria-hidden="false"]');
  await expect(visibleModal).toHaveCount(1);
  await expect(visibleModal.locator("[data-stage] img").first()).toHaveAttribute(
    "src",
    "/story_example_1.webp",
  );

  const stage = visibleModal.locator("[data-stage]");

  // Sample modal visibility every frame across the hand-off: the outgoing
  // viewer must stay open until the incoming viewer's first slide is ready, so
  // the count of open modals never drops to zero (no black flash).
  const minVisiblePromise = page.evaluate((durationMs) => {
    return new Promise<number>((resolve) => {
      let min = Infinity;
      const start = performance.now();
      const tick = () => {
        const visible = document.querySelectorAll('[data-modal][aria-hidden="false"]').length;
        min = Math.min(min, visible);
        if (performance.now() - start < durationMs) {
          requestAnimationFrame(tick);
        } else {
          resolve(min === Infinity ? 0 : min);
        }
      };
      requestAnimationFrame(tick);
    });
  }, 1500);

  // A mock has exactly ONE story, so the first right-side tap is already the
  // end-of-viewer boundary: story-viewer-end → orchestrator → next mock.
  await tapStageSide(page, stage, 0.75);

  const minVisible = await minVisiblePromise;
  expect(minVisible).toBeGreaterThanOrEqual(1);

  // Hand-off complete: exactly one modal remains, showing the SECOND mock's
  // only slide.
  await expect(visibleModal).toHaveCount(1);
  await expect(visibleModal.locator("[data-stage] img").first()).toHaveAttribute(
    "src",
    "/story_example_2.webp",
  );
});

test("reverse hand-off opens the previous viewer at its last story", async ({ page }) => {
  await gotoMockRail(page);

  // Open the SECOND mock; a left-half tap at its only slide fires
  // story-viewer-prev, and the orchestrator opens the previous viewer with
  // startIndex "last" — which for a single-story mock is that same story.
  await page.locator(`${RAIL} [data-mock] [data-open]`).nth(1).click();
  const visibleModal = page.locator('[data-modal][aria-hidden="false"]');
  await expect(visibleModal).toHaveCount(1);

  const stage = visibleModal.locator("[data-stage]");
  await page.waitForTimeout(600);
  await tapStageSide(page, stage, 0.25);

  await expect(visibleModal.locator("[data-stage] img").first()).toHaveAttribute(
    "src",
    "/story_example_1.webp",
    { timeout: 5000 },
  );
  await expect(visibleModal).toHaveCount(1);
});

test("progress fill advances via transform scaleX, not width", async ({ page }) => {
  await gotoSeededRail(page);

  await page.locator(`${RAIL} [data-guest] [data-open]`).first().click();
  const visibleModal = page.locator('[data-modal][aria-hidden="false"]');
  await expect(visibleModal).toHaveCount(1);

  const bar = visibleModal.locator("[data-progress-bar]").first();

  // Full-width base; fill expressed purely as a left-origin transform.
  await expect(bar).toHaveCSS("transform-origin", /^0px/);
  expect(await bar.evaluate((el) => (el as HTMLElement).style.width)).toBe("");

  await page.waitForTimeout(800); // let the story play a bit

  const readScale = (transform: string) => parseFloat(transform.replace(/^scaleX\(|\)$/g, ""));
  const transform = await bar.evaluate((el) => (el as HTMLElement).style.transform);
  expect(transform).toMatch(/^scaleX\(/);
  const scale = readScale(transform);
  expect(scale).toBeGreaterThan(0.05);
  expect(scale).toBeLessThan(1);

  // It keeps advancing, still without width writes.
  await page.waitForTimeout(400);
  const transform2 = await bar.evaluate((el) => (el as HTMLElement).style.transform);
  expect(readScale(transform2)).toBeGreaterThan(scale);
  expect(await bar.evaluate((el) => (el as HTMLElement).style.width)).toBe("");
});
