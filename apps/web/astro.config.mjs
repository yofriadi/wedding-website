// @ts-check
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

const isLocal = process.env.LOCAL_DEV === "true";

const getAdapter = async () => {
  if (isLocal) {
    const node = await import("@astrojs/node");
    return node.default({ mode: "standalone" });
  } else {
    const alchemy = await import("alchemy/cloudflare/astro");
    return alchemy.default();
  }
};

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: await getAdapter(),
  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts: ["bore.pub"],
    },
  },
});
