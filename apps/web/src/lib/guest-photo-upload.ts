import type { GuestPhoto } from "./guest-photos";
import type { PhotoReservation } from "./photo-storage";

export interface PhotoRow {
  id: string;
  inviteId: string;
  key: string;
  createdAt: number;
}

export interface PhotoPublisher {
  reserve(): Promise<PhotoReservation>;
  insert(row: PhotoRow): Promise<void>;
  findAttempt(id: string, key: string): Promise<PhotoRow | null>;
  enqueue(key: string): void;
  log(message: string, error: unknown): void;
}

type PublishResult =
  | { status: "accepted"; photo: GuestPhoto }
  | { status: "duplicate" }
  | { status: "unavailable" };

function errorChain(error: unknown): { code: string; message: string }[] {
  const result: { code: string; message: string }[] = [];
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    const current = error as { code?: unknown; message?: unknown; cause?: unknown };
    result.push({ code: String(current.code ?? ""), message: String(current.message ?? "") });
    error = current.cause;
  }
  return result;
}

export function isInvitePhotoConflict(error: unknown): boolean {
  return errorChain(error).some(({ message }) =>
    /UNIQUE constraint failed: guest_photos\.invite_id(?:\s|$)/i.test(message),
  );
}

function isDefinitiveConstraint(error: unknown): boolean {
  return errorChain(error).some(
    ({ code, message }) =>
      code.startsWith("SQLITE_CONSTRAINT") ||
      /(?:UNIQUE|FOREIGN KEY|NOT NULL|CHECK) constraint failed/i.test(message),
  );
}

// The file is complete before publication. Injecting the small persistence/storage
// boundary lets failure tests exercise real ordering without live-database hooks.
export async function publishGuestPhoto(
  inviteId: string,
  bytes: Uint8Array,
  dependencies: PhotoPublisher,
): Promise<PublishResult> {
  let reservation: PhotoReservation;
  try {
    reservation = await dependencies.reserve();
  } catch (error) {
    dependencies.log("directory reservation failed", error);
    return { status: "unavailable" };
  }

  const cleanup = async () => {
    try {
      await reservation.remove();
    } catch (error) {
      dependencies.log(`cleanup failed for photo ${reservation.id}`, error);
    }
  };

  try {
    await reservation.write(bytes);
  } catch (error) {
    dependencies.log("canonical write failed", error);
    await cleanup();
    return { status: "unavailable" };
  }

  let row: PhotoRow = {
    id: reservation.id,
    inviteId,
    key: reservation.key,
    createdAt: Date.now(),
  };
  try {
    await dependencies.insert(row);
  } catch (error) {
    if (isDefinitiveConstraint(error)) {
      await cleanup();
      if (isInvitePhotoConflict(error)) return { status: "duplicate" };
      dependencies.log("photo insert rejected", error);
      return { status: "unavailable" };
    }

    // A remote response can fail after commit. Never delete a possibly accepted
    // immutable URL until this exact attempt's outcome is established.
    try {
      const persisted = await dependencies.findAttempt(row.id, row.key);
      if (!persisted) {
        await cleanup();
        dependencies.log("photo insert failed without publication", error);
        return { status: "unavailable" };
      }
      if (
        persisted.id !== row.id ||
        persisted.key !== row.key ||
        persisted.inviteId !== row.inviteId
      ) {
        dependencies.log(`unresolved photo ownership for ${row.id}; files retained`, error);
        return { status: "unavailable" };
      }
      row = persisted;
    } catch (readError) {
      dependencies.log(`unresolved photo insert for ${row.id}; files retained`, readError);
      return { status: "unavailable" };
    }
  }

  // Nothing after publication is allowed to roll back the accepted row or files.
  try {
    dependencies.enqueue(row.key);
  } catch (error) {
    dependencies.log("variant enqueue failed after publication", error);
  }
  return {
    status: "accepted",
    photo: { id: row.id, photoUrl: `/api/photos/${row.key}`, createdAt: row.createdAt },
  };
}
