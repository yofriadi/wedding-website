import { test, expect } from "@playwright/test";

test("story viewer opens and navigates", async ({ page }) => {
  page.on("console", (msg) => console.log(msg.text()));
  page.on("pageerror", (exception) => console.log(`Uncaught exception: "${exception}"`));

  await page.goto("/");

  // Check if story viewer trigger is visible
  const trigger = page.locator("[data-story-viewer] [data-open]").first();
  await expect(trigger).toBeVisible();

  // Open story viewer
  await trigger.click();

  // Wait a bit to see if anything happens
  await page.waitForTimeout(1000);

  // Check if modal is visible (we opened the first one)
  // Since there are multiple modals now, we need to find the one that is visible (aria-hidden=false)
  const globalModal = page.locator('[data-modal][aria-hidden="false"]');
  await expect(globalModal).toBeVisible();

  // Wait for animation
  await page.waitForTimeout(500);

  // Check if image is visible in stage
  const stage = globalModal.locator("[data-stage]");
  const img = stage.locator("img").first();
  await expect(img).toBeVisible();

  // Click next (right side of stage)
  const box = await stage.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  }

  // Wait for transition
  await page.waitForTimeout(1000);

  // Check that the next story is rendered after the transition.

  // Ensure we have an image
  await expect(stage.locator("img").last()).toBeVisible();

  // Close
  const closeBtn = globalModal.locator("[data-close]");
  await closeBtn.click();

  // Wait for close animation
  await page.waitForTimeout(500);

  // Check if modal is hidden
  // Once it is hidden, the selector [aria-hidden="false"] will no longer match it.
  // We need to find the modal that WAS visible and assert it is now hidden.
  // But we can't select it by aria-hidden="false" anymore.
  // Since we know we clicked the first trigger, we can assume it corresponds to the first story viewer's modal.
  // Or simpler: check that NO modal is visible.

  const anyVisibleModal = page.locator('[data-modal][aria-hidden="false"]');
  await expect(anyVisibleModal).toHaveCount(0);
});

test("forward hand-off keeps a modal visible until the next viewer is ready", async ({ page }) => {
  await page.goto("/");

  await page.locator("[data-story-viewer] [data-open]").first().click();
  const visibleModal = page.locator('[data-modal][aria-hidden="false"]');
  await expect(visibleModal).toHaveCount(1);

  const stage = visibleModal.locator("[data-stage]");
  const clickSide = async (fraction: number) => {
    const box = await stage.boundingBox();
    if (!box) throw new Error("stage not visible");
    await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
  };

  // Viewer 1 (Aisha) has 3 stories; advance to the last one.
  await page.waitForTimeout(600);
  await clickSide(0.75);
  await page.waitForTimeout(600);
  await clickSide(0.75);
  await page.waitForTimeout(600);

  // Sample modal visibility every frame during the hand-off: the outgoing
  // viewer must stay open until the incoming viewer's first slide is ready,
  // so the count of open modals never drops to zero (no black flash).
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

  await clickSide(0.75); // last story -> story-viewer-end -> hand-off

  const minVisible = await minVisiblePromise;
  expect(minVisible).toBeGreaterThanOrEqual(1);

  // Hand-off complete: exactly one modal remains, showing viewer 2's first story.
  await expect(visibleModal).toHaveCount(1);
  await expect(visibleModal.locator("[data-stage] img").first()).toHaveAttribute(
    "src",
    /\/4\.jpg$/,
  );
});

test("reverse hand-off opens the previous viewer at its last story", async ({ page }) => {
  await page.goto("/");

  // Open viewer 2 (Yofri).
  await page.locator("[data-story-viewer] [data-open]").nth(1).click();
  const visibleModal = page.locator('[data-modal][aria-hidden="false"]');
  await expect(visibleModal).toHaveCount(1);

  const stage = visibleModal.locator("[data-stage]");
  await page.waitForTimeout(600);

  // Left-half tap on the first story fires story-viewer-prev; the orchestrator
  // opens viewer 1 with startIndex: "last".
  const box = await stage.boundingBox();
  if (!box) throw new Error("stage not visible");
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);

  // Hand-off settles: one modal remains, viewer 1's at its LAST story (/7.jpg).
  await expect(visibleModal.locator("[data-stage] img").first()).toHaveAttribute(
    "src",
    /\/7\.jpg$/,
    { timeout: 5000 },
  );
  await expect(visibleModal).toHaveCount(1);
});

test("progress fill advances via transform scaleX, not width", async ({ page }) => {
  await page.goto("/");

  await page.locator("[data-story-viewer] [data-open]").first().click();
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
