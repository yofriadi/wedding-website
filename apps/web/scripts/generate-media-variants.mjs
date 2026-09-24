#!/usr/bin/env node
/**
 * generate-media-variants.mjs — build-time responsive variants (design D1–D3).
 *
 * Reads the masters present in `apps/web/public/` and writes resolution and
 * format variants into `apps/web/public/generated/`, which is gitignored:
 * `public/` holds REAL private photos locally (overlaid by
 * `tools/restore-private-media.sh` and hidden with `skip-worktree`), and any
 * derivative of a real photo is itself private media. In CI the same script runs
 * against the repository placeholders, whose filenames and dimensions match the
 * originals exactly, so it produces a complete set there too.
 *
 * Wired as `prebuild` and as `pnpm --filter web run media:variants`. `astro dev`
 * runs no `prebuild`, so the dev path is the documented explicit command.
 *
 * Two rules are shared with markup and MUST stay in sync with
 * `src/lib/media-candidates.ts`, which derives `srcset` values from them:
 *
 *   1. Never upscale, and never re-emit a width the master already fills — a
 *      generated width is emitted only when it is STRICTLY BELOW the master's
 *      intrinsic width. Emitting one at exactly that width would declare the
 *      same `w` descriptor twice (forbidden by the HTML Standard within one
 *      element's candidate list) and transcode a file nobody needs.
 *   2. The master itself is always the top candidate of its derived set,
 *      declared at its intrinsic width — markup appends it, this script does not
 *      copy it. Without that rule the narrow masters would offer a single 390w
 *      candidate and `event-resepsi` would REGRESS from the 584px file it ships
 *      today.
 *
 * Generation is per format from the same-format master (`x.avif` → `x-w768.avif`),
 * never AVIF-decoded-into-WebP: crossing formats would add a second lossy
 * generation to every byte for no benefit.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, "..", "public");
const OUT_DIR = path.join(PUBLIC_DIR, "generated");

/** Width ladder. Twin of `VARIANT_WIDTHS` in `src/lib/media-candidates.ts`. */
const VARIANT_WIDTHS = [390, 768, 1280];

const FORMATS = ["avif", "webp"];

/**
 * The explicit list of base names the markup references — NOT a directory scan
 * (design D1). A scan would also have to walk `public/map/`, whose only consumer
 * is `venue-map.ts:123`'s `bannerHtml()` popup image, deferred to a named
 * follow-up; scanning it would emit 16 files nothing consumes (3 bases x 2 formats x (2+2+1) rungs, plus 3 placeholders per format).
 *
 * This is the same list `resolveMasters()` requires both masters for, so a base
 * name in `BASES` but absent from `public/` fails the BUILD rather than the
 * guest's page.
 *
 * The inverse drift — a base ADDED to markup and forgotten here — is caught by
 * `guardMarkupCoverage()`, which reads the referencing sources directly. Under
 * `output: "server"` there is no build-time HTML listing references to scan
 * (`dist/server/entry.mjs` embeds a `public/` *disk* listing, not a reference
 * list), so the source files are the only authoritative input.
 */
const BASES = [
  // ZoomParallax collage, ten slots (src/components/ZoomParallax.astro).
  "square-top-right",
  "square-upper-right",
  "landscape-top-left",
  "landscape-mid-left",
  "square-mid-left",
  "center-focus",
  "square-mid-right",
  "portrait-bottom-left",
  "landscape-mid-bottom",
  "landscape-bottom-right",
  // TimelineScroll, three photos (src/components/TimelineScroll.astro).
  "awal-perkenalan",
  "keluarga-yofri",
  "keluarga-acik",
  // EventTimes, two cards (src/components/EventTimes.astro).
  "event-akad",
  "event-resepsi",
];

/**
 * Excluded from the input set BY NAME (responsive-media: "The step SHALL bound
 * its own input set"). A `-w<digits>` suffix test is NOT sufficient and is
 * deliberately not used: the hero derivatives are named `-390`/`-640`/`-1024`/
 * `-1536`, which such a test does not match, so the generator would emit exactly
 * the variants-of-variants (`wedding_photo-390-w390.avif`) this rule exists to
 * prevent. The single prefix covers the two hero masters, their four derivatives
 * and the `wedding_photo_blur` pair — all hand-maintained, and referenced
 * directly by `HeroZoom.astro` through `src/lib/hero-media.ts`.
 *
 * Enforced as a hard error rather than a silent filter for `BASES` — the list is
 * explicit, so a matching entry there is a mistake someone made, not input to
 * skip. For `guardMarkupCoverage()` the same prefixes are a FILTER, and a
 * load-bearing one: the hero family is referenced by markup and present in
 * `public/`, so without it the cross-check would demand variants of hand-
 * maintained derivatives.
 */
