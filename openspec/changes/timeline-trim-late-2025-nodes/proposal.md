# Proposal: timeline-trim-late-2025-nodes

## Why

The timeline story is being condensed: the three late-2025 beats (26 Oktober 2025, 1 November 2025, 29–30 November 2025) are cut, leaving 28 Juni 2025 (first date) flowing straight into 11 April 2026 (lamaran). Simply deleting the middle nodes would leave an 840vw empty sweep (~57% of the horizontal cruise with no content), breaking the timeline's established uniform rhythm — so the remaining nodes re-tighten to restore it.

## What Changes

- **Remove three story nodes** — node-5 "26 Oktober 2025", node-6 "1 November 2025", node-7 "29–30 November 2025" — from `TimelineScroll.astro`: markup, three connector paths, reveal wiring, and their reduced-motion CSS selector entries.
- **Pull node 8 (11 April 2026) left from 1520vw to 890vw**, restoring the uniform 210vw story gaps; the dot-9 anchor and node-9 labels move from 1670vw to 1040vw, keeping the compact 150vw finale jog. (Chosen over the alternative of leaving a long empty curve between 28 Juni and 11 April: uniform spacing is the timeline's visual contract, and the finale geometry/keyframes stay proportionally intact.)
- **One smooth S-curve from dot-4 to dot-8**, built by the existing `setSmoothIntoNode8` builder (including its <360px narrow-screen guard against node 8's centered card). Connector paths drop from eight to five: line-1…line-4 are the story S-curves, line-5 is the orthogonal V–H–V finale.
- **Runway retune at constant cruise speed** (≈1.12 vw/vh): track 1720vw → 1090vw; section 1813lvh → 1249lvh (1149lvh scrollable = intro 66 + horizontal 753 + jog 104 + descent 150 + expansion 65 + tail 11). Non-horizontal phases and every reveal/pop beat keep their shipped absolute scroll lengths; only the progress fractions re-derive over the shorter runway.
- **Capture harness sync**: `apps/web/scripts/capture-scroll.mjs` mirrors the choreography constants (phase fractions, pan keyframes) and iterates dots/lines by index — updated to the six-dot/five-line layout so the exclusivity, line-clearance, and node-9 hand-off probes keep working.
- **Unused image assets stay.** `october.{avif,jpg,webp}`, `november.{…}`, `november2.{…}` in `apps/web/public` become unreferenced by the timeline but are deliberately left in place (explicit product decision).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `scroll-motion`: three requirements re-scoped —
  - reduced-motion story: node count nine → six;
  - connector requirement: story S-curves are lines 1–4 (dot-4→dot-8 included), finale orthogonal connector is line-5;
  - node-spacing/runway requirement: uniform 210vw gaps on a 1090vw track, 1249lvh runway, cruise speed unchanged, non-horizontal phases keep shipped durations.

## Impact

- **Code**: `apps/web/src/components/TimelineScroll.astro` (the only source consumer of the removed nodes), `apps/web/scripts/capture-scroll.mjs` (mirrored constants and indexed probes).
- **Specs**: MODIFIED delta on `scroll-motion` (three requirements).
- **Risk**: moderate — every progress fraction changes, but the retune derives from one rule (each phase/beat keeps its absolute lvh length; cruise speed constant) and is verified by the capture harness plus a visual pass at 320/375/390/1440 widths.
- **Performance**: slightly better — three fewer nodes, three fewer connector paths, a 630vw narrower track, and a 564lvh shorter runway.
- **Assets**: `apps/web/public/october.*`, `november.*`, `november2.*` become unreferenced and are retained by explicit decision; no deletion in this change.
