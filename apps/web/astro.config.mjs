// @ts-check
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  // DISABLED DELIBERATELY — load-bearing, read before changing it.
  //
  // Astro's checkOrigin compares `Origin` against `new URL(request.url).origin`,
  // and request.url's scheme comes from `req.socket.encrypted`. Behind the
  // documented deployment — `Caddyfile.example` terminates TLS and reverse_proxies
  // plain HTTP — those can never match: the browser sends `Origin: https://host`
  // while request.url is `http://host`. Every form-like and bodiless POST then
  // 403s in production. Guest photo upload and invite-open tracking were already
  // broken this way; `/api/rsvp` survived only because JSON bodies are exempt from
  // the form-like check, which is why nobody noticed.
  //
  // It cannot be fixed from config. The predicate is applied in
  // `core/middleware/load.js`, which `unshift`s the check ahead of user middleware,
  // and again in `core/pages/handler.js` reached via `core/fetch` — both before a
  // route handler can act, so `src/middleware.ts` cannot rewrite the URL in time;
  // `site:` never reaches `new URL(request.url)`; and `security.allowedDomains`
  // only feeds validateForwardedHeaders, which the node adapter calls with `void 0`
  // for the protocol.
  //
  // REPLACED BY `isSameOriginRequest()` in src/lib/same-origin.ts, which
  // reconstructs the public origin from X-Forwarded-Proto/-Host. Every
  // cookie-authenticated POST must call it; tests/origin-guard.spec.ts fails if one
  // is missing. `api/admin/[token]/invites` is exempt on purpose — its authority is
  // a secret in the path, not an ambient cookie, so CSRF cannot reach it.
  //
  // ONE NEW EXPOSURE, currently vacuous: `checkOrigin` also guards Astro Actions
  // (`actions/handler.js`). This project defines none, but a future Action would
  // land at `/_actions/*` with NO origin check and would be invisible to
  // origin-guard.spec.ts, which scans route files under src/pages. If Actions are
  // ever adopted, extend that test's inventory first.
  //
  // This says nothing about `GET /<id>?fresh=1` either way: safe methods were
  // always exempt. That route carries its own Sec-Fetch gate in pages/[id].ts.
  security: {
    checkOrigin: false,
  },
  vite: {
    plugins: [tailwindcss()],
    // Pre-bundle `motion` at server start instead of on first import:
    // Astro component <script>s are not in Vite's initial dep scan, so
    // without this the first dev load discovers motion mid-page-load,
    // re-optimizes (a cold-cache race), and serves a stale module graph —
    // the timeline scrub then only wires up after a manual reload.
    optimizeDeps: {
      include: ["motion"],
    },
    server: {
      allowedHosts: [".trycloudflare.com"],
    },
  },
});
