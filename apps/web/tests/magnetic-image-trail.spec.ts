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
  });
}