const EXCLUDED_NAME_PREFIXES = ["wedding_photo"];

/**
 * Source files whose markup names generated bases — an explicit floor that
 * discovery widens, and the floor is doing real work that discovery cannot.
 *
 * `discoverMarkupSources()` finds files that IMPORT the helper module, because
 * that is the only marker a caller must leave. A module of plain URL literals
 * leaves none: `src/lib/hero-media.ts` contains zero occurrences of
 * `media-candidates` and would be invisible to discovery were it not listed here.
 * It is the counterexample to the intuition that discovery subsumes the list, and
 * the reason any new module of that shape must be added by hand.
 *
 * The floor also survives `MARKUP_SOURCE_TOKENS` ceasing to match — a rename or
 * module split would silently empty discovery rather than throw, since
 * `collectMarkupBases()` unions the two sets and a smaller union still looks like
 * success.
 */
const MARKUP_SOURCES = [
  "src/components/ZoomParallax.astro",
  "src/components/TimelineScroll.astro",
  "src/components/EventTimes.astro",
  "src/lib/hero-media.ts",
];

/**
 * Token that marks a file as naming generated bases: the module specifier every
 * consumer must import. Deliberately ONE token, and deliberately not the call
 * shapes (`variantSrcset(`, `placeholderSrc(`): a caller cannot use those without
 * importing the module, so the specifier is the superset, and the call shapes
 * also match the *definitions* — which made `media-candidates.ts` select itself
 * and inject its own doc-comment example as a live base name.
 */
const MARKUP_SOURCE_TOKENS = ["media-candidates"];

/** The defining module, excluded from discovery: it documents example base names. */
const CANDIDATES_MODULE = path.join("lib", "media-candidates.ts");

/** Directory walked to discover markup sources beyond `MARKUP_SOURCES`. */
const SRC_DIR = path.resolve(HERE, "..", "src");

/**
 * Reference shapes the three components and the hero module use. Deliberately
 * narrow: a base name is `[a-z0-9_-]+` with no slash, so `public/map/…`,
 * `public/gate/…` and any nested path cannot match, and a false positive on an
 * unrelated string is made inert by the master-existence test in
 * `guardMarkupCoverage()`.
 */
