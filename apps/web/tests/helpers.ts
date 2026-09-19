import type { Page } from "@playwright/test";

/**
 * Wait for the loading overlay to fade and detach. The loader gates on the
 * hero image decoding and the music reaching `canplay`, so give it room.
 */
export async function waitForLoaderDismissed(page: Page) {
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 45_000 });
}

/** Remove the dev toolbar so it cannot intercept bottom-anchored controls. */
export async function removeDevToolbar(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll("astro-dev-toolbar").forEach((el) => el.remove());
  });
}

export async function dismissWelcomeGate(page: Page) {
  const gate = page.locator("#welcome-gate");
  if ((await gate.count()) === 0) return;
  await waitForLoaderDismissed(page);
  // The gate arms from a MutationObserver after loader removal. Wait for its
  // observable inert state before sending a key that an unarmed gate can miss.
  await page.waitForFunction(
    () =>
      !document.getElementById("welcome-gate") ||
      document.querySelector("main")?.hasAttribute("inert"),
  );
  await page.keyboard.press("Escape");
  await gate.waitFor({ state: "detached", timeout: 10_000 });
  await removeDevToolbar(page);
}
