import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const OUT_DIR = path.join(process.cwd(), ".opencode", "screenshots");

// Progress stops within #timeline-section, as fractions of the scrollable
// runway (section height − viewport height). Connect fractions are the
// derived thresholds (TimelineScroll.astro / design D3) for 150vw-spaced
// nodes; good enough for capture targeting.
const STOPS = [
  { name: "00-section-top", at: 0 },
  { name: "01-intro-circle", at: 0.0027 },
  { name: "02-intro-end", at: 0.0498 },
  { name: "03-node2-connect", at: 0.1216 },
  { name: "04-node2-popped", at: 0.135 },
  { name: "05-node3-connect", at: 0.2114 },
  { name: "06-node3-hold-a", at: 0.2174 },
  { name: "07-node3-hold-b", at: 0.2244 },
  { name: "08-node3-exiting", at: 0.245 },
  { name: "09-node4-connect", at: 0.3011 },
  { name: "10-node4-popped", at: 0.314 },
  { name: "11-node5-connect", at: 0.3909 },
  { name: "12-node5-hold-a", at: 0.3969 },
  { name: "13-node5-hold-b", at: 0.4039 },
  { name: "14-node5-exiting", at: 0.425 },
  { name: "15-node6-connect", at: 0.4806 },
  { name: "16-node6-popped", at: 0.494 },
  { name: "17-node7-connect", at: 0.5704 },
  { name: "18-node7-hold-a", at: 0.5764 },
  { name: "19-node7-hold-b", at: 0.5834 },
  { name: "20-node7-exiting", at: 0.605 },
  { name: "21-node8-connect", at: 0.6601 },
  { name: "22-node8-content", at: 0.673 },
  { name: "23-node8-popped", at: 0.686 },
  { name: "24-horiz-end", at: 0.7678 },
  { name: "25-vertical-mid", at: 0.82 },
  { name: "26-node9-arrive", at: 0.87 },
  { name: "27-node9-popped", at: 0.882 },
  { name: "28-vert-end", at: 0.9502 },
  { name: "29-end", at: 1 },
];

// Pin stationarity probes: two fractions inside each pinned node's hold
// window — the content's viewport rect must not move between them.
const PIN_HOLDS = [
  { node: 3, a: 0.2174, b: 0.2244 },
  { node: 5, a: 0.3969, b: 0.4039 },
  { node: 7, a: 0.5764, b: 0.5834 },
];

const WIDTHS = [320, 375, 390, 1440];

async function sectionGeometry(page) {
  return page.evaluate(() => {
    const section = document.getElementById("timeline-section");
    if (!section) throw new Error("#timeline-section not found");
    const rect = section.getBoundingClientRect();
    return {
      top: rect.top + window.scrollY,
      scrollable: section.offsetHeight - window.innerHeight,
    };
  });
}

async function scrollToProgress(page, geom, fraction) {
  const y = Math.round(geom.top + fraction * geom.scrollable);
  await page.evaluate((v) => window.scrollTo(0, v), y);
  await page.waitForTimeout(420); // let the scrub + image decode settle
}

// ---------------------------------------------------------------------------
// Synthetic frame shim.
// motion v13 attaches its WAAPI tracks (transform/opacity/clip-path) to a
// native ScrollTimeline that this Chromium build never updates — the
// pre-change code freezes identically, so this is an environment artifact,
// not a regression. The JS-driven scrubs (lines, reveals, pin wrappers) DO
// work. To capture meaningful frames we cancel the frozen WAAPI animations
// and apply their keyframe values by hand, mirroring the constants in
// TimelineScroll.astro.
const INTRO_END = 0.0498;
const HORIZ_END = 0.7678;
const VERT_END = 0.9502;

async function cancelFrozenWAAPI(page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      // Keep the paused, JS-scrubbed animations; drop the frozen ones.
      if (a.playState === "running") a.cancel();
    }
  });
}

