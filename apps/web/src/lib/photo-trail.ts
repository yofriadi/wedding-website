import type { GuestPhotosPayload } from "./guest-photos";

/** Every distinct guest photo URL, in server order — nothing else. */
export function selectTrailImages(data: GuestPhotosPayload | null): string[] {
  const seen = new Set<string>();
  return (data?.photos ?? [])
    .map((photo) => photo.photoUrl)
    .filter((source) => {
      if (!source || seen.has(source)) return false;
      seen.add(source);
      return true;
    });
}
