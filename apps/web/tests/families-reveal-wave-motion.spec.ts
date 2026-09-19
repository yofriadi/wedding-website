import { test, expect } from "@playwright/test";

/**
 * The wave dividers animate via SMIL `<animate>`, which no CSS media query can
 * reach — `prefers-reduced-motion` would otherwise leave them scrolling
 * indefinitely. The component pauses the owning SVG timeline instead of
 * deleting the nodes, so the effect is reversible when the OS preference is
 * turned back off mid-session.
 */
import { dismissWelcomeGate } from "./helpers";

const waveX = (page: any) =>
  page.evaluate(() => {
    const p = document.querySelector<SVGPatternElement>("#families-section pattern");
    return p ? p.x.animVal.value : null;
  });

test("reduced motion: the wave is frozen (x does not advance)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await dismissWelcomeGate(page);
  await page.waitForTimeout(400);
  const a = await waveX(page);
  await page.waitForTimeout(700); // > half the 1.6s loop
  const b = await waveX(page);
  expect(a, "pattern exists").not.toBeNull();
  expect(b, "the wave did not travel under reduced motion").toBeCloseTo(a!, 5);
  const nodes = await page.evaluate(
    () => document.querySelectorAll("#families-section animate").length,
  );
  expect(nodes, "the <animate> nodes are preserved, not deleted").toBeGreaterThan(0);
});

test("motion allowed: the wave travels", async ({ page }) => {
  await page.goto("/");
  await dismissWelcomeGate(page);
  await page.waitForTimeout(400);
  const a = await waveX(page);
  await page.waitForTimeout(500);
  const b = await waveX(page);
  expect(Math.abs(b! - a!), "the wave advances when motion is allowed").toBeGreaterThan(0.01);
});

test("flipping reduced-motion OFF mid-session restores the wave", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await dismissWelcomeGate(page);
  await page.waitForTimeout(300);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 880, height: 700 }); // width change -> re-init
  await page.waitForTimeout(700);
  const a = await waveX(page);
  await page.waitForTimeout(500);
  const b = await waveX(page);
  expect(Math.abs(b! - a!), "motion returns after the preference is turned off").toBeGreaterThan(
    0.01,
  );
});