const MARKUP_BASE_PATTERNS = [
  // `src: "/square-top-right.webp"` — ZoomParallax slot config. NO `i` flag:
  // every base name and every master on disk is lowercase, and on a
  // case-insensitive filesystem (APFS, NTFS) `i` would let a prose string like
  // `"/Center-Focus.avif"` match, pass `existsSync`, miss `BASES`, and fail the
  // build on macOS while passing in CI on Linux. NO `jpe?g` either: `FORMATS` is
  // avif+webp, so a JPEG-only master could never be generated, and accepting the
  // spelling here would let `guardMarkupCoverage()`'s master test pass on a file
  // the generator cannot use — reporting coverage that does not exist.
  /"\/([a-z0-9_-]+)\.(?:avif|webp)"/g,
  // `variantSrcset("awal-perkenalan", …)` / `placeholderSrc(…)` literals.
  /(?:variantSrcset|placeholderSrc)\(\s*"([a-z0-9_-]+)"/g,
  // `image: "/event-akad"` — EventTimes stores the path without an extension.
  // The extension is OPTIONAL so that normalising the config to
  // `"/event-akad.webp"` (matching ZoomParallax's idiom) still yields the base
  // rather than silently dropping out of the cross-check. `baseOf()` and
  // `masterSrc()` in `src/lib/media-candidates.ts` both normalise, so the
  // `srcset` AND the `<img src>` resolve identically under either spelling.
  /image:\s*"\/([a-z0-9_-]+)(?:\.(?:avif|webp))?"/g,
];

// Encoding settings MIRROR the house values in `src/lib/image-encode.ts`
// (`WEBP_QUALITY = 80`, `AVIF_QUALITY = 55`, `AVIF_EFFORT = 4`,
// `smartSubsample: true`), so a generated variant and an uploaded guest photo are
// not different beasts. The mirror is by hand — an `.mjs` script cannot import a
// `.ts` module — and `manifestBody()` does NOT fingerprint `image-encode.ts`, so
// bumping a constant there diverges the two pipelines and leaves every output
// "fresh". That is intended: uploads and derivatives are separate concerns. Note
// also that `image-encode.ts` applies `.rotate()` and this script does not.
// Metadata is NOT a divergence: sharp strips EXIF/ICC by default and
// `keepExif()` is opt-in, so neither pipeline carries master metadata into its
// output. The rotation gap is harmless today — every master was probed and none
// reports an EXIF orientation or an ICC profile — but a master that ever carried
// orientation would yield unrotated derivatives beside a rotated master.
// Placeholders drop lower: at 32px blurred there is no detail left to preserve
// and the byte cap is the binding constraint.
const SETTINGS = {
  avif: { normal: { quality: 55, effort: 4 }, lqip: { quality: 35, effort: 4 } },
  webp: {
    normal: { quality: 80, effort: 4, smartSubsample: true },
    lqip: { quality: 45, effort: 4, smartSubsample: true },
  },
};

/** Low-fidelity placeholder width (design D3: ~32px, blurred). */
const LQIP_WIDTH = 32;
/** Gaussian sigma applied before encoding, so edges do not ring at 32px. */
const LQIP_BLUR_SIGMA = 1.5;
/**
 * Hard cap per placeholder, and the reason ten collage placeholders cost at most
 * ~40 KB on a lite tier. Enforced as a build failure, not a warning: the
 * aggregate placeholder cost of a tier must not be able to grow silently.
 */
const LQIP_MAX_BYTES = 4 * 1024;

/**
 * Soft ceiling per generated VARIANT, and the figure task 5.9 scopes its MUST
 * to. Reported as a warning naming every file over it rather than a build
 * failure: unlike the placeholder cap, which bounds a fixed count of ten files a
 * lite tier always pays, this one is a property of the couple's photos, and
 * failing a deployment over a busy real photo would be worse than shipping it.
 * The warning exists because the binding file is easy to mis-attribute — see the
 * report, which now names it rather than leaving the reader to guess.
 */
const VARIANT_WARN_BYTES = 200 * 1024;

/**
 * Age after which a foreign-pid temp file is treated as an orphan. See
 * `pruneStale()`.
 */
const TMP_STALE_MS = 60 * 60 * 1000;

/**
 * Build-configuration fingerprint, written to `generated/manifest.json`.
 *
 * Freshness cannot be a function of master mtime alone: the encode parameters and
 * the ENCODER ITSELF are inputs to the bytes but not to the timestamp, so bumping
 * AVIF quality — or bumping `sharp`, which changes libvips/aom/libwebp and
 * therefore the output of an identical pipeline — would leave every output
 * "fresh" and the script would print `nothing to do` while shipping the old
 * encoding. `taze -rw` bumped `sharp` in this repo five commits before this
 * change, so that is a live path rather than a hypothetical, and `Dockerfile:25-26`
 * runs `pnpm install --ignore-scripts && pnpm rebuild esbuild sharp`, so the
 * image's libvips need not match the developer's.
 *
 * `PIPELINE_VERSION` covers the parts of the encode path that are code rather
 * than data — the `resize({ withoutEnlargement })` defaults, `blur()`, the
 * per-format branch in `encode()`. Bump it when you change them. The whole script
 * is deliberately NOT hashed: three review passes of comment edits would each
 * force a full re-encode.
 *
 * `BASES` is deliberately NOT in the fingerprint. No surviving output's bytes
 * depend on the base list: a new base has no outputs, so `existsSync` is false
 * and it encodes; a removed base's outputs are deleted by `pruneStale()`. Listing
 * it would re-encode all 84 files when someone adds a collage slot or merely
 * reorders the array.
 *
 * WHAT THE MANIFEST CAN AND CANNOT REACH. On a Turbo cache **hit** `prebuild`
 * does not execute at all, so the manifest is neither consulted nor needed — the
 * hit restores `public/generated/**`, manifest included. What it protects is the
 * next run after any warm `generated/`: the documented hand-run of
 * `media:variants`, or a Turbo miss.
 *
 * WHY COMMITTING THIS SCRIPT STILL MATTERS — and it is not the reason an earlier
 * draft gave. `$TURBO_DEFAULT$` is every file in the package that `.gitignore`
 * does not exclude, TRACKED OR NOT: `turbo run build --filter=web --dry=json`
 * reports 152 inputs for `web#build` including this script while it is still `??`
 * in `git status`, and 0 entries for `generated/` (gitignored). So a `SETTINGS`
 * edit does change the task hash and `prebuild` does run. Committing the script
 * matters because an untracked file does not exist in a fresh clone, so CI cannot
 * run it at all.
 *
 * The exposure that being output-only creates is the mirror image, and is the real
 * one: because `generated/` is not an input, two DIFFERENT working-tree
 * `generated/` states hash identically. A cache HIT can therefore restore an older
 * archive over a newer hand-run, and nothing detects it — the restored manifest
 * matches the restored outputs, so the next hand-run also reports `nothing to do`.
 * That is inherent to caching a gitignored output and bounded by "the archive came
 * from the same inputs". `rm -rf apps/web/public/generated` is the remedy.
 *
 * Not a dotfile, and co-located with the outputs it describes so the two are
 * always restored together or not at all. That is worth more than keeping build
 * config out of `dist/client/` — the file is served at `/generated/manifest.json`,
 * deliberately, since the base names already appear in the delivered `srcset`s and
 * encode settings are not secrets. (A dotfile would additionally risk falling
 * outside Turbo's `public/generated/**` output glob, but that glob's dotfile
 * behaviour is untested and is not what this choice rests on.)
 */
const PIPELINE_VERSION = 1;
const MANIFEST_NAME = "manifest.json";
const MANIFEST_PATH = path.join(OUT_DIR, MANIFEST_NAME);
const manifestBody = () =>
  JSON.stringify({
    pipelineVersion: PIPELINE_VERSION,
    encoder: {
      sharp: sharp.versions.sharp,
      vips: sharp.versions.vips,
      aom: sharp.versions.aom,
      webp: sharp.versions.webp,
    },
    settings: SETTINGS,
    variantWidths: VARIANT_WIDTHS,
    lqipWidth: LQIP_WIDTH,
    lqipBlurSigma: LQIP_BLUR_SIGMA,
  });

let manifestMatchesCached;
/** Whether the on-disk fingerprint matches the current build configuration. */
function manifestMatches() {
  if (manifestMatchesCached === undefined) {
    try {
      manifestMatchesCached = readFileSync(MANIFEST_PATH, "utf8") === manifestBody();
    } catch {
      manifestMatchesCached = false;
    }
  }
  return manifestMatchesCached;
}

const variantName = (base, format, width) => `${base}-w${width}.${format}`;
const lqipName = (base, format) => `${base}-lqip.${format}`;
const kb = (bytes) => `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 2 : 1)} KB`;

function encode(pipeline, format, isLqip) {
  const settings = SETTINGS[format][isLqip ? "lqip" : "normal"];
  return format === "avif" ? pipeline.avif(settings) : pipeline.webp(settings);
}

/**
 * Idempotency: an output newer than every master is already correct. Compared
 * against master mtime, which is what `tools/restore-private-media.sh` rewrites
 * when it overlays real media — so restoring private photos invalidates
 * placeholder-derived variants, and a Turbo-restored `generated/` is not
 * re-encoded for nothing.
 */
function isFresh(outputPath, masterPaths) {
  // Configuration first: a stale fingerprint invalidates every output regardless
  // of timestamps, which is the only way a `SETTINGS` edit can take effect.
  if (!manifestMatches()) return false;
  if (!existsSync(outputPath)) return false;
  const outMtime = statSync(outputPath).mtimeMs;
  return masterPaths.every((master) => outMtime > statSync(master).mtimeMs);
}

/** Write via a temp name so an interrupted run cannot leave a truncated asset. */
async function writeAtomic(target, bytes) {
  const tmp = `${target}.tmp-${process.pid}`;
  await writeFile(tmp, bytes);
  await rename(tmp, target);
}

/**
 * Prune only files this script could have produced, so `generated/` is exactly
 * the expected set once a base leaves the list. Anything else in the directory is
 * left alone rather than deleted.
 *
 * The expected set is WIDTH-AWARE and built from the resolved masters, not from
 * the cartesian product of `BASES` x `FORMATS` x `VARIANT_WIDTHS`.
 * `generateFor()` skips every width at or above the master's intrinsic width and
 * never records it, so a product-built set would keep a retired rung on disk
 * forever: never emitted, never pruned, never measured, and shipped, because
 * Astro copies all of `public/` into `dist/client/`. That is reachable whenever a
 * master narrows between runs. Only two masters sit above the 1280 rung today —
 * `center-focus` (1920 px) and `keluarga-acik` (2048 px) — so replacing either
 * with a narrower crop retires `-w1280` permanently. (`event-akad` at 768 px and
 * `event-resepsi` at 584 px emit no `-w1280` at all, so they cannot demonstrate
 * it; an earlier draft of this comment used them, and also called them
 * placeholders, which `README.md` and `git ls-files -v` both contradict — the
 * `event-*` files are tracked, not skip-worktree'd.) It also matters because `report.variants` is the
 * sole signal for task 5.9's ≤ 200 KB ceiling: a stale oversized derivative would
 * ship and the warning would never name it.
 *
 * @param bases `report.bases`, each `{ base, intrinsicWidth }`.
 */
function pruneStale(bases) {
  const expected = new Set([MANIFEST_NAME]);
  for (const { base, intrinsicWidth } of bases) {
    for (const format of FORMATS) {
      expected.add(lqipName(base, format));
      for (const width of VARIANT_WIDTHS) {
        if (width < intrinsicWidth) expected.add(variantName(base, format, width));
      }
    }
  }
  const owned = /^.+(?:-w\d+|-lqip)\.(?:avif|webp)$/;

  const pruned = [];
  for (const name of readdirSync(OUT_DIR)) {
    const full = path.join(OUT_DIR, name);
    // `throwIfNoEntry: false` throughout: the README tells developers to run
    // `media:variants` by hand, and a hand-run concurrent with a build in another
    // terminal is a supported case, so an entry can vanish between the directory
    // read and the stat. A bare ENOENT here would kill the build naming neither
    // the race nor the other process.
    const stat = statSync(full, { throwIfNoEntry: false });
    if (!stat?.isFile()) continue;

    // Orphaned temp files from an interrupted run. `writeAtomic` names them
    // `<target>.tmp-<pid>`, which `owned` does not match, so without this a
    // killed run leaves a PARTIAL DERIVATIVE OF A PRIVATE PHOTO in `generated/`
    // — and Astro copies all of `public/` into `dist/client/`, shipping it.
    //
    // Our own pid is always skipped: those are in flight. A FOREIGN pid is only
    // removed once it is older than `TMP_STALE_MS`, because `README.md` tells
    // developers to run `media:variants` by hand (`astro dev` runs no
    // `prebuild`) and a hand-run concurrent with a build in another terminal is
    // exactly a supported case. Deleting a live temp file there makes the other
    // run's `rename()` fail with an ENOENT naming neither the race nor the other
    // process. `force` because a concurrent run may have renamed it already.
    const tmpPid = /\.tmp-(\d+)$/.exec(name);
    if (tmpPid) {
      if (Number(tmpPid[1]) === process.pid) continue;
      if (Date.now() - stat.mtimeMs < TMP_STALE_MS) continue;
      rmSync(full, { force: true });
      pruned.push(name);
      continue;
    }

    if (!owned.test(name) || expected.has(name)) continue;
    // `force` for the same reason as the temp branch: a concurrent hand-run may
    // have removed it between the directory read and here.
    rmSync(full, { force: true });
    pruned.push(name);
  }
  return pruned;
}

function guardInputSet() {
  const seen = new Set();
  for (const base of BASES) {
    // `BASES` is hand-maintained. A duplicate is a copy-paste error that
    // `resolveMasters()`'s `Map` would collapse silently — one entry, one
    // `generateFor` call, nothing double-counted — so this names it instead.
    if (seen.has(base)) throw new Error(`base "${base}" is listed twice in BASES`);
    seen.add(base);
    const excluded = EXCLUDED_NAME_PREFIXES.find((prefix) => base.startsWith(prefix));
    if (excluded) {
      throw new Error(
        `base "${base}" matches the excluded name prefix "${excluded}*": the hero family and its blur layer are hand-maintained and referenced directly`,
      );
    }
    // A base name becomes a filename fragment (`<base>-w390.avif`) and a URL
    // path segment, so anything outside `[a-z0-9_-]` is rejected. Without this a
    // base literally named `x.webp` would make `baseOf()` non-idempotent and emit
    // `x.webp-w390.avif`.
    if (!/^[a-z0-9_-]+$/.test(base)) {
      throw new Error(
        `base "${base}" is not [a-z0-9_-]+: it names a subdirectory or hidden path, or carries a character that cannot appear in a generated filename`,
      );
    }
  }
}

/**
 * Files under `src/` that mention the candidate helpers, found by walking the
 * tree rather than trusting `MARKUP_SOURCES`. `MARKUP_SOURCES` is the same class
 * of hand-maintained list as `BASES` — the drift this guard exists to catch,
 * moved up one level — so it is a floor that discovery widens, not a ceiling.
 * Hoisting a config into a module that IMPORTS the helpers is picked up with no
 * edit here — `WelcomeGate.astro` is a live example: it imports `VARIANT_WIDTHS`,
 * so discovery finds it, and it is absent from the floor. So is adding a photo to
 * `FamiliesReveal.astro`, provided it goes through the helper.
 *
 * A module of plain URL literals is NOT: `hero-media.ts` imports nothing, so
 * discovery never sees it and only the floor covers it. See `MARKUP_SOURCES`.
 */
function discoverMarkupSources(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      discoverMarkupSources(full, found);
    } else if (/\.(astro|ts)$/.test(entry.name)) {
      // Skip the defining module. It exports `variantSrcset`, so it matches the
      // discovery token by defining it, and its own doc comment uses
      // `"/square-top-right.webp"` as an example — scanning it injected that name
      // as a live base and masked the `unreferenced` note for it.
      if (full === path.join(SRC_DIR, CANDIDATES_MODULE)) continue;
      const text = readFileSync(full, "utf8");
      if (MARKUP_SOURCE_TOKENS.some((token) => text.includes(token))) {
        found.push(path.relative(path.resolve(HERE, ".."), full));
      }
    }
  }
  return found;
}

