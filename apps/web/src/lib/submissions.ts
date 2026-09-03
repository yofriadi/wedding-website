// Shared helpers for the guest-submissions endpoints. Everything here is
// invite-session scoped: no author/name fields exist anywhere in these
// payloads by product decision (design D1a) — the caller's own submission is
// identified via the session, never by name.

export const SUBMISSION_ID_LENGTH = 12;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// Same generator shape as the invites admin route (12 chars, full alphabet
// masked to 6 bits — same collision math as the existing invite ids).
export function generateSubmissionId(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error("crypto.getRandomValues is not available");
  }

  const bytes = new Uint8Array(SUBMISSION_ID_LENGTH);
  cryptoObj.getRandomValues(bytes);

  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === undefined) {
      throw new Error("Failed to generate submission ID");
    }
    out += ALPHABET.charAt(byte & 63);
  }
  return out;
}

export const WISH_TEXT_MAX_CHARS = 30;

// Trim server-side; returns null for "no wish text" (absent/blank), so the
// at-least-one-content rule can treat blank text as no text. A non-blank trim
// result is validated for length by the caller.
export function normalizeWishText(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return { ok: false };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  if (trimmed.length > WISH_TEXT_MAX_CHARS) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}
