import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createBuiltTestServer } from "./support/server";
import { WEB_ROOT } from "./support/database";
import { dismissWelcomeGate, pinFullTier } from "./helpers";

test.setTimeout(180_000);
test.use({ viewport: { width: 393, height: 852 } });

const DIST_ENTRY = join(WEB_ROOT, "dist/server/entry.mjs");
const BUILD_LOCK = join(WEB_ROOT, "node_modules/.cache/built-spec-build-lock");

function ensureBuildFreshness() {
  if (existsSync(DIST_ENTRY)) {
    const mtime = statSync(DIST_ENTRY).mtimeMs;
    if (Date.now() - mtime < 600_000) return;
  }

  // Ensure parent directory exists for atomic mkdir lock
  mkdirSync(join(WEB_ROOT, "node_modules/.cache"), { recursive: true });

  let acquired = false;
  for (let i = 0; i < 60; i++) {
    try {
      mkdirSync(BUILD_LOCK); // Atomic: throws EEXIST if another worker is building
      acquired = true;
      break;
    } catch (err: unknown) {
      if ((err as { code?: string })?.code !== "EEXIST") throw err;
      execSync("sleep 1");
      if (existsSync(DIST_ENTRY) && Date.now() - statSync(DIST_ENTRY).mtimeMs < 600_000) {
        return;
      }
    }
  }

  try {
    if (existsSync(DIST_ENTRY) && Date.now() - statSync(DIST_ENTRY).mtimeMs < 60_000) {
      return;
    }
    execSync("pnpm --filter web build", { cwd: WEB_ROOT, stdio: "inherit" });
  } finally {
    if (acquired) {
      try {
        rmdirSync(BUILD_LOCK);
      } catch {
        /* lock already removed or cleaned */
      }
    }
  }
}

const HERO_ELEMENTS = [
  { selector: ".animate-image", keyframe: "image-scroll-effect" },
  { selector: ".animate-blur", keyframe: "blur-reveal" },
  { selector: ".animate-overlay", keyframe: "overlay-reveal" },
  { selector: ".animate-aisha", keyframe: "aisha-reveal" },
  { selector: ".animate-amp", keyframe: "amp-reveal" },
  { selector: ".animate-yofri", keyframe: "yofri-reveal" },
  { selector: ".animate-pernikahan", keyframe: "blur-reveal-pernikahan" },
  { selector: ".animate-date", keyframe: "blur-reveal-date" },
] as const;

let server: Awaited<ReturnType<typeof createBuiltTestServer>>;

test.beforeAll(async () => {
  ensureBuildFreshness();
  server = await createBuiltTestServer("hero-zoom-built");
});

test.afterAll(async () => {
  if (server) {
    await server.dispose();
  }
});

