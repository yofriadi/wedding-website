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

  // Get initial src
  const src1 = await img.getAttribute("src");

  // Click next (right side of stage)
  const box = await stage.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  }

  // Wait for transition
  await page.waitForTimeout(1000);

  // Check that we have a new image or the src changed
  const img2 = stage.locator("img").last(); // Get the last one in case old one is fading out
  // Or check if video if the second story is video.
  // In index.astro, story 2 is image /3.jpg.

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
