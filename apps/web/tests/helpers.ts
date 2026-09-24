import type { Page } from "@playwright/test";

/**
 * Wait for the loading overlay to fade and detach. The loader gates on the
 * hero image fetching and decoding (media-tiering: "Loader gates on
 * first-view media only"), raced against an 8 s ceiling, plus its minimum
 * dwell — so give it room. The audio gate this wait used to describe is
 * retired: the soundtrack no longer holds the loader on any tier.
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

  // If an entry claim gate is present, complete claiming before dismissing welcome gate.
  const claimGate = page.locator("#claim-gate");
  if ((await claimGate.count()) > 0 && (await claimGate.isVisible())) {
    const input = page.locator("#claim-gate-input");
    await input.fill("Guest Claimant");
    const submitBtn = page.locator("#claim-gate-submit");
    await submitBtn.click();
    await claimGate.waitFor({ state: "detached", timeout: 10_000 });
  }

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

/** A Network Information API shape the head script reads at parse time. */
export type ConnectionStub = {
  saveData: boolean;
  effectiveType: string;
  downlink: number;
} | null;

/**
 * Replace `navigator.connection` before any page script runs (media-tiering
 * task 7.3). `null` models an engine without the API (Safari/Firefox): the
 * head script then yields `pending` and resolves by measurement.
 */
export function stubNetworkConnection(page: Page, conn: ConnectionStub) {
  page.addInitScript((value) => {
    Object.defineProperty(navigator, "connection", {
      value,
      configurable: true,
    });
  }, conn);
}

/** Chromium-shaped verdicts the API can give. */
export const CONNECTION_FULL: ConnectionStub = {
  saveData: false,
  effectiveType: "4g",
  downlink: 10,
};
export const CONNECTION_LITE: ConnectionStub = {
  saveData: false,
  effectiveType: "3g",
  downlink: 0.9,
};

/**
 * Pin the media tier to `full` for a suite that asserts full-tier behavior
 * (task 7.3): the API verdict is synchronous, and blanking the resource
 * timing buffer takes the measured burst out of the picture so a loaded
 * machine or a parallel worker cannot silently downgrade the suite to lite
 * halfway through its assertions.
 */
export function pinFullTier(page: Page) {
  stubNetworkConnection(page, CONNECTION_FULL);
  page.addInitScript(() => {
    const real = performance.getEntriesByType.bind(performance);
    performance.getEntriesByType = (type: string) => (type === "resource" ? [] : real(type));
  });
}

/**
 * Record `net-tier:change` resolutions on `window.__tierEvents` so a test can
 * assert on every verdict transition, not just the final attribute value.
 * Must be installed before the head script runs, i.e. via addInitScript.
 */
export function recordTierEvents(page: Page) {
  page.addInitScript(() => {
    const events: Array<{ tier: string; previous: string | null }> = [];
    (window as unknown as { __tierEvents: typeof events }).__tierEvents = events;
    window.addEventListener("net-tier:change", (event) => {
      const detail = (event as CustomEvent<{ tier: string; previous: string | null }>).detail;
      events.push({ tier: detail.tier, previous: detail.previous });
    });
  });
}

export const currentTier = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute("data-tier"));
