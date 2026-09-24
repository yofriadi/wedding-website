/**
 * Tier-verdict harness (adaptive-media-tiering tasks 7.11, 9.15, 10.1).
 *
 * Runs Layout.astro's inline head script against synthetic resource-timing
 * profiles in Node — no browser, no network — and asserts the verdict each
 * stage of the ladder produces:
 *
 *   1. the buffered PerformanceObserver delivery (judge at the 48 KB floor),
 *   2. the window `load` handler (judge at the 8 KB floor + the Option-A
 *      locality branch),
 *   3. the 7 s failsafe.
 *
 * The script source is extracted from the component at run time, so a change
 * to the ladder that is not mirrored here fails the harness.
 *
 *   pnpm --filter web run test:tier-harness
 *
 * Entry classes (the vocabulary the profiles are built from):
 *   - cold asset:      real payload (transferSize ≈ encodedBodySize > 0)
 *   - 304 revalidation: headers only — transferSize ≈ 300, body sizes 0
 *     (measured on Chromium in this repo; WebKit reported, not reproduced —
 *     see the readBurst comment in Layout.astro)
 *   - memory-cache hit: transferSize 0, encodedBodySize 0, decodedBodySize > 0
 *   - opaque:           0/0/0, contributes nothing to either count
 *   - programmatic:     initiatorType fetch/xhr — excluded before both counts
 */
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LAYOUT = join(HERE, "..", "src", "layouts", "Layout.astro");

const source = readFileSync(LAYOUT, "utf8");
const head = source.match(/<script is:inline>([\s\S]*?)<\/script>/);
if (!head) throw new Error("Inline head script not found in Layout.astro");
const HEAD_SCRIPT = head[1];

const KB = 1024;

// Entry factories -----------------------------------------------------------

let seq = 0;
function asset({
  initiatorType = "img",
  startTime = 100,
  duration = 100,
  transferSize = 10 * KB,
  encodedBodySize = transferSize,
  decodedBodySize = encodedBodySize,
} = {}) {
  seq += 1;
  return {
    name: `/asset-${seq}`,
    initiatorType,
    startTime,
    responseEnd: startTime + duration,
    transferSize,
    encodedBodySize,
    decodedBodySize,
  };
}

const REVALIDATION = { transferSize: 300, encodedBodySize: 0, decodedBodySize: 0 };
const MEM_HIT = { transferSize: 0, encodedBodySize: 0, decodedBodySize: 4 * KB };

function revalidations(count, startAt = 100, step = 50) {
  return Array.from({ length: count }, (_, i) =>
    asset({ startTime: startAt + i * step, duration: 40, ...REVALIDATION }),
  );
}

function memHits(count, startAt = 120, step = 50) {
  return Array.from({ length: count }, (_, i) =>
    asset({ startTime: startAt + i * step, duration: 10, ...MEM_HIT }),
  );
}

function xhr(count, bytes = 2 * KB) {
  return Array.from({ length: count }, (_, i) =>
    asset({ initiatorType: "fetch", startTime: 1200 + i * 60, duration: 30, transferSize: bytes }),
  );
}

/** An engine without Resource Timing sizes: all fields absent. */
function unsized(count) {
  return Array.from({ length: count }, (_, i) => {
    const e = asset({ startTime: 150 + i * 50 });
    delete e.transferSize;
    delete e.encodedBodySize;
    delete e.decodedBodySize;
    return e;
  });
}

const CONN_FULL = { saveData: false, effectiveType: "4g", downlink: 10 };

// Profile runner ------------------------------------------------------------

