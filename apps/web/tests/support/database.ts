import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type Client } from "@libsql/client";

export const WEB_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const DB_ROOT = resolve(WEB_ROOT, "../../packages/db");
export const TEST_ADMIN_TOKEN = "test-only-admin-token-not-for-production-123";

export function migrateTestDatabase(dbPath: string): void {
  execFileSync(process.execPath, [resolve(DB_ROOT, "scripts/migrate.mjs")], {
    cwd: DB_ROOT,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}`, DATABASE_AUTH_TOKEN: "" },
    stdio: "pipe",
  });
}

// No caller-supplied path: all test database/storage targets are new OS temp dirs.
export function createTestDatabase(label = "database") {
  const workDir = mkdtempSync(join(tmpdir(), `ww-${label}-`));
  const dbPath = join(workDir, "test.sqlite");
  const photosDir = join(workDir, "photos");
  mkdirSync(photosDir);
  try {
    migrateTestDatabase(dbPath);
  } catch (error) {
    rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
  return {
    workDir,
    dbPath,
    photosDir,
    env: {
      ...process.env,
      DATABASE_URL: `file:${dbPath}`,
      DATABASE_AUTH_TOKEN: "",
      PHOTO_STORAGE_DIR: photosDir,
      INVITE_ADMIN_TOKEN: TEST_ADMIN_TOKEN,
      NODE_ENV: "test",
    },
    async connect(): Promise<Client> {
      const client = createClient({ url: `file:${dbPath}` });
      await client.execute("PRAGMA foreign_keys=ON");
      return client;
    },
    dispose() {
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}

export type TestDatabase = ReturnType<typeof createTestDatabase>;