/** Every base name the markup references, across the discovered source set. */
function collectMarkupBases() {
  const bases = new Set();
  const sources = new Set(MARKUP_SOURCES);
  if (existsSync(SRC_DIR)) {
    for (const rel of discoverMarkupSources(SRC_DIR)) sources.add(rel);
  }

  for (const rel of sources) {
    const file = path.resolve(HERE, "..", rel);
    if (!existsSync(file)) {
      // Only the explicit floor can be missing: discovery lists what it found.
      // Failing loudly is right, because a silently-skipped source makes the
      // cross-check vacuous for every base it owns.
      throw new Error(`markup source for the base-name cross-check is missing: ${rel}`);
    }
    const text = readFileSync(file, "utf8");
    for (const pattern of MARKUP_BASE_PATTERNS) {
      for (const match of text.matchAll(pattern)) bases.add(match[1]);
    }
  }
  return bases;
}

/**
 * Fail when markup references a base `BASES` does not cover.
 *
 * `resolveMasters()` catches a listed base with no master. This catches the
 * opposite and more likely error, because `BASES` is hand-duplicated from three
 * components: add an eleventh collage slot, forget the list, and NOTHING fails —
 * generation skips the base, `variantSrcset()` still emits
 * `/generated/<base>-w390.avif` from the naming convention alone, and the guest
 * 404s on every promoted image in that slot.
 *
 * A reference only fails the build when its master is actually present in
 * `public/`. The patterns above are heuristics over source text; requiring a
 * real master keeps a false positive inert instead of spurious.
 *
 * @returns bases still listed but no longer referenced (reported, not fatal —
 *   a slot may be mid-edit, and the cost is dead files, not a broken page).
 */
