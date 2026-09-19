import { expect, test, type Page } from "@playwright/test";
import { selectTrailImages } from "../src/lib/photo-trail";
import type { GuestPhoto, GuestPhotosPayload } from "../src/lib/guest-photos";
import { dismissWelcomeGate } from "./helpers";

const TRAIL = "[data-trail]";
const CONTROLS = "photo-trail-controls";
const BUTTON = "[data-add-image]";
const FLOW = "#add-story-flow";
const TINY_WEBP = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");
const file = (name = "memory.webp") => ({ name, mimeType: "image/webp", buffer: TINY_WEBP });
const photo = (photoUrl: string, createdAt = 1): GuestPhoto => ({
  id: photoUrl.replace(/\W/g, "").slice(-12).padEnd(12, "0"),
  photoUrl,
  createdAt,
});
const payload = (inviteValid: boolean, photos: GuestPhoto[] = []): GuestPhotosPayload => ({
  mineId: null,
  inviteValid,
  photos,
});
const withMine = (data: GuestPhotosPayload, id: string, url: string): GuestPhotosPayload => ({
  ...data,
  mineId: id.padEnd(12, "0"),
  photos: [{ ...photo(url), id: id.padEnd(12, "0") }, ...data.photos],
});

async function mockPhotos(page: Page) {
  await page.route("**/test-memory-*.webp", (route) =>
    route.fulfill({ contentType: "image/webp", body: TINY_WEBP }),
  );
}

async function gotoTrail(page: Page) {
  await page.goto("/");
  await dismissWelcomeGate(page);
  await page.locator(TRAIL).scrollIntoViewIfNeeded();
  await expect(page.locator(CONTROLS)).toHaveAttribute("data-ready", "true");
}

async function currentImages(page: Page): Promise<string[]> {
  return JSON.parse((await page.locator("[data-trail-images]").textContent()) ?? "[]");
}

async function indicatorImage(page: Page): Promise<string> {
  return page
    .locator("[data-photo-indicator]")
    .evaluate((node) => (node as HTMLCanvasElement).toDataURL());
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function openPicker(page: Page) {
  await page.locator(CONTROLS).scrollIntoViewIfNeeded();
  await expect(page.locator(CONTROLS)).toHaveAttribute("data-revealed", "");
  const chooser = page.waitForEvent("filechooser");
  await page.locator(BUTTON).click();
  const picker = await chooser;
  expect(picker.isMultiple()).toBe(false);
  await expect(page.locator(FLOW)).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  return picker;
}

test.setTimeout(60_000);

test("public visitors see only guest photos, without the old story rail or a posting button", async ({
  page,
}) => {
  let reads = 0;
  const data = payload(false, [photo("/test-memory-public.webp")]);
  await mockPhotos(page);
  await page.route("**/api/guest-photos", (route) => {
    reads++;
    return route.fulfill({ json: data });
  });
  await gotoTrail(page);
  await expect.poll(() => currentImages(page)).toEqual(selectTrailImages(data));
  await expect(page.locator(BUTTON)).toBeHidden();
  await expect(page.locator("[data-story-rail], story-viewer, [data-add-story-open]")).toHaveCount(
    0,
  );
  expect(reads).toBe(1);
});

test("a stale invitation cookie does not reveal the posting button", async ({ page, context }) => {
  await context.addCookies([
    { name: "ww_invite_id", value: "StaleInvite1", domain: "localhost", path: "/" },
  ]);
  await page.route("**/api/guest-photos", (route) => route.fulfill({ json: payload(false) }));
  await gotoTrail(page);
  await expect(page.locator(BUTTON)).toBeHidden();
  expect(await currentImages(page)).toEqual(selectTrailImages(null));
});

test("a temporary read failure keeps the trail unchanged and retries when the tab regains focus", async ({
  page,
}) => {
  let available = false;
  await page.route("**/api/guest-photos", (route) =>
    available
      ? route.fulfill({ json: payload(true) })
      : route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await gotoTrail(page);
  await expect(page.locator(BUTTON)).toBeHidden();
  expect(await currentImages(page)).toEqual(selectTrailImages(null));
  await page.locator(CONTROLS).scrollIntoViewIfNeeded();
  available = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(BUTTON)).toBeVisible();
  await expect(page.locator(CONTROLS)).toHaveAttribute("data-revealed", "");
});

test("an existing photo appears in the trail with a completed status button", async ({ page }) => {
  const data = withMine(payload(true), "existing", "/test-memory-mine.webp");
  await mockPhotos(page);
  await page.route("**/api/guest-photos", (route) => route.fulfill({ json: data }));
  await gotoTrail(page);
  await page.locator(CONTROLS).scrollIntoViewIfNeeded();
  await expect.poll(() => currentImages(page)).toEqual(selectTrailImages(data));
  await expect(page.locator(BUTTON)).toHaveAccessibleName("Foto ditambahkan");
  await expect(page.locator(BUTTON)).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator('[data-photo-icon="success"]')).toBeVisible();
});

