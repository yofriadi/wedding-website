import { test, expect } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

const INVITE_ID = "Playwright01";
const TEMPLATES = [
  "Happy ever after! ✨",
  "To a lifetime of joy!",
  "May love always find you",
  "Grow old together 💛",
  "Selamat menempuh hidup baru!",
  "Bahagia selalu, kalian!",
];
const DEFAULT = "Write a wish…";

async function setup(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
) {
  await context.addCookies([
    { name: "ww_invite_id", value: INVITE_ID, domain: "localhost", path: "/" },
  ]);
  await page.route("**/api/submissions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ mine: null, inviteValid: true, wall: { wishes: [], stories: [] } }),
    });
  });
  await page.goto("/");
  await dismissWelcomeGate(page);
  // Scroll the rail into view so the add-story tile is reachable (mobile
  // viewports leave it under the timeline section otherwise).
  await page.locator("[data-story-rail]").scrollIntoViewIfNeeded();
}

// The timeline section's sticky stage keeps intercepting pointer events on
// small viewports right after scrollIntoViewIfNeeded; opening the flow via
// the element's own click (dispatchEvent) sidesteps hit-testing without
// changing production behavior.
async function openFlowPastStickyTimeline(page: import("@playwright/test").Page) {
  await page.locator("[data-add-story-open]").evaluate((el) => (el as HTMLElement).click());
}

test.setTimeout(120_000);

test("placeholder starts at the default, cycles once, then settles", async ({ page, context }) => {
  await setup(page, context);
  await page.locator("[data-add-story-open]").click();
  const input = page.locator("[data-wish-input]");
  await expect(page.locator("#add-story-flow")).toBeVisible();
  // Spec: a pass starts FROM THE DEFAULT — it stays until the first tick.
  expect(await input.getAttribute("placeholder")).toBe(DEFAULT);

  // Then one template per ~4s tick: six ticks consume the six templates,
  // the seventh settles back on the default, and later ticks stay settled
  // (one pass, not a loop).
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(4220);
    expect(await input.getAttribute("placeholder")).toBe(TEMPLATES[i]);
  }
  await page.waitForTimeout(4220);
  expect(await input.getAttribute("placeholder")).toBe(DEFAULT);
  await page.waitForTimeout(4220);
  expect(await input.getAttribute("placeholder")).toBe(DEFAULT);
});

test("first keystroke disables rotation for the session; reopen stays static", async ({
  page,
  context,
}) => {
  await setup(page, context);
  await page.locator("[data-add-story-open]").click();
  const input = page.locator("[data-wish-input]");
  await expect(page.locator("#add-story-flow")).toBeVisible();

  await input.pressSequentially("H");
  await page.waitForTimeout(200);
  await input.fill(""); // clearing must NOT resume rotation

  // Close (restores default) and reopen: hasTyped stays latched → static.
  await page.keyboard.press("Escape");
  await expect(page.locator("#add-story-flow")).toHaveAttribute("aria-hidden", "true");
  expect(await input.getAttribute("placeholder")).toBe(DEFAULT);
  await page.locator("[data-add-story-open]").click();
  await page.waitForTimeout(9500); // >2 ticks
  expect(await input.getAttribute("placeholder")).toBe(DEFAULT);
});

test("reduced motion: static default, no rotation", async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page, context);
  await openFlowPastStickyTimeline(page);
  const input = page.locator("[data-wish-input]");
  await expect(page.locator("#add-story-flow")).toBeVisible();
  expect(await input.getAttribute("placeholder")).toBe(DEFAULT);
  await page.waitForTimeout(9500);
  expect(await input.getAttribute("placeholder")).toBe(DEFAULT);
});

test("reopen with retained text: non-empty input never rotates", async ({ page, context }) => {
  await setup(page, context);
  await page.locator("[data-add-story-open]").click();
  const input = page.locator("[data-wish-input]");
  await expect(page.locator("#add-story-flow")).toBeVisible();
  await input.pressSequentially("Keep");
  await page.keyboard.press("Escape");
  await page.locator("[data-add-story-open]").click();
  await expect(input).toHaveValue("Keep"); // closeFlow keeps typed text
  await page.waitForTimeout(9500);
  expect(await input.getAttribute("placeholder")).toBe(DEFAULT);
});
