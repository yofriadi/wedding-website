import { test, expect } from "@playwright/test";
import { dismissWelcomeGate, skipUnlessEmptyWall } from "./helpers";

// story-rail-mocks "Mocks are honest interactive previews" +
// story-rail-attribution D1: the placeholder population is THREE UNNAMED
// example posts, one story each. They must still open, play and hand off like
// real tiles — but nothing about them may invent a guest (no username, no
// avatar, no timestamp), and the label position keeps the transparent filler
// so mock tiles hold the same rail geometry as the named tiles that replace
// them.
//
// Empty-wall precondition: these tests assert SSR mock PRESENCE, which reads
// the live database server-side and so cannot be routed around. On the CI
// scratch DB the wall is empty and everything runs; on a dogfooded shared dev
// server skipUnlessEmptyWall() skips instead of failing (mock-gate-ssr covers
// both gate branches against its own seeded server).

const MOCK_SRCS = ["/story_example_1.webp", "/story_example_2.webp", "/story_example_3.webp"];

const RAIL = "[data-story-rail]";

test("empty wall: three unnamed mocks are the rail's only story tiles", async ({ page }) => {
  await skipUnlessEmptyWall(page);
  await page.goto("/");
  await dismissWelcomeGate(page);
  await page.locator(RAIL).scrollIntoViewIfNeeded();

  const mocks = page.locator(`${RAIL} [data-mock]`);
  await expect(mocks).toHaveCount(3);
  // story-teaser is retired: no demo tiles and no static teaser <img>s — the
  // mocks are the ONLY story-viewers in the rail, and no wrapper holds a bare
  // <picture> (the old teaser markup shape).
  await expect(page.locator(`${RAIL} story-viewer`)).toHaveCount(3);
  await expect(page.locator(`${RAIL} > div > picture`)).toHaveCount(0);

  const first = mocks.first();
  // Unnamed: the label span is the transparent filler, aria-hidden, so the
  // tile is the same height as a named one without showing a name.
  const label = first.locator("span.truncate");
  await expect(label).toHaveText(".");
  await expect(label).toHaveAttribute("aria-hidden", "true");
  await expect(label).toHaveClass(/text-transparent/);

  // Neutral accessible naming everywhere (element hook + open button).
  await expect(first).toHaveAttribute("data-label", "View guest story");
  await expect(first.locator("[data-open]")).toHaveAttribute("aria-label", "View guest story");
  expect(await first.locator("[data-username]").count()).toBe(0);

  // Each mock's single story is its own example asset, in rail order. Asserted
  // on `src`: the section's progressive loader swaps data-src → src once the
  // rail scrolls into view, and the retry waits out that swap.
  for (let i = 0; i < MOCK_SRCS.length; i++) {
    await expect(mocks.nth(i).locator("[data-open] img")).toHaveAttribute("src", MOCK_SRCS[i]);
  }
});

test("mock tile opens the modal: one progress segment, attribution-free header", async ({
  page,
}) => {
  await skipUnlessEmptyWall(page);
  await page.goto("/");
  await dismissWelcomeGate(page);
  await page.locator(RAIL).scrollIntoViewIfNeeded();

  const mock = page.locator(`${RAIL} [data-mock]`).first();
  await expect(mock).toHaveCount(1);
  await mock.locator("[data-open]").click();

  const modal = page.locator('body > [data-modal][aria-hidden="false"]');
  await expect(modal).toHaveCount(1);

  // No author UI at all: no avatar circle, no name span, no timestamp — the
  // neutral placeholder holds the header's left slot instead.
  await expect(modal.locator("[data-avatar]")).toHaveCount(0);
  await expect(modal.locator("[data-username]")).toHaveCount(0);
  await expect(modal.locator("[data-timestamp]")).toHaveCount(0);
  await expect(modal.locator("text=Guest story")).toBeVisible();

  // Exactly one story → exactly one progress segment (a named 3-photo guest
  // tile would render three).
  await expect(modal.locator("[data-progress-item]")).toHaveCount(1);

  // The slide is the mock's own asset, and the AVIF sibling is derived by
  // extension swap (static /public assets only).
  await expect(modal.locator("[data-stage] img").first()).toHaveAttribute("src", MOCK_SRCS[0]);
  await expect(modal.locator("[data-stage] source[type='image/avif']")).toHaveAttribute(
    "srcset",
    "/story_example_1.avif",
  );
});