test.describe("Production built HeroZoom scroll animation", () => {
  test("static CSS bundle contains no collapsed animation shorthand with timeline name", () => {
    const astroDir = join(WEB_ROOT, "dist/client/_astro");
    const cssFiles = readdirSync(astroDir).filter((f) => f.endsWith(".css"));
    expect(cssFiles.length).toBeGreaterThan(0);

    let combinedCss = "";
    for (const file of cssFiles) {
      combinedCss += readFileSync(join(astroDir, file), "utf-8");
    }

    // Minifier safety: zero instances where animation shorthand includes --hero-progress
    const invalidShorthands = combinedCss.match(/animation:[^;{}]*--hero-progress/g) || [];
    expect(invalidShorthands).toHaveLength(0);

    // All 8 animated rules + 1 @supports declaration maintain separate animation-timeline declarations
    const timelineDeclarations = combinedCss.match(/animation-timeline:--hero-progress/g) || [];
    expect(timelineDeclarations.length).toBeGreaterThanOrEqual(8);

    // CSS custom property timing function prevents shorthand synthesis
    expect(combinedCss).toContain("var(--ease-linear");
    expect(combinedCss).toContain("var(--ease-out-zoom)");
  });

  test("all 8 hero elements have active ViewTimeline animations in supported browsers", async ({
    page,
  }) => {
    pinFullTier(page);
    await page.goto(`${server.baseUrl}/`);
    await dismissWelcomeGate(page);

    const animationStates = await page.evaluate((elements) => {
      return elements.map(({ selector, keyframe }) => {
        const el = document.querySelector(selector);
        if (!el) return { selector, keyframe, found: false };
        const cs = window.getComputedStyle(el);
        const anims = el.getAnimations ? el.getAnimations() : [];
        return {
          selector,
          keyframe,
          found: true,
          timeline: cs.animationTimeline,
          name: cs.animationName,
          opacity: parseFloat(cs.opacity),
          hasActiveAnimations: anims.length > 0,
        };
      });
    }, HERO_ELEMENTS);

    for (const state of animationStates) {
      expect(state.found).toBe(true);
      expect(state.timeline).toBe("--hero-progress");
      expect(state.name).toBe(state.keyframe);
      expect(state.hasActiveAnimations).toBe(true);
    }

    // Keyframe at 0% scroll: reveal elements start with opacity 0 (not static fallback 1)
    const blur = animationStates.find((s) => s.selector === ".animate-blur")!;
    const overlay = animationStates.find((s) => s.selector === ".animate-overlay")!;
    const aisha = animationStates.find((s) => s.selector === ".animate-aisha")!;
    const pernikahan = animationStates.find((s) => s.selector === ".animate-pernikahan")!;
    const date = animationStates.find((s) => s.selector === ".animate-date")!;

    expect(blur.opacity).toBe(0);
    expect(overlay.opacity).toBe(0);
    expect(aisha.opacity).toBe(0);
    expect(pernikahan.opacity).toBe(0);
    expect(date.opacity).toBe(0);
  });

  test("scroll scrubs progressively from scale(1.75) to scale(1) and reveals text sequentially", async ({
    page,
  }) => {
    pinFullTier(page);
    await page.goto(`${server.baseUrl}/`);
    await dismissWelcomeGate(page);

    const readStateAtScroll = async (scrollY: number) => {
      await page.evaluate((y) => window.scrollTo(0, y), scrollY);
      await page.waitForTimeout(50);
      return page.evaluate(() => {
        const getScale = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return 1;
          const t = window.getComputedStyle(el).transform;
          if (!t || t === "none") return 1;
          const m = t.match(/matrix\(([^,]+)/);
          return m ? parseFloat(m[1]) : 1;
        };
        const getOpacity = (sel: string) => {
          const el = document.querySelector(sel);
          return el ? parseFloat(window.getComputedStyle(el).opacity) : 0;
        };
        return {
          scale: getScale(".animate-image"),
          overlay: getOpacity(".animate-overlay"),
          aisha: getOpacity(".animate-aisha"),
          pernikahan: getOpacity(".animate-pernikahan"),
          date: getOpacity(".animate-date"),
        };
      });
    };

    // 0px: Stage start (scale 1.75, reveals hidden)
    const at0 = await readStateAtScroll(0);
    expect(at0.scale).toBeCloseTo(1.75, 2);
    expect(at0.overlay).toBe(0);
    expect(at0.aisha).toBe(0);
    expect(at0.pernikahan).toBe(0);
    expect(at0.date).toBe(0);

    // 400px: Mid zoom phase (0% → 28% of pinned travel); image is zooming out smoothly
    const at400 = await readStateAtScroll(400);
    expect(at400.scale).toBeLessThan(1.75);
    expect(at400.scale).toBeGreaterThan(1.0);
    expect(at400.aisha).toBe(0);
    expect(at400.pernikahan).toBe(0);

    // 800px: Zoom complete (held at scale 1), names begin revealing (Aisha 35% → 42%)
    const at800 = await readStateAtScroll(800);
    expect(at800.scale).toBeCloseTo(1.0, 2);
    expect(at800.overlay).toBeGreaterThan(0);
    expect(at800.aisha).toBeGreaterThan(0);
    expect(at800.pernikahan).toBe(0);

    // 1400px: Title lockup reveal phase (Pernikahan 53% → 66%, Date 59.5% → 72.5%)
    const at1400 = await readStateAtScroll(1400);
    expect(at1400.scale).toBeCloseTo(1.0, 2);
    expect(at1400.overlay).toBeCloseTo(0.3, 2);
    expect(at1400.aisha).toBeCloseTo(1.0, 2);
    expect(at1400.pernikahan).toBeCloseTo(1.0, 2);
    expect(at1400.date).toBeCloseTo(1.0, 2);
  });

  test("JavaScript rAF fallback drives element inline styles when view-timeline is unsupported", async ({
    page,
  }) => {
    // Stub CSS.supports to return false for scroll timeline declarations
    await page.addInitScript(() => {
      const originalSupports = CSS.supports.bind(CSS);
      CSS.supports = function (...args: unknown[]) {
        const query = args.join(" ");
        if (
          query.includes("--hero-progress") ||
          query.includes("view-timeline") ||
          query.includes("animation-timeline")
        ) {
          return false;
        }
        return (originalSupports as (...a: unknown[]) => boolean)(...args);
      };
    });

    pinFullTier(page);
    await page.goto(`${server.baseUrl}/`);
    await dismissWelcomeGate(page);

    const readFallbackState = async (scrollY: number) => {
      await page.evaluate((y) => window.scrollTo(0, y), scrollY);
      await page.waitForTimeout(50);
      return page.evaluate(() => {
        const getStyle = (sel: string) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          return {
            transform: el?.style.transform || "",
            opacity: el?.style.opacity || "",
            filter: el?.style.filter || "",
          };
        };
        return {
          img: getStyle(".animate-image"),
          blur: getStyle(".animate-blur"),
          overlay: getStyle(".animate-overlay"),
          aisha: getStyle(".animate-aisha"),
          pernikahan: getStyle(".animate-pernikahan"),
          date: getStyle(".animate-date"),
        };
      });
    };

    // 0px: JS fallback initializes inline styles
    const fallbackAt0 = await readFallbackState(0);
    expect(fallbackAt0.img.transform).toBe("scale(1.75)");
    expect(fallbackAt0.blur.opacity).toBe("0");
    expect(fallbackAt0.overlay.opacity).toBe("0");
    expect(fallbackAt0.aisha.opacity).toBe("0");
    expect(fallbackAt0.pernikahan.opacity).toBe("0");
    expect(fallbackAt0.date.opacity).toBe("0");

    // 400px: JS fallback drives image scale progressively
    const fallbackAt400 = await readFallbackState(400);
    expect(fallbackAt400.img.transform).toMatch(/^scale\(\d+\.\d+\)$/);
    const parsedScale = parseFloat(fallbackAt400.img.transform.replace(/[^\d.]/g, ""));
    expect(parsedScale).toBeLessThan(1.75);
    expect(parsedScale).toBeGreaterThan(1.0);

    // 1400px: JS fallback reaches completed reveal lockup
    const fallbackAt1400 = await readFallbackState(1400);
    expect(fallbackAt1400.img.transform).toBe("scale(1)");
    expect(fallbackAt1400.overlay.opacity).toBe("0.3");
    expect(fallbackAt1400.aisha.opacity).toBe("1");
    expect(fallbackAt1400.pernikahan.opacity).toBe("1");
    expect(fallbackAt1400.date.opacity).toBe("1");
  });
});
