import { createClient, type Client } from "@libsql/client";
import { expect, test } from "@playwright/test";
import { createLazyClient } from "@wedding-website/db/client";

const empty = {
  rows: [],
  columns: [],
  columnTypes: [],
  rowsAffected: 0,
  lastInsertRowid: undefined,
  toJSON: () => ({}),
};

test("lazy initialization retries a failed pragma rather than retaining a poisoned client", async () => {
  let attempts = 0;
  let queries = 0;
  let closes = 0;
  const client = createLazyClient(() => {
    const attempt = ++attempts;
    return {
      async execute(sql: string) {
        if (sql === "PRAGMA foreign_keys=ON") {
          if (attempt === 1) throw new Error("temporary outage");
        } else queries++;
        return empty;
      },
      close() {
        closes++;
      },
    } as unknown as Client;
  });
  expect(attempts).toBe(0);
  const execute = client.execute;
  await expect(execute("SELECT 1")).rejects.toThrow("temporary outage");
  expect(queries).toBe(0);
  expect(closes).toBe(1);
  await execute("SELECT 1");
  expect(attempts).toBe(2);
  expect(queries).toBe(1);
  client.close();
});

test("application client actually enforces foreign keys on the first write", async () => {
  const client = createLazyClient(() => createClient({ url: "file::memory:" }));
  try {
    await client.execute("CREATE TABLE parent (id TEXT PRIMARY KEY)");
    await client.execute("CREATE TABLE child (parent_id TEXT REFERENCES parent(id))");
    await expect(client.execute("INSERT INTO child VALUES ('missing')")).rejects.toThrow(
      /FOREIGN KEY/i,
    );
    expect((await client.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
  } finally {
    client.close();
  }
});
