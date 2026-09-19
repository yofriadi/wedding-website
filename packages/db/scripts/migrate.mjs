import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const webRoot = resolve(packageRoot, "../../apps/web");
dotenv.config({ path: resolve(webRoot, ".env"), quiet: true });
const configuredUrl = process.env.DATABASE_URL;
if (!configuredUrl)
  throw new Error("DATABASE_URL is required; select an explicit database target.");
const url = configuredUrl.startsWith("file:")
  ? `file:${resolve(webRoot, configuredUrl.slice(5))}`
  : configuredUrl;
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
const folder = resolve(packageRoot, "src/migrations");

try {
  // This baseline cannot upgrade the retired submission schema. Refuse it before
  // running DDL, even if its old migration timestamps would cause a silent skip.
  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  );
  const names = tables.rows.map((row) => String(row.name));
  const journal = JSON.parse(await readFile(resolve(folder, "meta/_journal.json"), "utf8"));
  const hashes = await Promise.all(
    journal.entries.map(async (entry) =>
      createHash("sha256")
        .update(await readFile(resolve(folder, `${entry.tag}.sql`)))
        .digest("hex"),
    ),
  );
  const applied = names.includes("__drizzle_migrations")
    ? (await client.execute("SELECT hash FROM __drizzle_migrations ORDER BY created_at")).rows.map(
        (row) => String(row.hash),
      )
    : [];
  const incompatible =
    names.some((name) => name === "submissions" || name === "submission_photos") ||
    (applied.length === 0 && names.some((name) => name !== "__drizzle_migrations")) ||
    applied.some((hash, index) => hash !== hashes[index]);
  if (incompatible) {
    throw new Error(
      "Existing database is not compatible with the guest-photo baseline. Nothing was migrated. Use a new empty target, or obtain a data-preserving migration plan. See ops/README.md; do not reset this database automatically.",
    );
  }
  await client.execute("PRAGMA foreign_keys=ON");
  await migrate(drizzle(client), { migrationsFolder: folder });
  console.log("Database migrations applied (existing matching migrations are a no-op).");
} finally {
  client.close();
}
