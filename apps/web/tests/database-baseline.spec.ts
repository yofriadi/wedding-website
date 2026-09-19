import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createTestDatabase, DB_ROOT, migrateTestDatabase } from "./support/database";

const tables = ["guest_photos", "invites", "rsvps"];

test("actual migrator creates one current baseline and a repeat preserves rows", async () => {
  const database = createTestDatabase("baseline");
  const db = await database.connect();
  try {
    const names = (
      await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
    ).rows.map((row) => row.name);
    expect(names).toEqual(["__drizzle_migrations", ...tables]);
    expect((await db.execute("SELECT COUNT(*) AS n FROM __drizzle_migrations")).rows[0]?.n).toBe(1);
    const journal = JSON.parse(
      readFileSync(join(DB_ROOT, "src/migrations/meta/_journal.json"), "utf8"),
    );
    expect(journal.entries).toHaveLength(1);
    expect(
      readdirSync(join(DB_ROOT, "src/migrations")).filter((name) => name.endsWith(".sql")),
    ).toEqual(["0000_initial.sql"]);
    expect(
      (await db.execute("PRAGMA table_info(guest_photos)")).rows.map((row) => row.name),
    ).toEqual(["id", "invite_id", "key", "created_at"]);
    expect(
      (await db.execute("PRAGMA index_list(guest_photos)")).rows.map((row) => row.name),
    ).toEqual(
      expect.arrayContaining([
        "guest_photos_invite_id_unique",
        "guest_photos_key_unique",
        "guest_photos_created_at_id_idx",
      ]),
    );
    expect((await db.execute("PRAGMA foreign_key_list(guest_photos)")).rows[0]).toMatchObject({
      table: "invites",
      from: "invite_id",
      to: "id",
    });
    await db.execute(
      "INSERT INTO invites (id, display_name, created_at) VALUES ('Baseline0001', 'Fixture', 1)",
    );
    migrateTestDatabase(database.dbPath);
    expect((await db.execute("SELECT COUNT(*) AS n FROM invites")).rows[0]?.n).toBe(1);
    expect((await db.execute("SELECT COUNT(*) AS n FROM __drizzle_migrations")).rows[0]?.n).toBe(1);
    await db.execute(
      "INSERT INTO guest_photos (id, invite_id, key, created_at) VALUES ('PhotoTest001', 'Baseline0001', 'guest-photos/PhotoTest001/photo.webp', 2)",
    );
    await expect(
      db.execute(
        "INSERT INTO guest_photos VALUES ('PhotoTest002', 'Unknown00001', 'guest-photos/PhotoTest002/photo.webp', 3)",
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);
    await expect(
      db.execute(
        "INSERT INTO guest_photos VALUES ('PhotoTest003', 'Baseline0001', 'guest-photos/PhotoTest003/photo.webp', 3)",
      ),
    ).rejects.toThrow(/UNIQUE/i);
    await db.execute(
      "INSERT INTO invites (id, display_name, created_at) VALUES ('Baseline0002', 'Fixture', 2)",
    );
    await expect(
      db.execute(
        "INSERT INTO guest_photos VALUES ('PhotoTest004', 'Baseline0002', 'guest-photos/PhotoTest001/photo.webp', 3)",
      ),
    ).rejects.toThrow(/UNIQUE/i);
    expect((await db.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
    expect((await db.execute("PRAGMA integrity_check")).rows[0]?.integrity_check).toBe("ok");
  } finally {
    db.close();
    database.dispose();
  }
});

test("migration command refuses a legacy database instead of resetting or silently skipping it", async () => {
  const database = createTestDatabase("legacy-guard");
  const db = await database.connect();
  try {
    await db.execute("CREATE TABLE submissions (id TEXT PRIMARY KEY)");
    await db.execute("INSERT INTO submissions VALUES ('preserve-me')");
    expect(() => migrateTestDatabase(database.dbPath)).toThrow();
    expect((await db.execute("SELECT id FROM submissions")).rows[0]?.id).toBe("preserve-me");
  } finally {
    db.close();
    database.dispose();
  }
});

test("schema generation reports no drift from the committed baseline", () => {
  const before = readFileSync(join(DB_ROOT, "src/migrations/meta/_journal.json"), "utf8");
  const output = execFileSync("pnpm", ["run", "db:generate"], { cwd: DB_ROOT, encoding: "utf8" });
  expect(output).toContain("No schema changes");
  expect(readFileSync(join(DB_ROOT, "src/migrations/meta/_journal.json"), "utf8")).toBe(before);
});

test("mismatched historical ledger is rejected even without retired table names", async () => {
  const database = createTestDatabase("ledger-guard");
  const db = await database.connect();
  try {
    await db.execute(
      "INSERT INTO invites (id, display_name, created_at) VALUES ('Preserve0001', 'Keep me', 1)",
    );
    await db.execute("UPDATE __drizzle_migrations SET hash='old-history'");
    expect(() => migrateTestDatabase(database.dbPath)).toThrow();
    expect((await db.execute("SELECT COUNT(*) AS n FROM invites")).rows[0]?.n).toBe(1);
    expect((await db.execute("SELECT hash FROM __drizzle_migrations")).rows[0]?.hash).toBe(
      "old-history",
    );
  } finally {
    db.close();
    database.dispose();
  }
});