function guardMarkupCoverage() {
  const referenced = collectMarkupBases();
  const missing = [];

  for (const base of referenced) {
    if (BASES.includes(base)) continue;
    if (EXCLUDED_NAME_PREFIXES.some((prefix) => base.startsWith(prefix))) continue;
    const hasMaster = FORMATS.some((format) =>
      existsSync(path.join(PUBLIC_DIR, `${base}.${format}`)),
    );
    if (hasMaster) missing.push(base);
  }

  if (missing.length > 0) {
    throw new Error(
      `markup references base name(s) absent from BASES: ${missing.join(", ")}.\n` +
        `  Their masters exist in public/, so the delivered srcset would name a\n` +
        `  /generated/ URL nothing emits — a guest-facing 404. Add them to BASES in\n` +
        `  ${path.basename(fileURLToPath(import.meta.url))}.`,
    );
  }

  return BASES.filter((base) => !referenced.has(base));
}

/**
 * Resolve each base to the masters actually present. A base with none is a
 * guest-facing 404 waiting to happen, so the whole run fails instead.
 *
 * BOTH formats are required, not merely tolerated. Markup emits an AVIF
 * `<source>` and a WebP `<source>` for every one of these bases, and one ladder
 * is generated per base; a single-format master would leave the other format's
 * `srcset` naming files that do not exist. That is worst on the `<img>` fallback
 * path, which is reached precisely by the engines that cannot do AVIF.
 */
