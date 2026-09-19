import type { GuestPhotosPayload } from "./guest-photos";
export type { GuestPhoto, GuestPhotosPayload } from "./guest-photos";

export const GUEST_PHOTO_POSTED_EVENT = "guest-photos:posted";
let cached: Promise<GuestPhotosPayload | null> | null = null;

// Keep the runtime contract strict: an old/malformed payload must never authorize
// the picker. No optional fields or compatibility with retired story payloads.
function isPayload(value: unknown): value is GuestPhotosPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<GuestPhotosPayload>;
  return (
    typeof payload.inviteValid === "boolean" &&
    (payload.mineId === null || typeof payload.mineId === "string") &&
    Array.isArray(payload.photos) &&
    payload.photos.every(
      (photo) =>
        photo &&
        typeof photo.id === "string" &&
        typeof photo.photoUrl === "string" &&
        Number.isFinite(photo.createdAt),
    ) &&
    (payload.inviteValid || payload.mineId === null) &&
    (payload.mineId === null || payload.photos.some((photo) => photo.id === payload.mineId))
  );
}

export function loadGuestPhotos(): Promise<GuestPhotosPayload | null> {
  if (cached) return cached;
  const request = (async () => {
    try {
      const response = await fetch("/api/guest-photos", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return null;
      const payload: unknown = await response.json();
      return isPayload(payload) ? payload : null;
    } catch {
      return null;
    }
  })();
  cached = request;
  void request.then((payload) => {
    // An old failed request must not clear a newer post-invalidation request.
    if (payload === null && cached === request) cached = null;
  });
  return request;
}

export function invalidateGuestPhotos(): void {
  cached = null;
}