test("posting button matches SlideToConfirm's grey track in both themes, including hover", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/guest-photos", (route) => route.fulfill({ json: payload(true) }));
  await gotoTrail(page);
  await page.locator(CONTROLS).scrollIntoViewIfNeeded();
  const button = page.locator(BUTTON);
  await expect(button).toHaveCSS("opacity", "1");

  for (const [colorScheme, background] of [
    ["dark", "rgb(38, 38, 38)"],
    ["light", "rgb(245, 245, 245)"],
  ] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await expect(button).toHaveCSS("background-color", background);
    await expect(button).toHaveCSS("backdrop-filter", "none");
    await button.hover();
    await expect(button).toHaveCSS("background-color", background);
    await page.mouse.move(0, 0);
  }
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`button rises, expands before fading in its label, and parks below the trail — ${reducedMotion}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.route("**/api/guest-photos", (route) => route.fulfill({ json: payload(true) }));
    await page.goto("/");
    await dismissWelcomeGate(page);
    const controls = page.locator(CONTROLS);
    const button = page.locator(BUTTON);
    await expect(controls).toHaveAttribute("data-ready", "true");
    await expect(controls).not.toHaveAttribute("data-revealed", "");
    await expect(button).toHaveCSS("opacity", "0");

    // The photos can be visible without triggering the button below them.
    await controls.evaluate((node) =>
      window.scrollTo({
        top: node.getBoundingClientRect().top + scrollY - innerHeight - 24,
        behavior: "instant",
      }),
    );
    await expect(page.locator(TRAIL)).toBeInViewport();
    await expect(controls).not.toBeInViewport();
    await expect(controls).not.toHaveAttribute("data-revealed", "");
    await expect(button).toHaveCSS("opacity", "0");

    if (reducedMotion === "no-preference") {
      // Pause the actual CSS transitions at exact times, rather than racing
      // wall-clock delays on busy desktop/mobile test workers.
      const phases = await controls.evaluate(async (node) => {
        const button = node.querySelector<HTMLElement>("[data-add-image]")!;
        const label = button.querySelector<HTMLElement>(".photo-cta__label")!;
        const icon = button.querySelector<HTMLElement>(".photo-cta__icon")!;
        const entrance = new Promise<void>((resolve) => {
          const observer = new MutationObserver(() => {
            if (!node.hasAttribute("data-revealed")) return;
            observer.disconnect();
            resolve();
          });
          observer.observe(node, { attributes: true, attributeFilter: ["data-revealed"] });
        });
        window.scrollTo({
          top: node.getBoundingClientRect().top + scrollY - innerHeight + 24,
          behavior: "instant",
        });
        await entrance;
        const transitions = button.getAnimations({ subtree: true });
        transitions.forEach((animation) => animation.pause());
        const sample = (time: number) => {
          transitions.forEach((animation) => {
            animation.currentTime = time;
          });
          const style = getComputedStyle(button);
          const inset = Number(style.clipPath.match(/^inset\([^ ]+ ([\d.]+)px/)?.[1] ?? 0);
          const rect = button.getBoundingClientRect();
          const iconRect = icon.getBoundingClientRect();
          return {
            visibleWidth: parseFloat(style.width) - 2 * inset,
            height: parseFloat(style.height),
            y: new DOMMatrixReadOnly(style.transform).m42,
            labelOpacity: Number(getComputedStyle(label).opacity),
            iconCenterOffset: iconRect.x + iconRect.width / 2 - (rect.x + rect.width / 2),
          };
        };
        const phases = {
          rising: sample(100),
          landed: sample(200),
          expanding: sample(225),
          halfway: sample(450),
          expanded: sample(700),
          fading: sample(740),
          labeled: sample(860),
        };
        transitions.forEach((animation) => animation.finish());
        return phases;
      });
      expect(phases.rising.visibleWidth).toBeCloseTo(phases.rising.height, 1);
      expect(phases.rising.y).toBeGreaterThan(0);
      expect(phases.rising.labelOpacity).toBe(0);
      expect(Math.abs(phases.rising.iconCenterOffset)).toBeLessThan(1);
      expect(phases.landed.y).toBeCloseTo(0, 1);
      expect(phases.landed.visibleWidth).toBeCloseTo(phases.landed.height, 1);
      expect(phases.landed.labelOpacity).toBe(0);
      expect(phases.expanding.visibleWidth).toBeGreaterThan(phases.landed.visibleWidth);
      expect(phases.expanding.labelOpacity).toBe(0);
      expect(phases.halfway.visibleWidth).toBeGreaterThan(110);
      expect(phases.halfway.visibleWidth).toBeLessThan(170);
      expect(phases.halfway.labelOpacity).toBe(0);
      expect(phases.expanded.visibleWidth).toBeCloseTo(240, 1);
      expect(phases.expanded.labelOpacity).toBe(0);
      expect(phases.fading.visibleWidth).toBeCloseTo(phases.expanded.visibleWidth, 1);
      expect(phases.fading.labelOpacity).toBeGreaterThan(0);
      expect(phases.fading.labelOpacity).toBeLessThan(1);
      expect(phases.labeled.labelOpacity).toBe(1);
    } else {
      await controls.scrollIntoViewIfNeeded();
      await expect(button).toHaveCSS("transform", "none");
      await expect(button).toHaveCSS("clip-path", "none");
      await expect(button.locator(".photo-cta__label")).toHaveCSS("transition-delay", "0s");
    }
    await expect(controls).toHaveAttribute("data-revealed", "");
    await expect(button).toHaveCSS("opacity", "1");
    await expect(button.locator(".photo-cta__label")).toHaveCSS("opacity", "1");
    await expect(button).toHaveAccessibleName("Tambah punyamu");
    const labelFits = await button.evaluate((node) => {
      const label = node.querySelector(".photo-cta__label")!;
      const icon = node.querySelector(".photo-cta__icon")!;
      const range = document.createRange();
      range.selectNodeContents(label);
      return range.getBoundingClientRect().right < icon.getBoundingClientRect().left;
    });
    expect(labelFits).toBe(true);

    const stage = page.locator("[data-photo-trail-section]");
    // At its reveal point, native sticky positioning holds the button at the
    // viewport bottom without moving its in-flow trigger.
    await expect
      .poll(async () => {
        const rect = await button.boundingBox();
        const stageRect = await stage.boundingBox();
        const targetBottom =
          Math.min(page.viewportSize()!.height, stageRect!.y + stageRect!.height) - 24;
        return Math.abs(rect!.y + rect!.height - targetBottom);
      })
      .toBeLessThan(2);

    // At the section end the button is physically below the photo canvas, not
    // fixed to the screen or covering the next section.
    await stage.evaluate((node) =>
      window.scrollTo({
        top: node.getBoundingClientRect().bottom + scrollY - innerHeight / 2,
        behavior: "instant",
      }),
    );
    await expect
      .poll(async () => {
        const rect = await button.boundingBox();
        const stageRect = await stage.boundingBox();
        return Math.abs(rect!.y + rect!.height - (stageRect!.y + stageRect!.height - 24));
      })
      .toBeLessThan(2);
    const canvas = await page.locator("[data-trail-canvas]").boundingBox();
    const parked = await button.boundingBox();
    expect(parked!.y).toBeGreaterThanOrEqual(canvas!.y + canvas!.height);

    await page.locator("#rsvp-section").scrollIntoViewIfNeeded();
    const past = await button.boundingBox();
    expect(past!.y + past!.height).toBeLessThan(0);
    await controls.scrollIntoViewIfNeeded();
    await expect(controls).toHaveAttribute("data-revealed", "");
    await expect(button).toHaveCSS("opacity", "1");
  });

  test(`scrolling back collapses the pill before lowering it, while it stays sticky — ${reducedMotion}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.route("**/api/guest-photos", (route) => route.fulfill({ json: payload(true) }));
    await gotoTrail(page);
    const controls = page.locator(CONTROLS);
    const button = page.locator(BUTTON);
    await controls.scrollIntoViewIfNeeded();
    await expect(controls).toHaveAttribute("data-revealed", "");
    await expect(button).toHaveCSS("opacity", "1");
    await expect(button.locator(".photo-cta__label")).toHaveCSS("opacity", "1");

    if (reducedMotion === "no-preference") {
      await expect(button).toHaveCSS("clip-path", "inset(0px round 28px)");
      const phases = await controls.evaluate(async (node) => {
        const button = node.querySelector<HTMLButtonElement>("[data-add-image]")!;
        const label = button.querySelector<HTMLElement>(".photo-cta__label")!;
        const icon = button.querySelector<HTMLElement>(".photo-cta__icon")!;
        const sticky = node.querySelector<HTMLElement>(".photo-cta__sticky")!;
        const exit = new Promise<void>((resolve) => {
          const observer = new MutationObserver(() => {
            if (node.hasAttribute("data-revealed")) return;
            observer.disconnect();
            resolve();
          });
          observer.observe(node, { attributes: true, attributeFilter: ["data-revealed"] });
        });
        window.scrollTo({
          top: node.getBoundingClientRect().top + scrollY - innerHeight - 24,
          behavior: "instant",
        });
        await exit;
        const transitions = button.getAnimations({ subtree: true });
        transitions.forEach((animation) => animation.pause());
        const sample = (time: number) => {
          transitions.forEach((animation) => {
            animation.currentTime = time;
          });
          const style = getComputedStyle(button);
          const inset = Number(style.clipPath.match(/^inset\([^ ]+ ([\d.]+)px/)?.[1] ?? 0);
          const rect = button.getBoundingClientRect();
          const iconRect = icon.getBoundingClientRect();
          return {
            visibleWidth: parseFloat(style.width) - 2 * inset,
            y: new DOMMatrixReadOnly(style.transform).m42,
            opacity: Number(style.opacity),
            labelOpacity: Number(getComputedStyle(label).opacity),
            iconCenterOffset: iconRect.x + iconRect.width / 2 - (rect.x + rect.width / 2),
            stickyBottom: sticky.getBoundingClientRect().bottom,
            viewportBottom: innerHeight - 24,
            position: getComputedStyle(sticky).position,
            hidden: button.hidden,
          };
        };
        const collapsing = sample(250);
        // Continued upward scrolling must not detach the button mid-exit.
        window.scrollBy({ top: -24, behavior: "instant" });
        const phases = {
          collapsing,
          collapsed: sample(500),
          lowering: sample(600),
          gone: sample(700),
        };
        transitions.forEach((animation) => animation.finish());
        return phases;
      });
      expect(phases.collapsing.visibleWidth).toBeGreaterThan(56);
      expect(phases.collapsing.visibleWidth).toBeLessThan(240);
      expect(phases.collapsing.y).toBe(0);
      expect(phases.collapsing.opacity).toBe(1);
      expect(phases.collapsing.labelOpacity).toBe(0);
      expect(phases.collapsed.visibleWidth).toBeCloseTo(56, 1);
      expect(phases.collapsed.y).toBe(0);
      expect(phases.collapsed.opacity).toBe(1);
      expect(Math.abs(phases.collapsed.iconCenterOffset)).toBeLessThan(1);
      expect(phases.lowering.visibleWidth).toBeCloseTo(56, 1);
      expect(phases.lowering.y).toBeGreaterThan(0);
      expect(phases.lowering.opacity).toBeGreaterThan(0);
      expect(phases.lowering.opacity).toBeLessThan(1);
      expect(phases.gone.opacity).toBe(0);
      for (const phase of Object.values(phases)) {
        expect(phase.position).toBe("sticky");
        expect(Math.abs(phase.stickyBottom - phase.viewportBottom)).toBeLessThan(2);
        expect(phase.hidden).toBe(false);
      }
    } else {
      await controls.evaluate((node) =>
        window.scrollTo({
          top: node.getBoundingClientRect().top + scrollY - innerHeight - 24,
          behavior: "instant",
        }),
      );
      await expect(button).toHaveCSS("transform", "none");
      await expect(button).toHaveCSS("clip-path", "none");
      await expect(button).toHaveCSS("transition-delay", "0s");
    }
    await expect(controls).not.toHaveAttribute("data-revealed", "");
    await expect(button).toHaveCSS("opacity", "0");
    await expect(button).toHaveCSS("pointer-events", "none");

    // A jump back to the page top stays hidden; crossing its location again
    // restores the same circle-to-pill entrance instead of a one-shot reveal.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect(button).toHaveCSS("opacity", "0");
    await controls.scrollIntoViewIfNeeded();
    await expect(controls).toHaveAttribute("data-revealed", "");
    await expect(button).toHaveCSS("opacity", "1");
    await expect(button.locator(".photo-cta__label")).toHaveCSS("opacity", "1");
  });
}

