import { expect, test, type Page } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

// The trail renders exactly what GET /api/guest-photos returns. Point the
// mocked photo URLs at real public assets so no extra image routing is needed.
const ASSETS = ["/keluarga-yofri.webp", "/awal-perkenalan.webp", "/keluarga-acik.webp"];
// Lane offsets of MagneticImageTrail's 18 slots: used to verify that no two
// distinct photos ever collide in the same lane within any render frame.
const LANE_OFFSETS = [
  0, -30, 30, -60, 60, -94, 94, -122, 122, -18, 18, -52, 52, -78, 78, -134, 134, 10,
];

test.use({ viewport: { width: 390, height: 844 } });

type Draw = { source: string; lane: number; frame: number };
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
    const draws: { source: string; lane: number; frame: number }[] = [];
    Object.assign(window, { trailDraws: draws });
    let currentFrame = 0;
    const origClear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (
      this: CanvasRenderingContext2D,
      ...args: [number, number, number, number]
    ) {
      if (this.canvas.matches("[data-trail-canvas]")) {
        currentFrame++;
      }
      return Reflect.apply(origClear, this, args);
    };
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
        draws.push({ source: new URL(image.src).pathname, lane, frame: currentFrame });
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
    // concurrently in multiple lanes within the same render tick (frame),
    // and no two distinct photos may ever share the same lane in the same frame.
    const allDraws = await draws(page);
    const byFrame = new Map<number, Draw[]>();
    for (const d of allDraws) {
      const list = byFrame.get(d.frame) ?? [];
      list.push(d);
      byFrame.set(d.frame, list);
    }
    for (const frameDraws of byFrame.values()) {
      const sources = frameDraws.map((d) => d.source);
      expect(new Set(sources).size).toBe(sources.length);
      const lanes = frameDraws.map((d) => d.lane);
      expect(new Set(lanes).size).toBe(lanes.length);
    }
    expect([...new Set(allDraws.map((d) => d.source))].sort()).toEqual(expected);
  });
}