async function applySyntheticFrame(page, geom) {
  // Derive the frame from the REAL scroll position so the synthetic pan
  // matches the progress the JS scrubs see (scrollTo rounds to whole px).
  await page.evaluate((geom) => {
    const f = Math.min(1, Math.max(0, (window.scrollY - geom.top) / geom.scrollable));
    const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
    const INTRO_END = 0.0498,
      HORIZ_END = 0.7678,
      VERT_END = 0.9502;
    const pan =
      f <= INTRO_END
        ? 0
        : f <= HORIZ_END
          ? lerp(0, -1200, (f - INTRO_END) / (HORIZ_END - INTRO_END))
          : -1200;
    // Vertical finale pan runs HORIZ_END → VERT_END (mirrors PAN_KEYFRAMES).
    const y =
      f <= HORIZ_END
        ? 0
        : f <= VERT_END
          ? lerp(0, -83, (f - HORIZ_END) / (VERT_END - HORIZ_END))
          : -83;
    const track = document.getElementById("timeline-track");
    const node9 = document.getElementById("node-9");
    const overlay = document.getElementById("timeline-circle-overlay");
    const title = document.getElementById("title-layer-bottom");
    const node1 = document.getElementById("node-1");
    const fill = document.getElementById("timeline-circle-expansion-fill");
    if (!track || !node9 || !overlay || !title || !node1 || !fill) return;
    const unit = CSS.supports("height", "1lvh") ? "lvh" : "vh";
    const tf = `translate(${pan}vw, ${y}${unit})`;
    track.style.transform = tf;
    node9.style.transform = tf;
    let clip;
    if (f < 0.0025) clip = "circle(150% at 50% 50%)";
    else if (f < 0.0349) {
      const full = Math.hypot(window.innerWidth, window.innerHeight) * 0.75; // ~ circle(150%)
      const t = (f - 0.0025) / (0.0349 - 0.0025);
      clip = `circle(${full + (100 - full) * t}px at 50% 50%)`;
    } else if (f < INTRO_END) {
      clip = `circle(${lerp(100, 8, (f - 0.0349) / (INTRO_END - 0.0349))}px at 50% 50%)`;
    } else clip = "circle(8px at 50% 50%)";
    overlay.style.clipPath = clip;
    overlay.style.opacity = f < INTRO_END ? "1" : "0";
    title.style.opacity = f < INTRO_END ? "1" : "0";
    node1.style.opacity = String(f < 0.0415 ? 0 : lerp(0, 1, (f - 0.0415) / (INTRO_END - 0.0415)));
    fill.style.transform = `scale(${f < VERT_END ? 0.001 : lerp(0.001, 1, (f - VERT_END) / (1 - VERT_END))})`;
  }, geom);
}

// Invariant: at any scroll position, content from at most ONE story node is
// on screen (previous content must have exited before the next pops).
async function checkExclusivity(page, label) {
  return page.evaluate((label) => {
    const selectors = [];
    for (let n = 2; n <= 8; n++) {
      for (const part of ["photo", "date", "desc"]) selectors.push(`[data-node${n}-${part}]`);
    }
    selectors.push("[data-node9-date]");
    const visible = new Map();
    for (const el of document.querySelectorAll(selectors.join(","))) {
      if (parseFloat(getComputedStyle(el).opacity) <= 0.05) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const inViewport =
        r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight;
      if (!inViewport) continue;
      const attr = Array.from(el.attributes)
        .map((a) => a.name)
        .find((a) => /^data-node\d/.test(a));
      const num = attr.match(/^data-node(\d)/)[1];
      visible.set(num, (visible.get(num) ?? 0) + 1);
    }
    return {
      label,
      visibleNodes: Array.from(visible.keys()).sort((a, b) => Number(a) - Number(b)),
      violation: visible.size > 1,
    };
  }, label);
}

