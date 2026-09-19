import { expect, test } from "@playwright/test";
import {
  publishGuestPhoto,
  isInvitePhotoConflict,
  type PhotoPublisher,
  type PhotoRow,
} from "../src/lib/guest-photo-upload";

function fixture() {
  const events: string[] = [];
  let row: PhotoRow | null = null;
  let removeCount = 0;
  const deps: PhotoPublisher = {
    async reserve() {
      events.push("reserve");
      return {
        id: "PhotoTest001",
        key: "guest-photos/PhotoTest001/photo.webp",
        async write() {
          events.push("write");
        },
        async remove() {
          removeCount++;
          events.push("remove");
        },
      };
    },
    async insert(value) {
      events.push("insert");
      row = value;
    },
    async findAttempt() {
      events.push("reconcile");
      return row;
    },
    enqueue() {
      events.push("enqueue");
    },
    log(message) {
      events.push(`log:${message}`);
    },
  };
  return {
    deps,
    events,
    get row() {
      return row;
    },
    get removeCount() {
      return removeCount;
    },
  };
}
const bytes = new Uint8Array([1, 2, 3]);

test("canonical completion precedes publication, and queue failure cannot roll back", async () => {
  const f = fixture();
  f.deps.enqueue = () => {
    throw new Error("queue unavailable");
  };
  const result = await publishGuestPhoto("InviteTest01", bytes, f.deps);
  expect(result.status).toBe("accepted");
  expect(f.events.slice(0, 3)).toEqual(["reserve", "write", "insert"]);
  expect(f.removeCount).toBe(0);
  expect(f.row).not.toBeNull();
});

test("an in-progress file write is not published", async () => {
  const f = fixture();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reserve = f.deps.reserve;
  f.deps.reserve = async () => ({
    ...(await reserve()),
    async write() {
      await waiting;
    },
  });
  const pending = publishGuestPhoto("InviteTest01", bytes, f.deps);
  await Promise.resolve();
  await Promise.resolve();
  expect(f.row).toBeNull();
  release();
  expect((await pending).status).toBe("accepted");
});

test("storage failures release only the owned directory without claiming a row", async () => {
  const f = fixture();
  const reserve = f.deps.reserve;
  f.deps.reserve = async () => ({
    ...(await reserve()),
    async write() {
      throw new Error("disk full");
    },
  });
  expect((await publishGuestPhoto("InviteTest01", bytes, f.deps)).status).toBe("unavailable");
  expect(f.removeCount).toBe(1);
  expect(f.row).toBeNull();
});

for (const column of ["invite_id", "key", "id"]) {
  test(`only invite uniqueness is a duplicate: ${column}`, async () => {
    const f = fixture();
    f.deps.insert = async () => {
      throw new Error("query failed", {
        cause: Object.assign(new Error(`UNIQUE constraint failed: guest_photos.${column}`), {
          code: "SQLITE_CONSTRAINT_UNIQUE",
        }),
      });
    };
    expect((await publishGuestPhoto("InviteTest01", bytes, f.deps)).status).toBe(
      column === "invite_id" ? "duplicate" : "unavailable",
    );
    expect(f.removeCount).toBe(1);
    expect(f.events).not.toContain("reconcile");
  });
}

test("foreign key and arbitrary failures are never misreported as already posted", () => {
  expect(isInvitePhotoConflict(new Error("FOREIGN KEY constraint failed"))).toBe(false);
  expect(isInvitePhotoConflict(new Error("SQLITE_BUSY"))).toBe(false);
  expect(isInvitePhotoConflict(new Error("UNIQUE constraint failed: guest_photos.key"))).toBe(
    false,
  );
});

test("commit followed by response error reconciles the exact row and keeps its files", async () => {
  const f = fixture();
  const insert = f.deps.insert;
  f.deps.insert = async (row) => {
    await insert(row);
    throw new Error("connection lost after commit");
  };
  expect((await publishGuestPhoto("InviteTest01", bytes, f.deps)).status).toBe("accepted");
  expect(f.events).toContain("reconcile");
  expect(f.removeCount).toBe(0);
});

test("confirmed absence cleans up, but unavailable reconciliation preserves files", async () => {
  for (const unresolved of [false, true]) {
    const f = fixture();
    f.deps.insert = async () => {
      throw new Error("connection lost");
    };
    if (unresolved)
      f.deps.findAttempt = async () => {
        throw new Error("still unavailable");
      };
    expect((await publishGuestPhoto("InviteTest01", bytes, f.deps)).status).toBe("unavailable");
    expect(f.removeCount).toBe(unresolved ? 0 : 1);
    expect(f.events.some((event) => event.startsWith("log:"))).toBe(true);
  }
});

test("reconciliation cannot adopt someone else's ID/key ownership", async () => {
  const f = fixture();
  f.deps.insert = async () => {
    throw new Error("unknown outcome");
  };
  f.deps.findAttempt = async () => ({
    id: "PhotoTest001",
    key: "guest-photos/PhotoTest001/photo.webp",
    inviteId: "Another00001",
    createdAt: 1,
  });
  expect((await publishGuestPhoto("InviteTest01", bytes, f.deps)).status).toBe("unavailable");
  expect(f.removeCount).toBe(0);
});

test("cleanup failure is logged and never changes the result to success", async () => {
  const f = fixture();
  const reserve = f.deps.reserve;
  f.deps.reserve = async () => ({
    ...(await reserve()),
    async remove() {
      throw new Error("permissions");
    },
  });
  f.deps.insert = async () => {
    throw new Error("FOREIGN KEY constraint failed");
  };
  expect((await publishGuestPhoto("InviteTest01", bytes, f.deps)).status).toBe("unavailable");
  expect(f.events.some((event) => event.includes("cleanup failed"))).toBe(true);
});
