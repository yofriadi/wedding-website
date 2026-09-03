import type { APIRoute } from "astro";
import { enqueueAvifVariant } from "../../../lib/avif-queue";
import { notFound } from "../../../lib/invite-session";
import {
  avifVariantKey,
  contentTypeForKey,
  isValidPhotoKey,
  readPhoto,
} from "../../../lib/photo-storage";

// Photo route (guest-submissions D4a): serves stored guest photos through
// the app — never a public static dir. public-wall D3: reads are PUBLIC —
// keys are unguessable (submission-scoped, server-generated ids) and photos
// are non-secret by decision, so no invite resolution runs on GET. What
// stays hidden is *which* keys exist, which unguessability already provides.
//
// FORMAT NEGOTIATION (photo-normalization): one URL serves two files. The
// canonical WebP is written during the upload request; an AVIF sibling (~35%
// smaller) is written afterwards by lib/avif-queue.ts. A request that
// explicitly advertises AVIF gets the variant once it exists, the canonical
// WebP while it does not, and the canonical forever if it can never be built.
// The client never learns which happened — no payload change, no <picture>
// sidecar that could 404 (the failure mode StoryViewer.astro warns about) —
// and a browser that cannot decode AVIF is never UPGRADED to one: the fallback
// is always the canonical, and canonicalizePhoto refuses to make AVIF canonical
// precisely so that fallback is safe. (A row stored before normalization could
// still have an `.avif` canonical; it is served as stored, exactly as before.)
//
// Caching is asymmetric on purpose:
//   success → Cache-Control: public, max-age=31536000, immutable
//             (keys are write-once and unguessable, so a shared cache/CDN
//             may serve them) + Vary: Accept, because the body now depends
//             on the request's Accept header
//   404     → no-store (missing files must not be negatively cached)
//
// EDGE-CACHE CAVEAT: Cloudflare's free plan does not vary its cache on Accept
// for images ("Vary for Images" is a paid feature), so adding a free
// Cloudflare cache rule for /api/photos/* would let one visitor's cached AVIF
// be served to a browser that only decodes WebP — a broken image, not a
// fallback. Either pay for Vary for Images or keep this route out of the edge
// cache. Same applies to any proxy that ignores Vary.
export const GET: APIRoute = async ({ params, request }) => {
  const key = params.key ?? "";
  // Multi-segment keys: Astro's [key] param captures the rest of the path
  // only with a rest parameter, so the route file is [...key].ts; normalize
  // the segments back to "submissions/<id>/<file>".
  const segments = Array.isArray(key) ? key : [key];
  const normalizedKey = segments.join("/");

  if (!isValidPhotoKey(normalizedKey)) {
    // Malformed/traversal-attempting keys get the same uniform 404 — never a
    // distinct error that would confirm the endpoint's existence.
    return notFound();
  }

  const photo = await readPhoto(normalizedKey);
  if (!photo) {
    return notFound();
  }

  let servedKey = normalizedKey;
  let bytes = photo.bytes;

  if (acceptsAvif(request.headers.get("accept"))) {
    const variantKey = avifVariantKey(normalizedKey);
    if (variantKey !== null) {
      // readPhoto returns null for a missing file, so the existence check is
      // one wasted syscall — and skipping it shrinks the window in which a
      // concurrent variant write could be observed at all.
      const variant = await readPhoto(variantKey);
      if (variant) {
        servedKey = variantKey;
        bytes = variant.bytes;
      } else {
        // Self-healing backfill: covers a restart mid-encode, a job dropped by
        // the bounded queue, and rows stored before normalization existed.
        // THIS response is still the canonical WebP — the variant lands for
        // whoever asks next. Enqueue is fire-and-forget and never throws.
        enqueueAvifVariant(normalizedKey);
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
};

// Explicit `image/avif` only — never `*/*`. A browser that can decode AVIF
// advertises it on image requests (Chrome 85+, Firefox 93+, Safari 16+, and
// every iOS browser, which is WebKit under the hood); a client sending `*/*`
// (curl, prefetchers, some WebViews) is NOT promising AVIF support, and
// guessing wrong here is a broken image rather than a slightly larger file.
function acceptsAvif(header: string | null): boolean {
  if (!header) return false;
  return header.split(",").some((part) => {
    const [range, ...params] = part.trim().split(";");
    if ((range ?? "").trim().toLowerCase() !== "image/avif") return false;
    const q = params
      .map((param) => param.trim().toLowerCase())
      .find((param) => param.startsWith("q="));
    return q === undefined ? true : Number(q.slice(2)) > 0;
  });
}
