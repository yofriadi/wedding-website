import { test, type Page } from "@playwright/test";

/**
 * Wait for the loading overlay to fade and detach. The loader gates on the
 * hero image decoding and the music reaching `canplay`, so give it room.
 */
export async function waitForLoaderDismissed(page: Page) {
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 45_000 });
}

/**
 * Dismiss the welcome gate (covers the viewport from first paint and swallows
 * pointer input until revealed). A keydown dismissal avoids hit-testing a
 * mid-transition surface. The gate deliberately ignores keydown while the
 * loading overlay is still up (a stray keypress must not burn the reveal), so
 * wait for the loader to detach first.
 */
/**
 * Remove the Astro dev toolbar (dev-server-only overlay pinned to the bottom
 * of the viewport). It intercepts pointer events over bottom-anchored UI —
 * e.g. the add-story flow's action row — and only ever exists in `astro dev`.
 */
export async function removeDevToolbar(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll("astro-dev-toolbar").forEach((el) => el.remove());
  });
}

export async function dismissWelcomeGate(page: Page) {
  const gate = page.locator("#welcome-gate");
  if ((await gate.count()) === 0) return;
  await waitForLoaderDismissed(page);
  await page.keyboard.press("Escape");
  await gate.waitFor({ state: "detached", timeout: 10_000 });
  await removeDevToolbar(page);
}

/**
 * Empty-wall precondition for the specs that assert SSR mock presence.
 *
 * The mock gate is a SERVER-side read of the live database, so unlike the
 * payload-driven assertions it cannot be routed around: if the shared dev
 * server (playwright.config.ts reuses one on :4321 outside CI) points at a
 * database that already holds guest photos — the normal dogfooding state —
 * `[data-mock]` counts can never be 3 and those tests would fail for purely
 * environmental reasons. mock-gate-ssr covers both gate branches properly
 * against a private server with a throwaway DB, so skipping here loses no
 * coverage; it just keeps "suite green" honest on a dogfooded machine.
 */
export async function skipUnlessEmptyWall(page: Page): Promise<void> {
  const res = await page.request.get("/api/submissions");
  if (!res.ok()) return; // can't tell; let the test fail loudly instead
  const body = (await res.json()) as { wall?: { stories?: unknown[] } };
  const stories = body.wall?.stories?.length ?? 0;
  test.skip(
    stories > 0,
    `shared dev server wall is non-empty (${stories} stories) — mock-presence cases need an empty wall; see mock-gate-ssr for seeded coverage`,
  );
}
