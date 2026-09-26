/**
 * Tier-verdict harness.
 *
 * Runs Layout.astro's inline head script against connection profiles in Node
 * and asserts the verdict set on <html data-tier> before body parse.
 *
 *   pnpm --filter web run test:tier-harness
 */
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LAYOUT = join(HERE, "..", "src", "layouts", "Layout.astro");

const source = readFileSync(LAYOUT, "utf8");
const head = source.match(/<script is:inline>([\s\S]*?data-tier[\s\S]*?)<\/script>/);
if (!head) throw new Error("Inline head script for data-tier not found in Layout.astro");
const HEAD_SCRIPT = head[1];

// Profile runner ------------------------------------------------------------

function runProfile({ conn }) {
  let tier = null;
  const rootElement = {
    getAttribute: () => tier,
    setAttribute: (_name, value) => {
      tier = value;
    },
  };
  const sandbox = {
    document: { documentElement: rootElement },
    navigator: { connection: conn },
    window: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(HEAD_SCRIPT, sandbox, { filename: "head-script.js" });
  return { atParse: tier };
}

// Profiles ------------------------------------------------------------------

const profiles = [
  {
    name: "saveData: true → lite at parse",
    conn: { saveData: true },
    expect: { atParse: "lite" },
  },
  {
    name: "saveData: false → full at parse",
    conn: { saveData: false, effectiveType: "4g" },
    expect: { atParse: "full" },
  },
  {
    name: "no navigator.connection (Safari/Firefox) → full at parse",
    conn: undefined,
    expect: { atParse: "full" },
  },
  {
    name: "slow connection without saveData (Option 1) → full at parse",
    conn: { saveData: false, effectiveType: "3g", downlink: 0.8 },
    expect: { atParse: "full" },
  },
];

// Runner --------------------------------------------------------------------

let failures = 0;
for (const profile of profiles) {
  const got = runProfile(profile);
  if (got.atParse !== profile.expect.atParse) {
    failures += 1;
    console.log(`FAIL  ${profile.name}: expected ${profile.expect.atParse}, got ${got.atParse}`);
  } else {
    console.log(`ok    ${profile.name}  [tier=${got.atParse}]`);
  }
}

console.log(`\n${profiles.length - failures}/${profiles.length} profiles green`);
if (failures > 0) process.exit(1);
