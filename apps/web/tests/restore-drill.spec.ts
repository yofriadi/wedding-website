import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createTestDatabase, WEB_ROOT } from "./support/database";

const script = resolve(WEB_ROOT, "../../ops/restore-drill.sh");
function snapshot(database: ReturnType<typeof createTestDatabase>) {
  const backup = join(database.workDir, "backup");
  mkdirSync(join(backup, "db"), { recursive: true });
  mkdirSync(join(backup, "photos"));
  execFileSync("sqlite3", [database.dbPath, `.backup '${join(backup, "db/local.db")}'`]);
  return backup;
}
function drill(database: ReturnType<typeof createTestDatabase>, backup: string) {
  return spawnSync("bash", [script, backup], { env: database.env, encoding: "utf8" });
}

test("a matching quiescent fresh-baseline snapshot passes", () => {
  const database = createTestDatabase("restore");
  try {
    const backup = snapshot(database);
    writeFileSync(join(database.photosDir, "unpublished.part"), "ignored");
    const result = drill(database, backup);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("PASS:");
  } finally {
    database.dispose();
  }
});

for (const missingOnBoth of [true, false]) {
  test(`missing required table fails rather than comparing n/a (both=${missingOnBoth})`, async () => {
    const database = createTestDatabase("restore-missing");
    const db = await database.connect();
    try {
      if (missingOnBoth) await db.execute("DROP TABLE guest_photos");
      const backup = snapshot(database);
      if (!missingOnBoth) await db.execute("DROP TABLE guest_photos");
      const result = drill(database, backup);
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain("PASS:");
    } finally {
      db.close();
      database.dispose();
    }
  });
}

test("checksum mismatches are failures, not warnings followed by PASS", () => {
  const database = createTestDatabase("restore-checksum");
  try {
    const backup = snapshot(database);
    writeFileSync(join(database.photosDir, "extra.webp"), "different");
    const result = drill(database, backup);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("PASS:");
  } finally {
    database.dispose();
  }
});

test("matching trees missing a referenced canonical still fail", async () => {
  const database = createTestDatabase("restore-reference");
  const db = await database.connect();
  try {
    await db.execute(
      "INSERT INTO invites (id,display_name,created_at) VALUES ('Restore00001','Fixture',1)",
    );
    await db.execute(
      "INSERT INTO guest_photos VALUES ('RestorePhoto','Restore00001','guest-photos/RestorePhoto/photo.webp',1)",
    );
    const result = drill(database, snapshot(database));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing referenced canonical");
  } finally {
    db.close();
    database.dispose();
  }
});

test("backup copies canonical and variants but excludes partial files", async () => {
  const database = createTestDatabase("backup");
  const db = await database.connect();
  try {
    const directory = join(database.photosDir, "guest-photos/RestorePhoto");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "photo.webp"), "canonical fixture");
    writeFileSync(join(directory, "photo.avif"), "variant fixture");
    writeFileSync(join(directory, "photo.avif.part"), "unpublished");
    await db.execute(
      "INSERT INTO invites (id,display_name,created_at) VALUES ('Restore00001','Fixture',1)",
    );
    await db.execute(
      "INSERT INTO guest_photos VALUES ('RestorePhoto','Restore00001','guest-photos/RestorePhoto/photo.webp',1)",
    );
    const destination = join(database.workDir, "backups with spaces");
    mkdirSync(destination);
    for (let day = 1; day <= 31; day++) {
      mkdirSync(join(destination, `2025-01-${String(day).padStart(2, "0")}T000000Z`));
    }
    const result = spawnSync("bash", [resolve(WEB_ROOT, "../../ops/backup.sh")], {
      env: { ...database.env, BACKUP_DEST: destination },
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("OK: backup");
    const { readdirSync } = await import("node:fs");
    const trees = readdirSync(destination).sort();
    expect(trees).toHaveLength(30);
    expect(trees).not.toContain("2025-01-01T000000Z");
    const backup = join(destination, trees.at(-1)!);
    expect(readdirSync(join(backup, "photos/guest-photos/RestorePhoto")).sort()).toEqual([
      "photo.avif",
      "photo.webp",
    ]);
    expect(drill(database, backup).status).toBe(0);
  } finally {
    db.close();
    database.dispose();
  }
});
