// Regenerates apps/web/tests/fixtures/slide-to-confirm.html (rsvp-star-confirm 1.4).
//
// The slider only renders server-side for cookie-identified invitees, and
// the repo's no-seed test convention means the real page shows no control to a
// Playwright run — so the control's behavior is covered against a committed
// static fixture instead (design D7). The fixture is the /slide-to-confirm-fixture
// dev route with the component's compiled CSS inlined: nothing here is
// hand-written, so it cannot drift from what Astro actually serves.
//
// Usage (dev server must be running):
//   pnpm dev:bare            # then, in another shell
//   node scripts/make-slide-to-confirm-fixture.mjs [--base http://localhost:4321]
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const outPath = resolve(webRoot, "tests/fixtures/slide-to-confirm.html");

const baseIndex = process.argv.indexOf("--base");
const BASE =
  (baseIndex === -1 ? process.env.FIXTURE_BASE : process.argv[baseIndex + 1]) ||
  "http://localhost:4321";

async function text(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return await res.text();
}

let html = await text(`${BASE}/slide-to-confirm-fixture`);

// 1. Dev-only runtime: Vite client, Astro dev toolbar, toolbar bootstrap.
html = html
  .replace(/<script[^>]*src="[^"]*(?:@vite\/client|dev-toolbar)[^"]*"[^>]*><\/script>/g, "")
  .replace(/<script>window\.__astro_dev_toolbar__[^<]*<\/script>/g, "");

// 2. Vite injects component CSS through a module script; the matching
//    <style data-vite-dev-id> element is already in the served head, so the
//    injector is dropped and the style tag is kept as a plain <style>.
html = html.replace(/<script[^>]*src="[^"]*type=style[^"]*"[^>]*><\/script>/g, "");
html = html.replace(/<style data-vite-dev-id="[^"]*">/g, "<style>");

// 3. Inline any component script as a deferred module — exactly the tag Astro
//    emits in production. SlideToConfirm's script imports bare specifiers
//    (motion, canvas-confetti), which a file:// page cannot resolve, so they
//    are rewritten to esm.sh URLs: the fixture must exercise the real drag →
//    morph → confetti behavior, and a stubbed import would test nothing.
//    The pinned versions are the ones the workspace resolved when the fixture
//    was generated; bump them when package.json does.
const ESM_IMPORTS = {
  motion: "https://esm.sh/motion@13",
  "canvas-confetti": "https://esm.sh/canvas-confetti@1.9.4",
};
const scriptTags = [
  ...html.matchAll(/<script type="module" src="([^"]*type=script[^"]*)"><\/script>/g),
];
for (const [tag, src] of scriptTags) {
  let js = await text(`${BASE}${src.replace(/&amp;/g, "&")}`);
  if (/<\/script/i.test(js)) throw new Error(`cannot inline ${src}: contains </script>`);
  // Vite serves the script with dev-server URLs for its bare imports
  // ("/node_modules/.vite/deps/<pkg>.js?…"); rewrite each to the esm.sh twin.
  js = js.replace(
    /from\s+"\/node_modules\/\.vite\/deps\/([^?"]+?)(?:\.js)?(?:\?[^"]*)?"/g,
    (_match, pkg) => {
      const url = ESM_IMPORTS[pkg];
      if (!url) {
        throw new Error(
          `no esm.sh mapping for "${pkg}" — add it to ESM_IMPORTS so the fixture stays runnable`,
        );
      }
      return `from "${url}"`;
    },
  );
  if (/\/node_modules\/\.vite\//.test(js)) {
    throw new Error(`unresolved dev import survived in ${src}`);
  }
  html = html.replace(tag, `<script type="module">\n${js}\n</script>`);
}
if (/astro&type=|@vite|__astro_dev_toolbar__/.test(html)) {
  throw new Error("dev runtime references survived the strip — check the regexes");
}
// The component's own CSS is the whole idle effect, so an empty-handed strip
// is a broken fixture rather than a clean one.
if (!/\.slide-to-confirm/.test(html)) {
  throw new Error("no component CSS found in the served page");
}

const banner = `<!--
  GENERATED FILE — do not edit by hand.
  Source: apps/web/src/pages/slide-to-confirm-fixture.astro
  (SlideToConfirm.astro markup and scoped CSS as Astro actually serves them).
  Regenerate: pnpm dev:bare && node scripts/make-slide-to-confirm-fixture.mjs
  Consumed by: apps/web/tests/slide-to-confirm.spec.ts (rsvp-star-confirm 1.4 / 3.2).
-->
`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${banner}${html}\n`, "utf8");
console.log(`wrote ${outPath} (${scriptTags.length} script(s) inlined)`);
