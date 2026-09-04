import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

// Harness output: .artifacts/capture-scroll (gitignored — PNGs are ~5.5MB per
// run and report.json regenerates every run; evidence belongs in the commit
// message / PR, regenerate any time with `node scripts/capture-scroll.mjs`)
const OUT_DIR = path.join(process.cwd(), ".artifacts", "capture-scroll");

// ---------------------------------------------------------------------------
// Choreography constants — mirrored from apps/web/src/components/TimelineScroll.astro.
// Keep in sync with the component; a drift here makes the stop list target
// the wrong moments and the probe catches it as missing/extra reveals.
// ---------------------------------------------------------------------------
const INTRO_END = 0.0386;
const FINALE_TURN = 0.8074;
const FINALE_MID = 0.8392;
const FINALE_CORNER = 0.8681;
const VERT_END = 0.956;
const EXPANSION_START = VERT_END + 0.004;
const EXPANSION_END = 0.994;
const CONNECT_X = 80; // vw-relative offset from a dot where its connector completes

// Node-9 is centered by the pan table: PAN_END_X = -1620vw at VERT_END.
const PAN_KEYFRAMES = [
  { t: 0, x: 0, y: 0 },
  { t: INTRO_END, x: 0, y: 0 },
  { t: FINALE_TURN, x: -1470, y: 0 },
  { t: FINALE_MID, x: -1545, y: null },
  { t: FINALE_CORNER, x: -1620, y: null },
  { t: VERT_END, x: -1620, y: null },
  { t: 1, x: -1620, y: null },
];

// Progress at which the track has panned targetX (vw). Inverse of the pan table.
function progressAtPanX(targetX) {
  for (let i = 1; i < PAN_KEYFRAMES.length; i++) {
    const a = PAN_KEYFRAMES[i - 1];
    const b = PAN_KEYFRAMES[i];
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    if (targetX >= lo && targetX <= hi && b.x !== a.x) {
      return a.t + ((targetX - a.x) / (b.x - a.x)) * (b.t - a.t);
    }
  }
  return targetX <= PAN_KEYFRAMES[PAN_KEYFRAMES.length - 1].x ? 1 : 0;
}

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
  await page.waitForTimeout(300); // let the native ViewTimeline scrub settle
}

// Where is the WAAPI track now? Reads the LIVE native scroll-driven animations —
// no synthetic frame shim, no frozen-anim cancellation. Chromium (and Safari)
// drive motion's WAAPI tracks natively via ScrollTimeline, so computed styles
// ARE the truth at rest.
function liveState(page, label) {
  return page.evaluate((label) => {
    const clipOf = (id) => getComputedStyle(document.getElementById(id)).clipPath;
    const clipRadius = (id) => {
      const m = clipOf(id).match(/circle\(([\d.]+)px/);
      return m ? Number(m[1]) : null;
    };
    const visible = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        opacity: Number(cs.opacity),
        inViewport: r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight,
      };
    };
    return {
      label,
      f: +(
        -document.getElementById("timeline-section").getBoundingClientRect().top /
        (document.getElementById("timeline-section").offsetHeight - innerHeight)
      ).toFixed(4),
      overlayClip: clipRadius("timeline-circle-overlay"),
      expansionClip: clipRadius("timeline-circle-expansion"),
      node1: visible("#node-1"),
      trackX: (() => {
        const t = document.getElementById("timeline-track");
        return t
          ? (new DOMMatrixReadOnly(getComputedStyle(t).transform).m41 / innerWidth) * 100
          : null;
      })(),
      node9X: (() => {
        const n = document.getElementById("node-9");
        return n
          ? (new DOMMatrixReadOnly(getComputedStyle(n).transform).m41 / innerWidth) * 100
          : null;
      })(),
      dot9Opacity: (() => {
        const d = document.getElementById("dot-9");
        return d ? Number(getComputedStyle(d).opacity) : null;
      })(),
    };
  }, label);
}

