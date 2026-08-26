import type { Page } from "@playwright/test";

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
export async function dismissWelcomeGate(page: Page) {
  const gate = page.locator("#welcome-gate");
  if ((await gate.count()) === 0) return;
  await waitForLoaderDismissed(page);
  await page.keyboard.press("Escape");
  await gate.waitFor({ state: "detached", timeout: 10_000 });
}
