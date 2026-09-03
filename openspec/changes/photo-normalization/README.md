# photo-normalization

Guest uploads are re-encoded server-side into one canonical WebP (capped at 2048px on the long edge, all camera metadata stripped) instead of being stored verbatim, and an AVIF sibling is generated in a background queue after the upload responds — then served from the same URL to browsers that advertise AVIF support.

**Why it matters**: before this change a submission stored 2.4–3.0MB PNGs (the committed fixtures are 3824×2484) and the story viewer loaded them full-screen on a phone at the venue. After it, the same submission is ~430KB of WebP and ~290KB of AVIF, and no stored photo can leak the GPS coordinates a camera embedded.

**Archive order**: no dependency on the open changes. `guest-photos` deltas here MODIFY requirements that already exist in the base spec, so this archives independently of `public-wall` and `story-rail-attribution`.
