// @ts-check
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
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
