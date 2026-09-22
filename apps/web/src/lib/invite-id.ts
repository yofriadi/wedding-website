export const INVITE_ID_LENGTH = 12;
export const INVITE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// Shared by every path that mints an `invites.id`, so admin-create and group
// claim cannot drift on retry policy.
export const INVITE_ID_MAX_ATTEMPTS = 5;

// Shared by admin invite creation and group slot claiming so the two cannot
// drift apart — both mint ids for the same `invites.id` keyspace.
export function generateInviteId() {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error("crypto.getRandomValues is not available");
  }

  const bytes = new Uint8Array(INVITE_ID_LENGTH);
  cryptoObj.getRandomValues(bytes);

  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === undefined) {
      throw new Error("Failed to generate invite ID");
    }
    out += INVITE_ALPHABET.charAt(byte & 63);
  }
  return out;
}

interface ChainEntry {
  code: string;
  extendedCode: string;
  message: string;
}

function errorChain(error: unknown): ChainEntry[] {
  const result: ChainEntry[] = [];
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    const current = error as {
      code?: unknown;
      extendedCode?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    result.push({
      code: String(current.code ?? ""),
      // The local `file:` driver reports the BASE code in `.code`
      // (`SQLITE_CONSTRAINT`) and the specific one in `.extendedCode`
      // (`SQLITE_CONSTRAINT_PRIMARYKEY`); the remote hrana driver passes the
      // extended code through as `.code`. Both supported deployments must be
      // read or this check is dead on one of them.
      extendedCode: String(current.extendedCode ?? ""),
      message: String(current.message ?? ""),
    });
    error = current.cause;
  }
  return result;
}

// Only these mean "another row already holds this exact id". A CHECK, FK or
// NOT-NULL rejection carries the same SQLITE_CONSTRAINT base code but a
// different extended code, and must fail fast instead of burning retries.
const ID_COLLISION_CODES = new Set(["SQLITE_CONSTRAINT_PRIMARYKEY", "SQLITE_CONSTRAINT_UNIQUE"]);

// ANCHORED ON PURPOSE — and the anchor is only one of three belts. A real
// collision produces a three-link chain, and each link matches differently:
//
//   [0] DrizzleQueryError — its message is `Failed query: <sql>\nparams:
//       <params>`, and <params> contains the GUEST-SUPPLIED displayName. An
//       unanchored search here would let a guest name themselves "UNIQUE
//       constraint failed: invites.id" and turn every SQLITE_BUSY into a phantom
//       collision — five re-executions of the guarded insert against a database
//       that is already failing. `^` excludes this link, because the wrapper's
//       message always begins "Failed query:".
//   [1] LibsqlError — its constructor PREPENDS the code, so the message reads
//       "SQLITE_CONSTRAINT: UNIQUE constraint failed: invites.id" and the anchor
//       does NOT match. This link is caught by `extendedCode` on the local
//       `file:` driver, or by `code` on the remote hrana driver (which passes
//       the extended code through as `code`).
//   [2] the native driver error, attached as `cause` — bare message, so both
//       the anchor and the code match.
//
// So the message branch is the INNERMOST-error belt, and the code branches are
// what actually carry the configured local driver. Keep all three: dropping
// `extendedCode` would silently remove the only working signal on `file:`.
const ID_COLLISION_MESSAGE = /^UNIQUE constraint failed: invites\.id\b/i;

// PRECISE ON PURPOSE — retrying with a fresh id is only ever correct for a real
// `invites.id` collision. The previous admin classifier matched four loose
// substrings (`"UNIQUE" || "constraint" || "PRIMARYKEY" || "SQLITE_CONSTRAINT"`),
// which would swallow the group CHECK/FK failures this schema adds into five
// pointless retries and an opaque 500. Anything that is not an id collision must
// fail fast (mirrors `guest-photo-upload.ts`'s exact-regex + definitive-constraint
// split).
export function isInviteIdCollision(error: unknown): boolean {
  return errorChain(error).some(
    ({ code, extendedCode, message }) =>
      ID_COLLISION_CODES.has(code) ||
      ID_COLLISION_CODES.has(extendedCode) ||
      ID_COLLISION_MESSAGE.test(message),
  );
}

// Drizzle's wrapper message embeds the bound parameters, which include the
// guest's display name — private per ops/MODERATION.md. Log the driver-level
// cause instead of the wrapper.
export function redactInviteError(error: unknown): unknown {
  const cause = (error as { cause?: unknown } | null)?.cause;
  return cause ?? error;
}
