import { expect, test, type Page } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

const PHOTO = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");
const sources = (count: number) =>
  Array.from({ length: count }, (_, index) => `/trail-spawn/${index}.webp`);

type Draw = { source: string; time: number; alpha: number; lane: number };
type ProbeWindow = Window & { trailDraws: Draw[] };
type TrailElement = HTMLElement & {
  setImages(images: string[], priority?: string[]): Promise<string[]>;
};

async function prepare(page: Page) {
  let collectionReads = 0;
  await page.route("**/api/guest-photos", (route) => {
    collectionReads++;
    return route.fulfill({ json: { mineId: null, inviteValid: false, photos: [] } });
  });
  await page.route("**/trail-spawn/*.webp", (route) =>
    route.fulfill({ contentType: "image/webp", body: PHOTO }),
  );
  await page.addInitScript(() => {
    const draws: Draw[] = [];
    Object.assign(window, { trailDraws: draws });
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (
      image: CanvasImageSource,
      ...args: number[]
    ) {
      if (this.canvas.closest("[data-spawn-probe]") && image instanceof HTMLImageElement) {
        // The original paths encode their lane in y + slope*x. Recover it from
        // the canvas transform instead of exposing private animation state.
        const width = this.canvas.clientWidth;
        const fit = width / 390;
        const matrix = this.getTransform();
        const dpr = Math.min(devicePixelRatio || 1, 2);
        const x = (matrix.e / dpr - width / 2) / fit;
        const y = (matrix.f / dpr - this.canvas.clientHeight / 2) / fit;
        const lanes = [
          0, -30, 30, -60, 60, -94, 94, -122, 122, -18, 18, -52, 52, -78, 78, -134, 134, 10,
        ];
        let lane = 0;
        let error = Infinity;
        lanes.forEach((offset, index) => {
          const spread = Math.sqrt(250 * 250 - offset * offset) * 0.74;
          const distance = Math.abs(y - (offset - (x / spread) * 37.5 - 15));
          if (distance < error) {
            lane = index;
            error = distance;
          }
        });
        draws.push({
          source: new URL(image.src).pathname,
          time: performance.now(),
          alpha: this.globalAlpha,
          lane,
        });
      }
      Reflect.apply(original, this, [image, ...args]);
    };
  });
  await page.goto("/");
  await dismissWelcomeGate(page);
  await page.evaluate(() => customElements.whenDefined("magnetic-image-trail"));
  await expect.poll(() => collectionReads).toBeGreaterThan(0);
}

async function mount(page: Page, images: string[]) {
  // Mount the real custom element with controlled images, independent of the
  // homepage's async photo refresh. Preserve Astro's scoped CSS attrs.
  await page.evaluate((images) => {
    const original = document.querySelector<HTMLElement>("[data-trail]")!;
    const probe = original.cloneNode(true) as HTMLElement;
    probe.dataset.spawnProbe = "";
    probe.querySelector("[data-trail-images]")!.textContent = JSON.stringify(images);
    // A deterministic random seed makes animation assertions reproducible.
    const random = Math.random;
    let seed = 736;
    Math.random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    original.replaceWith(probe);
    Math.random = random;
    probe.scrollIntoView({ block: "center", behavior: "instant" });
  }, images);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as ProbeWindow).trailDraws.length))
    .toBeGreaterThan(0);
}

async function snapshot(page: Page) {
  return page.evaluate(() => (window as unknown as ProbeWindow).trailDraws);
}

test.setTimeout(60_000);

test("photos enter on different frames, then rotate through all uploads in different lanes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await prepare(page);
  const images = sources(42);
  await mount(page, images);
  await expect
    .poll(async () => new Set((await snapshot(page)).map((draw) => draw.source)).size, {
      timeout: 25_000,
    })
    .toBe(images.length);

  const draws = await snapshot(page);
  const firstDraws = [...new Map([...draws].reverse().map((draw) => [draw.source, draw])).values()]
    .sort((a, b) => a.time - b.time)
    .slice(0, 18);
  expect(firstDraws.at(-1)!.time - firstDraws[0]!.time).toBeGreaterThan(300);
  expect(new Set(firstDraws.map((draw) => Math.round(draw.time / 16))).size).toBeGreaterThan(6);
  expect(firstDraws.some((draw) => draw.alpha > 0 && draw.alpha < 0.9)).toBe(true);

  await expect
    .poll(
      async () => {
        const lanes = new Map<string, Set<number>>();
        for (const draw of await snapshot(page)) {
          const seen = lanes.get(draw.source) ?? new Set<number>();
          seen.add(draw.lane);
          lanes.set(draw.source, seen);
        }
        return [...lanes.values()].filter((seen) => seen.size > 1).length;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(8);
});

test("large galleries load only upcoming frames and stop cycling off-screen", async ({ page }) => {
  let requests = 0;
  await prepare(page);
  page.on("request", (request) => {
    if (request.url().includes("/trail-spawn/")) requests++;
  });
  await mount(page, sources(200));
  await expect.poll(() => requests).toBeGreaterThanOrEqual(18);
  expect(requests).toBeLessThanOrEqual(36);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(page.locator("[data-spawn-probe]")).not.toBeInViewport();
  // Let the IntersectionObserver's final queued frame settle before measuring.
  await page.waitForTimeout(100);
  const before = { requests, draws: (await snapshot(page)).length };
  await page.waitForTimeout(900);
  expect(requests).toBe(before.requests);
  expect((await snapshot(page)).length).toBe(before.draws);
});

test("reduced motion draws a static sample and includes a new upload without cycling", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await prepare(page);
  const images = sources(60);
  await mount(page, images);
  await expect
    .poll(async () => new Set((await snapshot(page)).map((draw) => draw.source)).size)
    .toBe(18);
  const before = (await snapshot(page)).length;
  await page.waitForTimeout(900);
  expect((await snapshot(page)).length).toBe(before);

  const added = "/trail-spawn/new.webp";
  const loaded = await page
    .locator("[data-spawn-probe]")
    .evaluate(
      (node, images) => (node as TrailElement).setImages(images, [images[0]!]),
      [added, ...images],
    );
  expect(loaded).toContain(added);
  expect((await snapshot(page)).some((draw) => draw.source === added)).toBe(true);
  const updated = (await snapshot(page)).length;
  await page.waitForTimeout(900);
  expect((await snapshot(page)).length).toBe(updated);
});

test("slow replacements stay reserved and are shown after decoding at an orbit boundary", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await prepare(page);
  await mount(page, sources(18));
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/trail-spawn/slow.webp", async (route) => {
    await waiting;
    await route.fulfill({ contentType: "image/webp", body: PHOTO });
  });
  try {
    const slow = "/trail-spawn/slow.webp";
    const request = page.waitForRequest("**/trail-spawn/slow.webp");
    // setImages awaits the decodes it schedules; the slow image is deferred,
    // so the call is fired without awaiting its result.
    await page.locator("[data-spawn-probe]").evaluate((node, source) => {
      void (node as TrailElement).setImages([source]);
    }, slow);
    await request;
    // Longer than a full orbit: the request must survive crossing its boundary.
    await page.waitForTimeout(3800);
    expect((await snapshot(page)).some((draw) => draw.source === slow)).toBe(false);
    release();
    await expect
      .poll(async () => (await snapshot(page)).some((draw) => draw.source === slow), {
        timeout: 8000,
      })
      .toBe(true);
    const first = (await snapshot(page)).find((draw) => draw.source === slow)!;
    expect(first.alpha).toBeLessThan(0.9);
  } finally {
    release();
  }
});