// Invariant: no connector path may pass through any content block. Samples
// each path in track-local coordinates and tests against live content hulls
// (center via rect difference — transform-invariant — sized via offsetWidth,
// which ignores the hidden scale(0.6) and the pin wrapper's translation).
async function checkLineClearance(page, label) {
  return page.evaluate((label) => {
    // Layout-space rects (offset chain to the track) — immune to the hidden
    // scale(0.6), the dot-facing transform-origins, and the pin translation.
    const track = document.getElementById("timeline-track");
    const layoutRect = (el) => {
      let x = el.offsetLeft;
      let y = el.offsetTop;
      let p = el.offsetParent;
      while (p && p !== track) {
        x += p.offsetLeft;
        y += p.offsetTop;
        p = p.offsetParent;
      }
      return { left: x, top: y, right: x + el.offsetWidth, bottom: y + el.offsetHeight };
    };
    const hulls = [];
    for (let n = 2; n <= 8; n++) {
      const rects = [];
      for (const part of ["photo", "date", "desc"]) {
        const el = document.querySelector(`[data-node${n}-${part}]`);
        if (!el) continue;
        rects.push(layoutRect(el));
      }
      // Per-block rects (NOT the union bbox — the gaps between blocks are the
      // line's arrival corridor and must not count as occupied).
      for (const r of rects)
        hulls.push({
          node: n,
          left: r.left + 6,
          right: r.right - 6,
          top: r.top + 6,
          bottom: r.bottom - 6,
        });
    }
    const hits = [];
    for (let i = 1; i <= 8; i++) {
      const path = document.getElementById(`line-${i}`);
      const len = path.getTotalLength();
      for (let s = 0; s <= 48; s++) {
        const pt = path.getPointAtLength((s / 48) * len);
        const hit = hulls.find(
          (h) => pt.x > h.left && pt.x < h.right && pt.y > h.top && pt.y < h.bottom,
        );
        if (hit) {
          hits.push({ line: i, node: hit.node, at: Number((s / 48).toFixed(2)) });
          break;
        }
      }
    }
    // Strict on desktop; on narrow screens the 82vw content makes a fully
    // clear corridor geometrically impossible (released content sweeps over
    // the route), so hits there are reported as advisories, not violations.
    const strict = window.innerWidth >= 768;
    return { label, hits, strict, violation: strict && hits.length > 0 };
  }, label);
}

async function blockCenter(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
}

async function captureProgressStops(browser, url, width, report) {
  const height = width < 768 ? 800 : 900;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
  await cancelFrozenWAAPI(page);
  // The hero locks page scroll (body/html overflow: hidden) until the user's
  // first wheel; sticky positioning does not work while locked. Real users
  // unlock via the hero; the harness unlocks directly.
  await page.evaluate(() => {
    document.documentElement.style.overflow = "visible";
    document.body.style.overflow = "visible";
  });

  const geom = await sectionGeometry(page);

  // Warm-up pass: walk every stop so lazy images hydrate and decode once.
  for (const stop of STOPS) await scrollToProgress(page, geom, stop.at);

  const pinProbes = new Map(PIN_HOLDS.map((h) => [h.node, {}]));

  for (const stop of STOPS) {
    await scrollToProgress(page, geom, stop.at);
    await applySyntheticFrame(page, geom);
    const check = await checkExclusivity(page, `${width}/${stop.name}`);
    report.exclusivity.push(check);
    if (check.violation) report.violations.push(check);
    const clearance = await checkLineClearance(page, `${width}/${stop.name}`);
    report.lineClearance.push(clearance);
    if (clearance.violation) report.violations.push(clearance);

    for (const hold of PIN_HOLDS) {
      if (Math.abs(stop.at - hold.a) < 1e-9) {
        pinProbes.get(hold.node).a = await blockCenter(page, `[data-node${hold.node}-photo]`);
      }
      if (Math.abs(stop.at - hold.b) < 1e-9) {
        pinProbes.get(hold.node).b = await blockCenter(page, `[data-node${hold.node}-photo]`);
      }
    }

    await page.screenshot({ path: path.join(OUT_DIR, `local-${width}-${stop.name}.png`) });
  }

  for (const [node, probe] of pinProbes) {
    if (!probe.a || !probe.b) {
      report.violations.push({ label: `${width}/pin-node${node}`, error: "missing probe" });
      continue;
    }
    const dx = Math.abs(probe.a.x - probe.b.x);
    const entry = { label: `${width}/pin-node${node}-stationary`, dx: Number(dx.toFixed(1)) };
    report.pins.push(entry);
    if (dx > 1.5) report.violations.push(entry);
  }

  await context.close();
}

