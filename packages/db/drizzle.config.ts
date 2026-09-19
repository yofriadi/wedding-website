import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

const webRoot = fileURLToPath(new URL("../../apps/web/", import.meta.url));
dotenv.config({ path: resolve(webRoot, ".env"), quiet: true });
const configuredUrl = process.env.DATABASE_URL || "";

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: configuredUrl.startsWith("file:")
      ? `file:${resolve(webRoot, configuredUrl.slice(5))}`
      : configuredUrl,
  },
});
