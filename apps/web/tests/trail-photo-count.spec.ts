import { expect, test, type Page } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

// The trail renders exactly what GET /api/guest-photos returns. Point the
// mocked photo URLs at real public assets so no extra image routing is needed.
const ASSETS = ["/keluarga-yofri.webp", "/awal-perkenalan.webp", "/keluarga-acik.webp"];
// Lane offsets of MagneticImageTrail's 18 slots, used to detect duplication:
// with a pool no larger than the frame count each photo stays in one lane, so
// a photo drawn in two lanes means it was duplicated across frames.
const LANE_OFFSETS = [
  0, -30, 30, -60, 60, -94, 94, -122, 122, -18, 18, -52, 52, -78, 78, -134, 134, 10,
];

type Draw = { source: string; lane: number; time: number };
type ProbeWindow = Window & { trailDraws: Draw[] };

async function prepareWithPhotos(page: Page, count: number) {
  await page.route("**/api/guest-photos", (route) =>
    route.fulfill({
      json: {
        mineId: null,
        inviteValid: false,
        photos: Array.from({ length: count }, (_, index) => ({
          id: `count${index}`.padEnd(12, "0"),
          photoUrl: ASSETS[index % ASSETS.length]!,
          createdAt: index,
        })),
      },
    }),
  );
  await page.addInitScript((laneOffsets: number[]) => {
    const draws: { source: string; lane: number; time: number }[] = [];
    Object.assign(window, { trailDraws: draws });
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (
      image: CanvasImageSource,
      ...args: number[]
    ) {
      if (this.canvas.matches("[data-trail-canvas]") && image instanceof HTMLImageElement) {
        // Recover each card's lane from the canvas transform instead of
        // exposing private animation state (same technique as
        // trail-animation.spec.ts).
        const width = this.canvas.clientWidth;
        const fit = width / 390;
        const matrix = this.getTransform();
        const dpr = Math.min(devicePixelRatio || 1, 2);
        const x = (matrix.e / dpr - width / 2) / fit;
        const y = (matrix.f / dpr - this.canvas.clientHeight / 2) / fit;
        let lane = 0;
        let error = Infinity;
        laneOffsets.forEach((offset, index) => {
          const spread = Math.sqrt(250 * 250 - offset * offset) * 0.74;
          const distance = Math.abs(y - (offset - (x / spread) * 37.5 - 15));
          if (distance < error) {
            lane = index;
            error = distance;
          }
        });
        draws.push({ source: new URL(image.src).pathname, lane, time: performance.now() });
      }
      Reflect.apply(original, this, [image, ...args]);
    };
  }, LANE_OFFSETS);
  await page.goto("/");
  await dismissWelcomeGate(page);
  await page.locator("[data-trail]").scrollIntoViewIfNeeded();
}

const draws = (page: Page) => page.evaluate(() => (window as unknown as ProbeWindow).trailDraws);

for (const count of [0, 1, 2, 3]) {
  test(`a collection of ${count} photo${count === 1 ? "" : "s"} renders exactly those, once each`, async ({
    page,
  }) => {
    await prepareWithPhotos(page, count);

    if (count === 0) {
      // Nothing animates and the canvas stays fully transparent.
      await page.waitForTimeout(2500);
      expect(await draws(page)).toEqual([]);
      expect(
        await page.locator("[data-trail-canvas]").evaluate((node) => {
          const el = node as HTMLCanvasElement;
          const { width, height } = el;
          return el
            .getContext("2d")!
            .getImageData(0, 0, width, height)
            .data.some((v) => v !== 0);
        }),
      ).toBe(false);
      return;
    }

    const expected = ASSETS.slice(0, count).sort();
    await expect
      .poll(async () => [...new Set((await draws(page)).map((draw) => draw.source))].sort())
      .toEqual(expected);

    // Photos rotate dynamically across lanes, but no photo may ever be drawn
    // concurrently in multiple lanes within the same render tick.
    const allDraws = await draws(page);
    const byTick = new Map<number, string[]>();
    for (const d of allDraws) {
      const tick = Math.round(d.time / 8);
      const list = byTick.get(tick) ?? [];
      list.push(d.source);
      byTick.set(tick, list);
    }
    for (const sources of byTick.values()) {
      expect(new Set(sources).size).toBe(sources.length);
    }
    expect([...new Set(allDraws.map((d) => d.source))].sort()).toEqual(expected);
  });
}