function resolveMasters() {
  const masters = new Map();
  const problems = [];

  for (const base of BASES) {
    const present = FORMATS.map((format) => ({
      format,
      file: path.join(PUBLIC_DIR, `${base}.${format}`),
    })).filter((entry) => existsSync(entry.file));

    if (present.length === 0) {
      problems.push(`${base}: no master in either format`);
    } else if (present.length !== FORMATS.length) {
      problems.push(
        `${base}: has ${present.map((entry) => entry.format).join("+")}, needs ${FORMATS.join("+")}`,
      );
    } else {
      masters.set(base, present);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `unusable master(s) for base name(s) the markup references:\n` +
        problems.map((problem) => `  - ${problem}`).join("\n") +
        `\n  Add the missing master (a placeholder is fine in CI), or drop the base from\n` +
        `  BASES in ${path.basename(fileURLToPath(import.meta.url))} AND from its component.`,
    );
  }
  return masters;
}

async function generateFor(base, entries, report) {
  // Intrinsic width is READ from each master, never assumed and never taken from
  // one format for both: rule 1 is decided from it. Markup's declared `width` is
  // REQUIRED to match it and nothing here can check that — the generator never
  // sees the number a component hardcodes, and a declared width larger than the
  // master makes `variantSrcset()` name rungs this script skipped. `follow-ups.md`
  // §7 owns that gap; today the 122-URL 200-sweep in `measurements.md` is what
  // would catch it. A divergent AVIF/WebP pair would be resized with one
  // ladder, so the narrower format would silently no-op under
  // `withoutEnlargement` and ship a file named `-w768` holding fewer pixels than
  // the `768w` descriptor it is served under.
  const widths = [];
  for (const { format, file } of entries) {
    const { width } = await sharp(file).metadata();
    if (!width) throw new Error(`cannot read intrinsic width of ${file}`);
    widths.push({ format, width });
  }
  const distinct = [...new Set(widths.map((entry) => entry.width))];
  if (distinct.length !== 1) {
    throw new Error(
      `${base}: masters disagree on intrinsic width (` +
        widths.map((entry) => `${entry.format} ${entry.width}px`).join(", ") +
        `). One ladder is emitted for both formats.`,
    );
  }
  const intrinsicWidth = distinct[0];
  const masterPaths = entries.map((entry) => entry.file);

  for (const { format, file } of entries) {
    for (const width of VARIANT_WIDTHS) {
      const name = variantName(base, format, width);
      const outPath = path.join(OUT_DIR, name);

      if (width >= intrinsicWidth) {
        report.skippedWidth.push(
          `${name} — ${width === intrinsicWidth ? `master already ${intrinsicWidth}px` : `master is only ${intrinsicWidth}px`}`,
        );
        continue;
      }
      if (isFresh(outPath, masterPaths)) {
        report.fresh.push(name);
      } else {
        const bytes = await encode(
          sharp(file).resize({ width, withoutEnlargement: true }),
          format,
          false,
        ).toBuffer();
        await writeAtomic(outPath, bytes);
        report.written.push(`${name} (${kb(bytes.byteLength)})`);
      }
      // Measured on BOTH paths, exactly like `report.lqips` below. A variant
      // restored from the Turbo cache never passes through the encoder, so
      // tracking only written bytes reports the largest of a subset — and on an
      // idempotent re-run that subset is empty. This is the only signal task
      // 5.9's ≤ 200 KB ceiling has, and it records the NAME as well as the size,
      // because a bare number invites the reader to attribute it to whichever
      // base they expected.
      report.variants.push({ name, bytes: statSync(outPath).size });
    }

    const name = lqipName(base, format);
    const outPath = path.join(OUT_DIR, name);
    if (isFresh(outPath, masterPaths)) {
      report.fresh.push(name);
    } else {
      const bytes = await encode(
        sharp(file).resize({ width: LQIP_WIDTH, withoutEnlargement: true }).blur(LQIP_BLUR_SIGMA),
        format,
        true,
      ).toBuffer();

      if (bytes.byteLength > LQIP_MAX_BYTES) {
        throw new Error(
          `LQIP ${name} is ${kb(bytes.byteLength)}, over the ${LQIP_MAX_BYTES / 1024} KB cap.\n` +
            `  Ten collage placeholders are the entire cost of a lite tier; lower the quality or the width.`,
        );
      }
      await writeAtomic(outPath, bytes);
      report.written.push(`${name} (${kb(bytes.byteLength)} LQIP)`);
    }
    report.lqips.push({ name, bytes: statSync(outPath).size });
  }

  report.bases.push({ base, intrinsicWidth, formats: entries.map((entry) => entry.format) });
}

