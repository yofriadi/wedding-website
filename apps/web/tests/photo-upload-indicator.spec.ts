import { expect, test, type Page } from "@playwright/test";

const FIXTURE = `<!doctype html>
<style>
  #icon { position: relative; width: 40px; height: 40px; --cta-icon-bg: #f5f5f7; }
  @media (prefers-color-scheme: light) { #icon { --cta-icon-bg: #1d1d1f; } }
</style>
<div id="icon"><canvas data-photo-indicator></canvas></div>
<script type="module">
  import { initPhotoUploadIndicator } from "/src/scripts/photo-upload-indicator.ts";
  window.indicator = initPhotoUploadIndicator(document.querySelector("#icon"));
  window.draws = 0;
  const fill = CanvasRenderingContext2D.prototype.fill;
  CanvasRenderingContext2D.prototype.fill = function (...args) {
    window.draws++;
    return Reflect.apply(fill, this, args);
  };
</script>`;

type IndicatorWindow = Window & {
  indicator: { setUploading(value: boolean): void; destroy(): void };
  draws: number;
};

async function mount(page: Page) {
  await page.route("**/__indicator-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: FIXTURE,
    }),
  );
  await page.goto("/__indicator-fixture");
  await expect(page.locator("#icon")).toHaveAttribute("data-indicator-ready", "");
  // Freeze rAF after the real initial paint/ResizeObserver callback.
  await page.clock.install();
  await page.clock.pauseAt(new Date());
}

async function setUploading(page: Page, value: boolean) {
  await page.evaluate(
    (value) => (window as unknown as IndicatorWindow).indicator.setUploading(value),
    value,
  );
}

async function snapshot(page: Page) {
  return page.locator("canvas").evaluate((node) => (node as HTMLCanvasElement).toDataURL());
}

async function draws(page: Page) {
  return page.evaluate(() => (window as unknown as IndicatorWindow).draws);
}

test("the same circle becomes the M3 shapes, then returns from its live shape and stops", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mount(page);
  const circle = await snapshot(page);
  await setUploading(page, true);
  expect(await snapshot(page)).toBe(circle); // No first-frame replacement.
  await page.clock.runFor(120);
  const entering = await snapshot(page);
  expect(entering).not.toBe(circle);
  await page.clock.runFor(700);
  const shape = await snapshot(page);
  expect(shape).not.toBe(circle);
  expect(shape).not.toBe(entering);
  await setUploading(page, false);
  expect(await snapshot(page)).toBe(shape); // Retarget from the painted silhouette.
  await page.clock.runFor(120);
  const returning = await snapshot(page);
  expect(returning).not.toBe(shape);
  expect(returning).not.toBe(circle);
  await page.clock.runFor(160);
  expect(await snapshot(page)).toBe(circle);
  const stopped = await draws(page);
  await page.clock.runFor(1_300);
  expect(await draws(page)).toBe(stopped);
});

test("a rapid retry reverses the return morph without snapping or leaving another loop running", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mount(page);
  const circle = await snapshot(page);
  await setUploading(page, true);
  await page.clock.runFor(900);
  await setUploading(page, false);
  await page.clock.runFor(100);
  const returning = await snapshot(page);
  await setUploading(page, true);
  expect(await snapshot(page)).toBe(returning);
  await page.clock.runFor(400);
  expect(await snapshot(page)).not.toBe(returning);
  expect(await snapshot(page)).not.toBe(circle);
  await setUploading(page, false);
  await page.clock.runFor(300);
  expect(await snapshot(page)).toBe(circle);
  const stopped = await draws(page);
  await page.clock.runFor(700);
  expect(await draws(page)).toBe(stopped);
});

test("reduced motion uses a static M3 shape and responds to live preference changes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mount(page);
  const circle = await snapshot(page);
  await setUploading(page, true);
  const stillShape = await snapshot(page);
  expect(stillShape).not.toBe(circle);
  const stopped = await draws(page);
  await page.clock.runFor(1_300);
  expect(await snapshot(page)).toBe(stillShape);
  expect(await draws(page)).toBe(stopped);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // Media-query events run on the browser's rendering schedule, not the
  // mocked clock. Poll while advancing frames until that event has arrived.
  await expect
    .poll(async () => {
      await page.clock.runFor(100);
      return snapshot(page);
    })
    .not.toBe(stillShape);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(async () => {
      await page.clock.runFor(100);
      return snapshot(page);
    })
    .toBe(stillShape);
  await setUploading(page, false);
  expect(await snapshot(page)).toBe(circle);
});

test("hidden tabs stop drawing, resume in place, and can finish while hidden", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mount(page);
  const circle = await snapshot(page);
  const visibility = (hidden: boolean) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await setUploading(page, true);
  await page.clock.runFor(700);
  await visibility(true);
  const shape = await snapshot(page);
  const paused = await draws(page);
  await page.clock.runFor(1_300);
  expect(await snapshot(page)).toBe(shape);
  expect(await draws(page)).toBe(paused);
  await visibility(false);
  expect(await snapshot(page)).toBe(shape);
  await page.clock.runFor(300);
  expect(await snapshot(page)).not.toBe(shape);
  await visibility(true);
  await setUploading(page, false);
  expect(await snapshot(page)).toBe(circle);
  await visibility(false);
  const stopped = await draws(page);
  await page.clock.runFor(700);
  expect(await draws(page)).toBe(stopped);
});

test("the circle and shapes keep the theme color and native pixel density", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await mount(page);
  const sample = () =>
    page.locator("canvas").evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const ctx = canvas.getContext("2d")!;
      return {
        width: canvas.width,
        expectedWidth: Math.round(40 * window.devicePixelRatio),
        color: Array.from(ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data),
      };
    });
  expect(await sample()).toMatchObject({ color: [29, 29, 31, 255] });
  expect((await sample()).width).toBe((await sample()).expectedWidth);
  await setUploading(page, true);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect
    .poll(async () => {
      await page.clock.runFor(100);
      return sample();
    })
    .toMatchObject({ color: [245, 245, 247, 255] });
  await setUploading(page, false);
  expect(await sample()).toMatchObject({ color: [245, 245, 247, 255] });
});

test("destroy cancels animation and preference listeners, restoring the CSS fallback", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mount(page);
  await setUploading(page, true);
  await page.clock.runFor(400);
  await page.evaluate(() => (window as unknown as IndicatorWindow).indicator.destroy());
  await expect(page.locator("#icon")).not.toHaveAttribute("data-indicator-ready");
  const stopped = await draws(page);
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new Event("visibilitychange"));
    (window as unknown as IndicatorWindow).indicator.setUploading(true);
  });
  await page.clock.runFor(1_300);
  expect(await draws(page)).toBe(stopped);
});
