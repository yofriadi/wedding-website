import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { dismissWelcomeGate } from "./helpers";

test.setTimeout(90_000);

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test.describe(`magnetic image trail — ${reducedMotion}`, () => {
    test("fills a full-width square on desktop and after resizing to mobile", async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      // The trail shows exactly what the collection returns: 18 photos fill
      // every card position. Starters are no longer a default fallback.
      const filler = await sharp({
        create: { width: 220, height: 180, channels: 3, background: "#a87963" },
      })
        .png()
        .toBuffer();
      await page.route("**/api/photos/trail-fill-*", (route) =>
        route.fulfill({ contentType: "image/png", body: filler }),
      );
      await page.route("**/api/guest-photos", (route) =>
        route.fulfill({
          json: {
            mineId: null,
            inviteValid: false,
            photos: Array.from({ length: 18 }, (_, index) => ({
              id: String(index).padStart(12, "0"),
              photoUrl: `/api/photos/trail-fill-${index}`,
              createdAt: index,
            })),
          },
        }),
      );
      await page.goto("/");
      await dismissWelcomeGate(page);

      const trail = page.locator("[data-trail]");
      const box = trail.locator(".magnetic-trail__box");
      const canvas = trail.locator("[data-trail-canvas]");

      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 375, height: 812 },
      ]) {
        await page.setViewportSize(viewport);
        await trail.scrollIntoViewIfNeeded();

        const rect = await box.boundingBox();
        expect(rect).not.toBeNull();
        expect(rect!.x).toBe(0);
        expect(rect!.width).toBe(viewport.width);
        expect(rect!.height).toBe(rect!.width);

        await expect
          .poll(() =>
            canvas.evaluate((node) => {
              const el = node as HTMLCanvasElement;
              const dpr = Math.min(window.devicePixelRatio || 1, 2);
              return (
                el.width === Math.round(el.clientWidth * dpr) &&
                el.height === Math.round(el.clientHeight * dpr)
              );
            }),
          )
          .toBe(true);

        // Measure opaque photo pixels, not the full-width transparent canvas.
        // The old 520-unit drawing area only filled 61–71% of its width.
        await expect
          .poll(() =>
            canvas.evaluate((node) => {
              const el = node as HTMLCanvasElement;
              const { width, height } = el;
              const pixels = el.getContext("2d")!.getImageData(0, 0, width, height).data;
              let left = width;
              let right = -1;
              for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                  if (pixels[(y * width + x) * 4 + 3] < 128) continue;
                  left = Math.min(left, x);
                  right = Math.max(right, x);
                }
              }
              return (right - left + 1) / width;
            }),
          )
          .toBeGreaterThan(0.8);
      }
    });

    test("draws portrait, landscape and square photos at their natural aspect ratios", async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion });
      const fixtures = [
        { name: "portrait", width: 100, height: 200 },
        { name: "landscape", width: 300, height: 100 },
        { name: "square", width: 100, height: 100 },
      ];
      for (const fixture of fixtures) {
        const image = await sharp({
          create: {
            width: fixture.width,
            height: fixture.height,
            channels: 3,
            background: "#a87963",
          },
        })
          .png()
          .toBuffer();
        await page.route(`**/trail-ratio/${fixture.name}.png`, (route) =>
          route.fulfill({ contentType: "image/png", body: image }),
        );
      }
      await page.route("**/api/guest-photos", (route) =>
        route.fulfill({
          json: {
            mineId: null,
            inviteValid: false,
            photos: fixtures.map((fixture, index) => ({
              id: String(index).padStart(12, "0"),
              photoUrl: `/trail-ratio/${fixture.name}.png`,
              createdAt: index,
            })),
          },
        }),
      );
      await page.addInitScript(() => {
        const draws: Record<string, { argumentCount: number; ratio: number }> = {};
        Object.assign(window, { trailRatioDraws: draws });
        const original = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (
          image: CanvasImageSource,
          ...args: number[]
        ) {
          if (
            this.canvas.matches("[data-trail-canvas]") &&
            image instanceof HTMLImageElement &&
            image.src.includes("/trail-ratio/")
          ) {
            const name = image.src.split("/").pop()!;
            draws[name] = { argumentCount: args.length, ratio: args.at(-2)! / args.at(-1)! };
          }
          Reflect.apply(original, this, [image, ...args]);
        };
      });
      await page.goto("/");
      await dismissWelcomeGate(page);
      await page.locator("[data-trail]").scrollIntoViewIfNeeded();

      await expect
        .poll(() =>
          page.evaluate(
            () =>
              Object.keys((window as unknown as { trailRatioDraws: object }).trailRatioDraws)
                .length,
          ),
        )
        .toBe(3);
      const draws = await page.evaluate(
        () =>
          (
            window as unknown as {
              trailRatioDraws: Record<string, { argumentCount: number; ratio: number }>;
            }
          ).trailRatioDraws,
      );
      for (const fixture of fixtures) {
        const draw = draws[`${fixture.name}.png`]!;
        expect(draw.argumentCount).toBe(4); // Full image, no source crop rectangle.
        expect(draw.ratio).toBeCloseTo(fixture.width / fixture.height, 6);
      }
    });

    test("displays default placeholder when no photos are uploaded, and hides it when photos exist", async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await page.route("**/api/guest-photos", (route) =>
        route.fulfill({
          json: {
            mineId: null,
            inviteValid: false,
            photos: [],
          },
        }),
      );
      await page.goto("/");
      await dismissWelcomeGate(page);

      const trail = page.locator("[data-trail]");
      const placeholder = trail.locator("[data-trail-placeholder]");
      await trail.scrollIntoViewIfNeeded();

      await expect(trail).toHaveAttribute("data-empty", "true");
      await expect(placeholder).toBeVisible();
      await expect(placeholder.locator(".magnetic-trail__placeholder-title")).toHaveText(
        "Belum ada foto yang dibagikan",
      );
      await expect(placeholder.locator(".magnetic-trail__placeholder-desc")).toContainText(
        "Jadilah yang pertama mengabadikan dan membagikan momen bahagia ini bersama kami.",
      );

      // Canvas remains transparent with 0 photos
      const canvas = trail.locator("[data-trail-canvas]");
      expect(
        await canvas.evaluate((node) => {
          const el = node as HTMLCanvasElement;
          const { width, height } = el;
          return el
            .getContext("2d")!
            .getImageData(0, 0, width, height)
            .data.some((v) => v !== 0);
        }),
      ).toBe(false);

      // Now supply photos via setImages on the custom element
      const filler = await sharp({
        create: { width: 100, height: 100, channels: 3, background: "#a87963" },
      })
        .png()
        .toBuffer();
      await page.route("**/trail-dyn-*.png", (route) =>
        route.fulfill({ contentType: "image/png", body: filler }),
      );

      await page.evaluate(async () => {
        const el = document.querySelector<
          HTMLElement & { setImages(imgs: string[]): Promise<string[]> }
        >("[data-trail]");
        await el?.setImages(["/trail-dyn-1.png"]);
      });

      await expect(trail).toHaveAttribute("data-empty", "false");
      await expect(placeholder).toBeHidden();
    });

    test("clicking placeholder delegates to add-image button when actionable", async ({
      page,
      context,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await context.addCookies([
        { name: "ww_invite_id", value: "ValidInv1", domain: "localhost", path: "/" },
      ]);
      await page.route("**/api/guest-photos", (route) =>
        route.fulfill({
          json: {
            mineId: null,
            inviteValid: true,
            photos: [],
          },
        }),
      );
      await page.route("**/api/invite/me", (route) =>
        route.fulfill({
          json: {
            kind: "individual",
          },
        }),
      );
      await page.goto("/");
      await dismissWelcomeGate(page);

      const trail = page.locator("[data-trail]");
      const placeholder = trail.locator("[data-trail-placeholder]");
      await trail.scrollIntoViewIfNeeded();

      const addBtn = page.locator("[data-add-image]");
      await expect(addBtn).toBeVisible();

      let clicked = false;
      await page.exposeFunction("__onAddClick", () => {
        clicked = true;
      });
      await page.evaluate(() => {
        document.querySelector("[data-add-image]")?.addEventListener("click", () => {
          (window as unknown as { __onAddClick(): void }).__onAddClick();
        });
      });

      await placeholder.click();
      expect(clicked).toBe(true);
    });
  });
}
