import type { APIRoute } from "astro";
import { enqueueAvifVariant } from "../../../lib/avif-queue";
import { notFound, serviceUnavailable } from "../../../lib/invite-session";
import {
  avifVariantKey,
  contentTypeForKey,
  isValidPhotoKey,
  readPhoto,
} from "../../../lib/photo-storage";

// Public, photo-scoped immutable files. Shared caches MUST honor Vary: Accept;
// do not enable an image cache rule that ignores negotiated formats.
export const GET: APIRoute = async ({ params, request }) => {
  const key = params.key ?? "";
  if (!isValidPhotoKey(key)) return notFound();
  try {
    const photo = await readPhoto(key);
    if (!photo) return notFound();
    let bytes = photo.bytes;
    let servedKey = key;
    if (acceptsAvif(request.headers.get("accept"))) {
      const variantKey = avifVariantKey(key);
      if (variantKey) {
        const variant = await readPhoto(variantKey);
        if (variant) {
          bytes = variant.bytes;
          servedKey = variantKey;
        } else {
          enqueueAvifVariant(key); // Serve WebP now; retry dropped/interrupted work.
        }
      }
    }
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentTypeForKey(servedKey),
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
        Vary: "Accept",
      },
    });
  } catch (error) {
    console.error("[photos] file read failed:", error);
    return serviceUnavailable();
  }
};

function acceptsAvif(header: string | null): boolean {
  if (!header) return false;
  return header.split(",").some((part) => {
    const [range, ...parameters] = part.trim().split(";");
    if (range?.trim().toLowerCase() !== "image/avif") return false;
    const q = parameters
      .map((parameter) => parameter.trim().toLowerCase())
      .find((parameter) => parameter.startsWith("q="));
    if (q === undefined) return true;
    const weight = Number(q.slice(2));
    return weight > 0 && weight <= 1;
  });
}
