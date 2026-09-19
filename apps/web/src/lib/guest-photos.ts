export const PHOTO_ID_LENGTH = 12;
export const PHOTO_ID_RE = /^[A-Za-z0-9_-]{12}$/;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// A separate random identifier: public photo URLs never contain invitation IDs.
export function generatePhotoId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PHOTO_ID_LENGTH));
  return Array.from(bytes, (byte) => ALPHABET[byte & 63]).join("");
}

export interface GuestPhoto {
  id: string;
  photoUrl: string;
  createdAt: number;
}

export interface GuestPhotosPayload {
  inviteValid: boolean;
  mineId: string | null;
  photos: GuestPhoto[];
}