// Invariant: at any scroll position, content from at most ONE story node is
// on screen (previous content must have exited before the next pops).
function checkExclusivity(page, label) {
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

// Invariant: no connector path passes through any content block. On desktop
// (≥768px) this is strict. On mobile the connectors intentionally cross the
// photo cards (the SVG rides z-40 above the track, so the stroke paints over
// photos); that crossing is an accepted, recorded decision — see the
// timeline-fluid-flow-rescope change docs — so it reports as info, not a
// violation.
function checkLineClearance(page, label) {
  return page.evaluate((label) => {
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
      for (const part of ["photo", "date", "desc"]) {
        const el = document.querySelector(`[data-node${n}-${part}]`);
        if (!el) continue;
        const r = layoutRect(el);
        hulls.push({
          node: n,
          left: r.left + 6,
          right: r.right - 6,
          top: r.top + 6,
          bottom: r.bottom - 6,
        });
      }
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
    const strict = window.innerWidth >= 768;
    return { label, hits, strict, violation: strict && hits.length > 0 };
  }, label);
}

// Derive the connect(N) fractions from the LIVE measured dots + pan table, so
// the stop list tracks the authored geometry instead of hard-coding last
// year's numbers (the old harness silently captured the wrong moments).
async function deriveStops(page) {
  return page
    .evaluate((CONNECT_X) => {
      const dots = [];
      for (let n = 1; n <= 8; n++) {
        const d = document.getElementById(`dot-${n}`);
        if (!d) throw new Error(`#dot-${n} missing`);
        const r = d.getBoundingClientRect();
        dots.push(((r.left + r.width / 2) / innerWidth) * 100);
      }
      const dot9 = document.getElementById("dot-9-anchor");
      const r9 = dot9.getBoundingClientRect();
      dots.push(((r9.left + r9.width / 2) / innerWidth) * 100);
      return dots;
    }, CONNECT_X)
    .then((dotsVw) => {
      // connect(N): the pan at which dot N sits CONNECT_X from the viewport's
      // left edge — i.e. track pan = -(dotXvw - CONNECT_X).
      const connect = (n) => progressAtPanX(-(dotsVw[n - 1] - CONNECT_X));
      const stops = [
        { name: "00-section-top", at: 0 },
        { name: "01-intro-mid", at: INTRO_END / 2 },
        { name: "02-intro-end", at: INTRO_END },
        { name: "03-node2-connect", at: connect(2) },
        { name: "04-node2-popped", at: connect(2) + 0.02 },
        { name: "05-node3-connect", at: connect(3) },
        { name: "06-node3-popped", at: connect(3) + 0.02 },
        { name: "07-node4-connect", at: connect(4) },
        { name: "08-node4-popped", at: connect(4) + 0.02 },
        { name: "09-node5-connect", at: connect(5) },
        { name: "10-node5-popped", at: connect(5) + 0.02 },
        { name: "11-node6-connect", at: connect(6) },
        { name: "12-node6-popped", at: connect(6) + 0.02 },
        { name: "13-node7-connect", at: connect(7) },
        { name: "14-node7-popped", at: connect(7) + 0.02 },
        { name: "15-node8-connect", at: connect(8) },
        { name: "16-node8-content", at: progressAtPanX(-1520) }, // node 8's card centered
        { name: "17-node8-popped", at: connect(8) + 0.02 },
        { name: "18-horiz-end", at: FINALE_TURN },
        { name: "19-vertical-mid", at: FINALE_MID },
        { name: "20-node9-arrive", at: FINALE_CORNER },
        { name: "21-node9-formed", at: FINALE_CORNER + 0.038 },
        { name: "22-vert-end", at: VERT_END },
        { name: "23-expansion-start", at: EXPANSION_START },
        { name: "24-expansion-half", at: (EXPANSION_START + EXPANSION_END) / 2 },
        { name: "25-expansion-end", at: EXPANSION_END },
        { name: "26-end", at: 1 },
      ];
      return { stops, connect };
    });
}

async function captureProgressStops(browser, url, width, report) {
  const height = width < 768 ? 800 : 900;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
  // The hero/gate may lock page scroll; sticky positioning needs it unlocked.
  await page.evaluate(() => {
    document.documentElement.style.overflow = "visible";
    document.body.style.overflow = "visible";
  });
  // Dismiss loader/gate when present so screenshots show the timeline, not the
  // entry overlays. (DOM-state probes are overlay-independent either way.)
  await page
    .locator("#welcome-gate")
    .first()
    .click({ force: true })
    .catch(() => {});
  await page.waitForTimeout(400);

  const geom = await sectionGeometry(page);
  const { stops } = await deriveStops(page);

  // Warm-up pass: walk every stop so lazy images hydrate and decode once.
  for (const stop of stops) await scrollToProgress(page, geom, stop.at);

  for (const stop of stops) {
    await scrollToProgress(page, geom, stop.at);
    report.frames.push(await liveState(page, `${width}/${stop.name}`));
    const check = await checkExclusivity(page, `${width}/${stop.name}`);
    report.exclusivity.push(check);
    if (check.violation) report.violations.push(check);
    const clearance = await checkLineClearance(page, `${width}/${stop.name}`);
    report.lineClearance.push(clearance);
    if (clearance.violation) report.violations.push(clearance);
    await page.screenshot({ path: path.join(OUT_DIR, `local-${width}-${stop.name}.png`) });
  }

  // Node-9 hand-off probe: at VERT_END the track and node-9 must agree (the
  // counter-pan keeps dot-9 on the expansion-circle center), and the finale
  // dot must be fully formed before the expansion starts growing.
  await scrollToProgress(page, geom, VERT_END);
  const handoff = await page.evaluate(() => {
    const m = (id) =>
      new DOMMatrixReadOnly(getComputedStyle(document.getElementById(id)).transform);
    const track = m("timeline-track");
    const node9 = m("node-9");
    const dot9 = document.getElementById("dot-9").getBoundingClientRect();
    return {
      trackVw: (track.m41 / innerWidth) * 100,
      node9Vw: (node9.m41 / innerWidth) * 100,
      dot9CenterX: dot9.left + dot9.width / 2,
      viewportCenterX: innerWidth / 2,
      dot9Opacity: Number(getComputedStyle(document.getElementById("dot-9")).opacity),
    };
  });
  const entry = {
    label: `${width}/node9-handoff`,
    ...handoff,
    centerErrorPx: Math.round(Math.abs(handoff.dot9CenterX - handoff.viewportCenterX)),
  };
  report.pins.push(entry);
  if (entry.centerErrorPx > 2 || entry.dot9Opacity < 0.99) report.violations.push(entry);

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
    await page
      .locator("#welcome-gate")
      .first()
      .click({ force: true })
      .catch(() => {});
    await page.waitForTimeout(400);

    const audit = await page.evaluate(() => {
      const section = document.getElementById("timeline-section");
      const titleBottom = document.getElementById("title-layer-bottom");
      const finale = document.querySelector("[data-node9-date-bottom]");
      const blocks = Array.from(
        document.querySelectorAll(
          "[data-node2-photo],[data-node3-photo],[data-node4-photo],[data-node5-photo],[data-node6-photo],[data-node7-photo],[data-node8-photo],[data-node9-date-bottom]",
        ),
      );
      const inFlow = (el) => getComputedStyle(el).position === "static";
      // Probe the H2's own rect, not the container's: the container can be an
      // empty padded box while the escaped h2 paints over the previous section
      // (exactly the regression the old container-only probe sailed past).
      const introHeading = titleBottom?.querySelector("h2");
      const introHeadingRect = introHeading?.getBoundingClientRect();
      const firstNode = document
        .querySelector("#timeline-track > .timeline-node")
        .getBoundingClientRect();
      return {
        sectionHeight: section.offsetHeight,
        viewport: window.innerHeight,
        // The overlays/SVG must actually be display:none under reduced motion —
        // a merged-away selector group once left a 64px opaque slab in the story.
        overlaysHidden:
          getComputedStyle(document.querySelector("#timeline-track > svg")).display === "none" &&
          getComputedStyle(document.getElementById("timeline-circle-overlay")).display === "none" &&
          getComputedStyle(document.getElementById("timeline-circle-expansion")).display === "none",
        overlaysZeroHeight:
          document.querySelector("#timeline-track > svg").getBoundingClientRect().height === 0 &&
          document.getElementById("timeline-circle-overlay").getBoundingClientRect().height === 0 &&
          document.getElementById("timeline-circle-expansion").getBoundingClientRect().height === 0,
        introHeadingInFlow: !introHeading || inFlow(introHeading),
        introHeadingOnTop: introHeadingRect ? introHeadingRect.bottom <= firstNode.top + 4 : null,
        introHeadingVisibleInStory:
          introHeadingRect && introHeadingRect.top >= section.getBoundingClientRect().top - 4,
        introHeadingHasTextPixels: introHeading
          ? introHeading.scrollWidth > 0 && introHeading.scrollHeight > 0
          : null,
        finaleTitle: finale
          ? (() => {
              const r = finale.getBoundingClientRect();
              return {
                visible: Number(getComputedStyle(finale).opacity) === 1,
                centered: r.left >= -2 && r.right <= innerWidth + 2,
                afterNode8:
                  r.top >=
                  document.querySelector("[data-node8-photo]").getBoundingClientRect().bottom,
              };
            })()
          : null,
        allPhotosVisible: blocks.every((b) => parseFloat(getComputedStyle(b).opacity) === 1),
        wrappersStatic: Array.from(
          document.querySelectorAll("[data-node3-pin],[data-node5-pin],[data-node7-pin]"),
        ).every((w) => getComputedStyle(w).position === "static"),
      };
    });
    report.reducedMotion.push({ width, ...audit });
    const finaleOk =
      audit.finaleTitle?.visible && audit.finaleTitle?.centered && audit.finaleTitle?.afterNode8;
    if (
      // Content-driven height, not the ~18×-viewport scrub runway. 6× leaves
      // room for the desktop story's taller photos (measured ≈4.2×) while
      // still catching an un-reflowed runway instantly.
      audit.sectionHeight > audit.viewport * 6 ||
      !audit.overlaysHidden ||
      !audit.overlaysZeroHeight ||
      !audit.wrappersStatic ||
      !audit.allPhotosVisible ||
      !audit.introHeadingInFlow ||
      !audit.introHeadingOnTop ||
      !audit.introHeadingVisibleInStory ||
      !audit.introHeadingHasTextPixels ||
      !finaleOk
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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  const report = {
    frames: [],
    exclusivity: [],
    lineClearance: [],
    pins: [],
    reducedMotion: [],
    violations: [],
  };

  // The homepage (not /timeline-test): the bare test page has no Layout/global
  // CSS, so the Tailwind positioning classes the choreography relies on do not
  // exist there and every probe reads garbage. Run against the real page and
  // dismiss the entry gate instead.
  const url = process.env.TIMELINE_URL || "http://localhost:4321/";
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
    `\nNo violations. ${report.exclusivity.length} exclusivity checks, ${report.lineClearance.length} line-clearance checks, ${report.pins.length} hand-off probes passed.`,
  );
  console.log(`Report: ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