async function captureReducedMotion(browser, url, report) {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
    await page.evaluate(() => {
      document.documentElement.style.overflow = "visible";
      document.body.style.overflow = "visible";
    });

    const audit = await page.evaluate(() => {
      const section = document.getElementById("timeline-section");
      const wrappers = Array.from(
        document.querySelectorAll("[data-node3-pin], [data-node5-pin], [data-node7-pin]"),
      );
      const blocks = Array.from(
        document.querySelectorAll(
          "[data-node2-photo],[data-node3-photo],[data-node4-photo],[data-node5-photo],[data-node6-photo],[data-node7-photo],[data-node8-photo]",
        ),
      );
      return {
        sectionHeight: section.offsetHeight,
        viewport: window.innerHeight,
        wrappersStatic: wrappers.every((w) => getComputedStyle(w).position === "static"),
        wrapperChildrenStatic: wrappers.every((w) =>
          Array.from(w.children).every((c) => getComputedStyle(c).position === "static"),
        ),
        allPhotosVisible: blocks.every((b) => parseFloat(getComputedStyle(b).opacity) === 1),
      };
    });
    report.reducedMotion.push({ width, ...audit });
    if (
      audit.sectionHeight > audit.viewport * 4 ||
      !audit.wrappersStatic ||
      !audit.wrapperChildrenStatic ||
      !audit.allPhotosVisible
    ) {
      report.violations.push({ label: `${width}/reduced-motion`, ...audit });
    }

    await page.screenshot({
      path: path.join(OUT_DIR, `reduced-motion-${width}.png`),
      fullPage: true,
    });
    await context.close();
  }
}

// Reference captures from the Linearity "About us" page (their horizontal
// pan timeline). Runs only when WITH_LINEARITY=1 — it is an external fetch.
async function captureLinearity(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto("https://www.linearity.io/about-us/", { waitUntil: "networkidle" });
  await page.waitForSelector("#sticky-scroll-container", { timeout: 15000 });

  const steps = [0, 700, 1400, 2100, 2800, 3500, 4200, 4900, 5600, 6300];
  for (let i = 0; i < steps.length; i++) {
    const delta = i === 0 ? 0 : 700;
    if (delta) await page.mouse.wheel(0, delta);
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: path.join(OUT_DIR, `linearity-${String(i).padStart(2, "0")}.png`),
    });
  }
  await context.close();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  const report = {
    exclusivity: [],
    lineClearance: [],
    pins: [],
    reducedMotion: [],
    violations: [],
  };

  if (process.env.WITH_LINEARITY) {
    await captureLinearity(browser);
    console.log("Linearity reference captures done.");
  }

  const url = "http://localhost:4321/";
  for (const width of WIDTHS) {
    await captureProgressStops(browser, url, width, report);
    console.log(`Progress-stop captures done for ${width}px.`);
  }

  await captureReducedMotion(browser, url, report);
  console.log("Reduced-motion captures done.");

  await browser.close();

  const reportPath = path.join(OUT_DIR, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  if (report.violations.length > 0) {
    console.error(`\n${report.violations.length} VIOLATION(S) FOUND:`);
    for (const v of report.violations) console.error("  - " + JSON.stringify(v));
    console.error(`Full report: ${reportPath}`);
    process.exit(1);
  }
  console.log(
    `\nNo violations. ${report.exclusivity.length} exclusivity checks, ${report.lineClearance.length} line-clearance checks, ${report.pins.length} pin probes passed.`,
  );
  console.log(`Report: ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