function runProfile({ entries, conn }) {
  let tier = null;
  const events = [];
  const listeners = {};
  let failSafe = null;
  let observerCb = null;

  const rootElement = {
    getAttribute: () => tier,
    setAttribute: (_name, value) => {
      tier = value;
    },
  };
  const windowObj = {
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    dispatchEvent(event) {
      if (event?.type === "net-tier:change") events.push(event.detail);
      return true;
    },
  };
  class PerformanceObserver {
    constructor(cb) {
      observerCb = () => cb();
    }
    observe() {}
    disconnect() {}
  }
  class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  }

  const sandbox = {
    document: { documentElement: rootElement },
    navigator: { connection: conn },
    window: windowObj,
    performance: {
      getEntriesByType: (type) => (type === "resource" ? entries : []),
      setResourceTimingBufferSize() {},
      now: () => 0,
    },
    PerformanceObserver,
    CustomEvent,
    setTimeout: (fn, ms) => {
      failSafe = { fn, ms };
      return 0;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(HEAD_SCRIPT, sandbox, { filename: "head-script.js" });

  const atParse = tier;
  observerCb?.(); // buffered delivery
  const afterObserver = tier;
  for (const fn of listeners.load ?? []) fn();
  const afterLoad = tier;
  if (failSafe) failSafe.fn();
  const afterFailsafe = tier;

  return { atParse, afterObserver, afterLoad, afterFailsafe, events };
}

// Profiles ------------------------------------------------------------------

const profiles = [
  // --- Option A resolution (pending → full on locality evidence) ---
  {
    name: "pending: 23 revalidations, no payload → full at load",
    entries: [...revalidations(23)],
    expect: { atParse: "pending", afterLoad: "full" },
  },
  {
    name: "pending: memory-cache hits → full at load",
    entries: [...memHits(19), ...revalidations(5)],
    expect: { atParse: "pending", afterLoad: "full" },
  },
  {
    name: "pending: partial eviction, 4 KB payload under the load floor → full at load (locality, not measurement)",
    entries: [
      ...revalidations(10),
      asset({ startTime: 500, duration: 2000, transferSize: 4.4 * KB, encodedBodySize: 4 * KB }),
    ],
    expect: { atParse: "pending", afterLoad: "full" },
  },
  {
    name: "pending: cold fast burst → full at the observer (measured)",
    entries: [asset({ startTime: 200, duration: 900, transferSize: 210 * KB })],
    expect: { atParse: "pending", afterObserver: "full" },
  },

  // --- 304/revalidation entry class (task 7.11) ---
  {
    name: "304 class: 30 revalidations' header bytes (~9 KB) must NOT count toward the 8 KB load floor",
    entries: [...revalidations(30, 100, 35)],
    expect: { atParse: "pending", afterLoad: "full" },
    // If the 304 transferSize (~300 each, 9 KB total) were counted as
    // throughput, the load fallback would judge them: 9 KB over the ~1 s span
    // is ~9 B/ms < 220 B/ms → lite. The verdict must come from locality
    // instead (30 hits → full).
  },
  {
    name: "304 class: 304 header bytes do not cross the 48 KB probe floor either",
    entries: [...revalidations(60, 100, 20)],
    expect: { atParse: "pending", afterLoad: "full" },
  },
  {
    name: "304 class: API revalidations are not locality evidence either (fetch excluded before both counts)",
    entries: [...revalidations(4), ...xhr(10, 300)],
    expect: { atParse: "pending", afterFailsafe: "lite" },
  },

  // --- lite resolutions ---
  {
    name: "pending: nothing requested → failsafe lite",
    entries: [],
    expect: { atParse: "pending", afterFailsafe: "lite" },
  },
  {
    name: "pending: only 3 revalidations, below MIN_LOCAL_HITS → failsafe lite",
    entries: [...revalidations(3)],
    expect: { atParse: "pending", afterFailsafe: "lite" },
  },
  {
    name: "pending: cold slow burst → lite (measured at the observer)",
    entries: [asset({ startTime: 200, duration: 1000, transferSize: 60 * KB })],
    expect: { atParse: "pending", afterObserver: "lite" },
  },
  {
    name: "pending: warm cache carrying a genuinely slow payload → lite (measurement outranks locality)",
    entries: [
      ...revalidations(10),
      asset({ startTime: 300, duration: 1000, transferSize: 110 * KB }),
    ],
    expect: { atParse: "pending", afterObserver: "lite" },
  },
  {
    name: "saveData → lite at parse",
    entries: [...revalidations(23)],
    conn: { saveData: true, effectiveType: "4g", downlink: 10 },
    expect: { atParse: "lite" },
  },
  {
    name: "Safari < 16.4 (no size fields) → no evidence, failsafe lite (fails closed)",
    entries: [...unsized(25)],
    expect: { atParse: "pending", afterFailsafe: "lite" },
  },

  // --- API verdicts are never re-resolved ---
  {
    name: "API-full, warm cache, only XHR bytes → no verdict, stays full, no event",
    entries: [...revalidations(23), ...xhr(4)],
    conn: CONN_FULL,
    expect: { atParse: "full", afterFailsafe: "full", noEvents: true },
  },
  {
    name: "API-full, slow measured burst → downgrade to lite",
    entries: [asset({ startTime: 200, duration: 1000, transferSize: 60 * KB })],
    conn: CONN_FULL,
    expect: {
      atParse: "full",
      afterObserver: "lite",
      events: [{ tier: "lite", previous: "full" }],
    },
  },
  {
    name: "opaque 0/0/0 entries contribute nothing to either count",
    entries: [
      ...Array.from({ length: 12 }, (_, i) =>
        asset({ startTime: 150 + i * 50, transferSize: 0, encodedBodySize: 0, decodedBodySize: 0 }),
      ),
      ...revalidations(23),
    ],
    expect: { atParse: "pending", afterLoad: "full" },
  },
];

// Runner --------------------------------------------------------------------

let failures = 0;
for (const profile of profiles) {
  const got = runProfile(profile);
  const problems = [];
  for (const [stage, expected] of Object.entries(profile.expect)) {
    if (stage === "noEvents") {
      if (got.events.length !== 0)
        problems.push(`expected no events, got ${JSON.stringify(got.events)}`);
      continue;
    }
    if (stage === "events") {
      if (JSON.stringify(got.events) !== JSON.stringify(expected))
        problems.push(
          `expected events ${JSON.stringify(expected)}, got ${JSON.stringify(got.events)}`,
        );
      continue;
    }
    if (got[stage] !== expected) problems.push(`${stage}: expected ${expected}, got ${got[stage]}`);
  }
  if (problems.length > 0) {
    failures += 1;
    console.log(`FAIL  ${profile.name}`);
    for (const problem of problems) console.log(`      ${problem}`);
    console.log(
      `      ladder: parse=${got.atParse} observer=${got.afterObserver} load=${got.afterLoad} failsafe=${got.afterFailsafe} events=${JSON.stringify(got.events)}`,
    );
  } else {
    console.log(
      `ok    ${profile.name}  [parse=${got.atParse} observer=${got.afterObserver} load=${got.afterLoad} failsafe=${got.afterFailsafe}]`,
    );
  }
}

console.log(`\n${profiles.length - failures}/${profiles.length} profiles green`);
if (failures > 0) process.exit(1);