test("native picker cancellation leaves the trail unchanged without an intermediate screen", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/api/guest-photos", (route) => {
    if (route.request().method() === "POST") posts++;
    return route.fulfill({ json: payload(true) });
  });
  await gotoTrail(page);
  await openPicker(page);
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.locator("[data-photo-input]").dispatchEvent("cancel", { bubbles: true });
  await expect(page.locator(FLOW)).toHaveCount(0);
  await expect(page.locator(BUTTON)).toBeFocused();
  await expect(page.locator(BUTTON)).toHaveAttribute("data-state", "idle");
  await expect(page.locator(BUTTON)).toHaveAccessibleName("Tambah punyamu");
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  expect(posts).toBe(0);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`picking uploads immediately; the button waits for POST and image decode before showing success — ${reducedMotion}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    let data = payload(true);
    let posts = 0;
    let postBody = "";
    let imageRequests = 0;
    const upload = deferred();
    const image = deferred();
    await page.route("**/api/guest-photos", async (route) => {
      if (route.request().method() === "POST") {
        posts++;
        postBody = route.request().postData() ?? "";
        await upload.promise;
        data = withMine(data, "posted", "/test-memory-posted.webp");
        return route.fulfill({ status: 201, json: data.photos[0] });
      }
      return route.fulfill({ json: data });
    });
    await page.route("**/test-memory-posted.webp", async (route) => {
      imageRequests++;
      await image.promise;
      await route.fulfill({ contentType: "image/webp", body: TINY_WEBP });
    });
    try {
      await gotoTrail(page);
      const button = page.locator(BUTTON);
      const picker = await openPicker(page);
      const before = await button.boundingBox();
      const scrollY = await page.evaluate(() => window.scrollY);
      const circle = await indicatorImage(page);
      await picker.setFiles(file());

      await expect(button).toHaveAttribute("data-state", "uploading");
      await expect(button).toHaveAccessibleName("Mengunggah…");
      await expect(button).toHaveAttribute("aria-busy", "true");
      await expect(button).toHaveAttribute("aria-disabled", "true");
      await expect(button).toBeFocused();
      const indicator = page.locator("[data-photo-indicator]");
      await expect(indicator).toBeVisible();
      await expect(button.locator(".photo-cta__icon")).toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)",
      );
      await expect(page.locator('[data-photo-icon="loading"]')).toHaveCount(0);
      await expect.poll(() => indicatorImage(page)).not.toBe(circle);
      const shape = await indicatorImage(page);
      if (reducedMotion === "reduce") {
        await page.waitForTimeout(700); // Longer than an M3 shape cycle: no motion.
        expect(await indicatorImage(page)).toBe(shape);
      } else {
        await expect.poll(() => indicatorImage(page)).not.toBe(shape);
      }
      await expect(page.locator('[data-photo-icon="add"]')).toBeHidden();
      await expect(page.locator(`${FLOW}, [data-flow-panel], [data-photo-list]`)).toHaveCount(0);
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

      // aria-disabled retains focus; the handler must still reject activation.
      await button.dispatchEvent("click");
      await page.evaluate(() => {
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect.poll(() => posts).toBe(1);
      expect(postBody.match(/name="photo"/g)).toHaveLength(1);
      expect(postBody).toContain('filename="memory.webp"');

      upload.resolve();
      await expect.poll(() => imageRequests).toBe(1);
      await expect(button).toHaveAccessibleName("Mengunggah…");
      await expect(button).toHaveAttribute("aria-busy", "true");
      await expect(page.locator('[data-photo-icon="success"]')).toBeHidden();
      const decodingShape = await indicatorImage(page);
      expect(decodingShape).not.toBe(circle);
      if (reducedMotion === "no-preference") {
        await expect.poll(() => indicatorImage(page)).not.toBe(decodingShape);
      }

      image.resolve();
      await expect(button).toHaveAttribute("data-state", "success");
      await expect(button).toHaveAccessibleName("Foto ditambahkan");
      await expect(button).toHaveAttribute("aria-busy", "false");
      await expect(button).toHaveAttribute("aria-disabled", "true");
      await expect(page.locator('[data-photo-icon="success"]')).toBeVisible();
      // The same filled shape stays mounted through the return morph, then
      // stops drawing at the exact original circle behind the checkmark.
      await expect(indicator).toBeVisible();
      await expect.poll(() => indicatorImage(page)).toBe(circle);
      await expect(page.locator('[data-photo-icon="add"]')).toBeHidden();
      await expect(page.locator("[data-photo-status]")).toHaveText("Foto ditambahkan");
      await expect.poll(() => currentImages(page)).toEqual(selectTrailImages(data));
      // A mocked picker can finish before the initial circle-to-pill reveal.
      await expect(button.locator("[data-photo-label]")).toHaveCSS("opacity", "1");
      expect((await button.boundingBox())!.width).toBeCloseTo(before!.width, 1);
      expect(
        await button.evaluate((node) => {
          const range = document.createRange();
          range.selectNodeContents(node.querySelector("[data-photo-label]")!);
          return (
            range.getBoundingClientRect().right <
            node.querySelector(".photo-cta__icon")!.getBoundingClientRect().left
          );
        }),
      ).toBe(true);
      expect(JSON.parse((await page.locator("[data-trail-images]").textContent()) ?? "[]")).toEqual(
        ["/test-memory-posted.webp"],
      );
      await button.dispatchEvent("click");
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(button).toHaveAccessibleName("Foto ditambahkan");
      expect(posts).toBe(1);
    } finally {
      upload.resolve();
      image.resolve();
    }
  });
}

test("invalid image selections show an inline error without uploading or opening a screen", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/api/guest-photos", (route) => {
    if (route.request().method() === "POST") posts++;
    return route.fulfill({ json: payload(true) });
  });
  await gotoTrail(page);
  await (
    await openPicker(page)
  ).setFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.locator("[data-photo-error]")).toContainText("JPEG, PNG, WebP, atau AVIF");
  await expect(page.locator(BUTTON)).toHaveAccessibleName("Tambah punyamu");
  await expect(page.locator(BUTTON)).toHaveAttribute("aria-busy", "false");
  await (
    await openPicker(page)
  ).setFiles({
    name: "large.webp",
    mimeType: "image/webp",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(page.locator("[data-photo-error]")).toHaveText("Ukuran gambar maksimal 10 MB.");
  await expect(page.locator(FLOW)).toHaveCount(0);
  expect(posts).toBe(0);
});

test("a failed POST offers an inline retry of the same single file", async ({ page }) => {
  let data = payload(true);
  const bodies: string[] = [];
  await mockPhotos(page);
  await page.route("**/api/guest-photos", (route) => {
    if (route.request().method() === "POST") {
      bodies.push(route.request().postData() ?? "");
      if (bodies.length === 1)
        return route.fulfill({ status: 503, json: { error: "unavailable" } });
      data = withMine(data, "retry", "/test-memory-retry.webp");
      return route.fulfill({ status: 201, json: data.photos[0] });
    }
    return route.fulfill({ json: data });
  });
  await gotoTrail(page);
  const picker = await openPicker(page);
  const circle = await indicatorImage(page);
  await picker.setFiles(file("retry.webp"));
  const button = page.locator(BUTTON);
  await expect(page.locator("[data-photo-error]")).toContainText("Coba lagi");
  await expect(button).toHaveAccessibleName("Coba lagi");
  await expect(button).toHaveAttribute("aria-disabled", "false");
  await expect(button).toHaveAttribute("aria-busy", "false");
  await expect(page.locator('[data-photo-icon="success"]')).toBeHidden();
  await expect(page.locator(FLOW)).toHaveCount(0);
  await expect.poll(() => indicatorImage(page)).toBe(circle);
  await button.click();
  await expect(button).toHaveAccessibleName("Foto ditambahkan");
  expect(bodies).toHaveLength(2);
  for (const body of bodies) {
    expect(body.match(/name="photo"/g)).toHaveLength(1);
    expect(body).toContain('filename="retry.webp"');
  }
  await expect(page.locator("[data-photo-error]")).toBeHidden();
});

for (const failure of ["gallery", "image"] as const) {
  test(`a failed ${failure} refresh cannot report success or re-upload a committed photo`, async ({
    page,
  }) => {
    let data = payload(true);
    let posts = 0;
    let available = false;
    await page.route("**/api/guest-photos", (route) => {
      if (route.request().method() === "POST") {
        posts++;
        data = withMine(data, "sync", "/test-memory-sync.webp");
        return route.fulfill({ status: 201, json: data.photos[0] });
      }
      if (data.mineId && failure === "gallery" && !available) {
        return route.fulfill({ status: 503, json: { error: "unavailable" } });
      }
      return route.fulfill({ json: data });
    });
    await page.route("**/test-memory-sync.webp", (route) =>
      failure === "image" && !available
        ? route.fulfill({ status: 503, body: "unavailable" })
        : route.fulfill({ contentType: "image/webp", body: TINY_WEBP }),
    );
    await gotoTrail(page);
    await (await openPicker(page)).setFiles(file());
    const button = page.locator(BUTTON);
    await expect(page.locator("[data-photo-error]")).toContainText("galeri belum diperbarui");
    await expect(button).toHaveAccessibleName("Coba lagi");
    await expect(button).toHaveAttribute("aria-busy", "false");
    await expect(page.locator('[data-photo-icon="success"]')).toBeHidden();
    available = true;
    await button.click();
    await expect(button).toHaveAccessibleName("Foto ditambahkan");
    await expect.poll(() => currentImages(page)).toEqual(selectTrailImages(data));
    expect(posts).toBe(1);
  });
}

test("server validation returns to the native picker rather than retrying invalid bytes", async ({
  page,
}) => {
  let data = payload(true);
  let posts = 0;
  await mockPhotos(page);
  await page.route("**/api/guest-photos", (route) => {
    if (route.request().method() === "POST") {
      posts++;
      if (posts === 1) return route.fulfill({ status: 400, json: { error: "invalid_photo_type" } });
      data = withMine(data, "valid", "/test-memory-valid.webp");
      return route.fulfill({ status: 201, json: data.photos[0] });
    }
    return route.fulfill({ json: data });
  });
  await gotoTrail(page);
  await (await openPicker(page)).setFiles(file());
  await expect(page.locator("[data-photo-error]")).toContainText("yang valid");
  await expect(page.locator(BUTTON)).toHaveAccessibleName("Tambah punyamu");
  await (await openPicker(page)).setFiles(file());
  await expect(page.locator(BUTTON)).toHaveAccessibleName("Foto ditambahkan");
  expect(posts).toBe(2);
});

test("a duplicate photo response refreshes the existing photo and shows a checkmark", async ({
  page,
}) => {
  let data = payload(true);
  let posts = 0;
  await mockPhotos(page);
  await page.route("**/api/guest-photos", (route) => {
    if (route.request().method() === "POST") {
      posts++;
      data = withMine(data, "existing", "/test-memory-existing.webp");
      return route.fulfill({ status: 409, json: { error: "already_posted" } });
    }
    return route.fulfill({ json: data });
  });
  await gotoTrail(page);
  await (await openPicker(page)).setFiles(file());
  await expect(page.locator(BUTTON)).toHaveAccessibleName("Foto ditambahkan");
  await expect(page.locator('[data-photo-icon="success"]')).toBeVisible();
  await expect.poll(() => currentImages(page)).toEqual(selectTrailImages(data));
  expect(posts).toBe(1);
});

test("an expired invitation shows an inline explanation and never claims success", async ({
  page,
}) => {
  let valid = true;
  await page.route("**/api/guest-photos", (route) => {
    if (route.request().method() === "POST") {
      valid = false;
      return route.fulfill({ status: 404, json: { error: "not_found" } });
    }
    return route.fulfill({ json: payload(valid) });
  });
  await gotoTrail(page);
  await (await openPicker(page)).setFiles(file());
  await expect(page.locator("[data-photo-error]")).toContainText("tautan undanganmu");
  await expect(page.locator(BUTTON)).toBeHidden();
  await expect(page.locator("[data-photo-status]")).toBeEmpty();
  await expect(page.locator(FLOW)).toHaveCount(0);
});

test("a lost upload response reconciles ownership before any retry POST", async ({ page }) => {
  let data = payload(true);
  let posts = 0;
  let readsAfterCommit = 0;
  await mockPhotos(page);
  await page.route("**/api/guest-photos", (route) => {
    if (route.request().method() === "POST") {
      posts++;
      data = withMine(data, "lostresponse", "/test-memory-lost.webp");
      return route.abort("failed");
    }
    if (data.mineId) readsAfterCommit++;
    return route.fulfill({ json: data });
  });
  await gotoTrail(page);
  await (await openPicker(page)).setFiles(file());
  const button = page.locator(BUTTON);
  await expect(button).toHaveAccessibleName("Coba lagi");
  await button.click();
  await expect(button).toHaveAccessibleName("Foto ditambahkan");
  expect(posts).toBe(1);
  expect(readsAfterCommit).toBeGreaterThan(0);
});

test("keyboard activation opens the single native chooser directly", async ({ page }) => {
  await page.route("**/api/guest-photos", (route) => route.fulfill({ json: payload(true) }));
  await gotoTrail(page);
  await page.locator(CONTROLS).scrollIntoViewIfNeeded();
  const button = page.locator(BUTTON);
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("aria-disabled", "false");
  await expect(page.locator(CONTROLS)).toHaveAttribute("data-revealed", "");
  await expect(button.locator("[data-photo-label]")).toHaveCSS("opacity", "1");
  await button.focus();
  await expect(button).toBeFocused();
  const chooser = page.waitForEvent("filechooser");
  await button.press("Enter");
  expect((await chooser).isMultiple()).toBe(false);
});

test("a late older collection cannot replace a newer refresh or restore eligibility", async ({
  page,
}) => {
  let data = payload(true);
  let reads = 0;
  const older = deferred();
  const posted = withMine(payload(true), "latewinner", "/test-memory-late.webp");
  await mockPhotos(page);
  await page.route("**/api/guest-photos", async (route) => {
    reads++;
    if (reads === 2) {
      await older.promise;
      return route.fulfill({ json: payload(true) });
    }
    return route.fulfill({ json: data });
  });
  await gotoTrail(page);
  const invalidate = () =>
    page.evaluate(async () => {
      const url = "/src/lib/guest-photos-client.ts";
      const module = await import(/* @vite-ignore */ url);
      module.invalidateGuestPhotos();
      window.dispatchEvent(new Event("guest-photos:posted"));
    });
  try {
    await invalidate();
    await expect.poll(() => reads).toBe(2);
    data = posted;
    await invalidate();
    await expect(page.locator(BUTTON)).toHaveAccessibleName("Foto ditambahkan");
    older.resolve();
    await page.waitForTimeout(100);
    await expect(page.locator(BUTTON)).toHaveAttribute("aria-disabled", "true");
    await expect.poll(() => currentImages(page)).toEqual(selectTrailImages(posted));
  } finally {
    older.resolve();
  }
});

test("disposing controls during POST prevents late DOM changes and remount refetches", async ({
  page,
}) => {
  let data = payload(true);
  let posts = 0;
  const pending = deferred();
  await mockPhotos(page);
  await page.route("**/api/guest-photos", async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      await pending.promise;
      data = withMine(data, "disposed", "/test-memory-disposed.webp");
      return route.fulfill({ status: 201, json: data.photos[0] });
    }
    return route.fulfill({ json: data });
  });
  try {
    await gotoTrail(page);
    await (await openPicker(page)).setFiles(file());
    await expect.poll(() => posts).toBe(1);
    await page.locator(CONTROLS).evaluate((node) => {
      Object.assign(window, { detachedPhotoControls: node });
      node.remove();
    });
    const before = await page.evaluate(
      () =>
        (window as unknown as { detachedPhotoControls: HTMLElement }).detachedPhotoControls
          .innerHTML,
    );
    pending.resolve();
    await page.waitForTimeout(100);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { detachedPhotoControls: HTMLElement }).detachedPhotoControls
            .innerHTML,
      ),
    ).toBe(before);
    await page.evaluate(async () => {
      const url = "/src/lib/guest-photos-client.ts";
      const module = await import(/* @vite-ignore */ url);
      module.invalidateGuestPhotos();
      document
        .querySelector("[data-photo-trail-section]")!
        .append(
          (window as unknown as { detachedPhotoControls: HTMLElement }).detachedPhotoControls,
        );
    });
    await expect(page.locator(BUTTON)).toHaveAccessibleName("Foto ditambahkan");
    expect(posts).toBe(1);
  } finally {
    pending.resolve();
  }
});