async function main() {
  if (!existsSync(PUBLIC_DIR)) throw new Error(`public/ not found at ${PUBLIC_DIR}`);

  guardInputSet();
  const unreferenced = guardMarkupCoverage();
  const masters = resolveMasters();
  mkdirSync(OUT_DIR, { recursive: true });

  const report = {
    written: [],
    fresh: [],
    skippedWidth: [],
    lqips: [],
    variants: [],
    bases: [],
  };

  for (const [base, entries] of masters) {
    await generateFor(base, entries, report);
  }

  const pruned = pruneStale(report.bases);
  // The 4 KB cap is re-checked over EVERY placeholder, including the ones
  // `isFresh()` short-circuited. The encode-path check alone would let an
  // oversized placeholder ship whenever `generated/` arrives from the Turbo
  // cache or is hand-edited, and never passes through the encoder
  // (progressive-enhancement: the step SHALL fail when one is over the cap).
  const overCap = report.lqips.filter((entry) => entry.bytes > LQIP_MAX_BYTES);
  if (overCap.length > 0) {
    throw new Error(
      `LQIP over the ${LQIP_MAX_BYTES / 1024} KB cap: ` +
        overCap.map((entry) => `${entry.name} (${kb(entry.bytes)})`).join(", ") +
        `.\n  Delete public/generated/ and re-run. Ten collage placeholders are the entire\n` +
        `  cost of a lite tier, so this may not grow silently.`,
    );
  }

  // Written whether or not anything was encoded, so the next run's `isFresh()`
  // has a fingerprint to compare against — and written only AFTER every check
  // above has passed, so a run that throws never blesses a partial set as fresh.
  await writeFile(MANIFEST_PATH, manifestBody());

  // Soft ceiling, reported over EVERY variant including the fresh ones. A
  // warning rather than a failure: this is a property of the couple's photos,
  // and failing a deployment over a busy real photo is worse than shipping it.
  const overCeiling = report.variants.filter((entry) => entry.bytes > VARIANT_WARN_BYTES);
  if (overCeiling.length > 0) {
    console.warn(
      `[media-variants] WARNING: ${overCeiling.length} generated variant(s) over the ` +
        `${VARIANT_WARN_BYTES / 1024} KB ceiling task 5.9 scopes its MUST to: ` +
        overCeiling.map((entry) => `${entry.name} (${kb(entry.bytes)})`).join(", "),
    );
  }
  // --- Report ---------------------------------------------------------------
  const lqipTotal = report.lqips.reduce((sum, entry) => sum + entry.bytes, 0);
  const lqipMax = report.lqips.reduce((max, entry) => (entry.bytes > max.bytes ? entry : max), {
    name: "-",
    bytes: 0,
  });

  console.log(
    `[media-variants] ${BASES.length} bases, ladder ${VARIANT_WIDTHS.join("/")}px → ${path.relative(process.cwd(), OUT_DIR)}`,
  );
  for (const { base, intrinsicWidth } of report.bases) {
    console.log(`  ${base.padEnd(22)} master ${intrinsicWidth}px`);
  }
  console.log(
    `[media-variants] wrote ${report.written.length}, ${report.fresh.length} already fresh, ${report.skippedWidth.length} widths not emitted`,
  );
  for (const line of report.written) console.log(`  + ${line}`);
  if (report.skippedWidth.length > 0) {
    console.log("[media-variants] not emitted (no-upscale rule / master fills the slot):");
    for (const line of report.skippedWidth) console.log(`  - ${line}`);
  }
  if (pruned.length > 0) {
    console.log(`[media-variants] pruned ${pruned.length} stale output(s): ${pruned.join(", ")}`);
  }
  if (unreferenced.length > 0) {
    console.log(
      `[media-variants] note: listed in BASES but no longer referenced by markup: ${unreferenced.join(", ")}`,
    );
  }
  console.log(
    `[media-variants] LQIP ${report.lqips.length} file(s), ${kb(lqipTotal)} total, largest ${lqipMax.name} ${kb(lqipMax.bytes)} (cap ${LQIP_MAX_BYTES / 1024} KB)`,
  );
  const variantMax = report.variants.reduce(
    (max, entry) => (entry.bytes > max.bytes ? entry : max),
    { name: "-", bytes: 0 },
  );
  if (variantMax.bytes > 0) {
    console.log(
      `[media-variants] largest generated variant: ${variantMax.name} ${kb(variantMax.bytes)} ` +
        `(ceiling ${VARIANT_WARN_BYTES / 1024} KB, ${overCeiling.length} over)`,
    );
  }
  if (report.written.length === 0 && pruned.length === 0) {
    console.log("[media-variants] nothing to do");
  }
}

// Guarded so importing this module does not trigger a full generation and then
// `process.exit()` the importer. It currently exports nothing; add `export` to
// `manifestBody()`/`resolveMasters()` if the deferred task-6.1 harness wants them.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(`[media-variants] ${error.message}`);
      process.exit(1);
    },
  );
}
