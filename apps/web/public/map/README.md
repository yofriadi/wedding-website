# Map popup banner photos

Slot photos for the venue-map-routes popups (~800px-wide source, WebP, <=50KB):

- `tirtonadi.webp` — Terminal Tirtonadi (Terminal) — TBD
- `purwosari.webp` — Stasiun Purwosari (Stasiun) — TBD
- `balapan.webp` — Stasiun Solo Balapan (Stasiun) — TBD
- `soemarmo.webp` — Bandara Adi Soemarmo (Bandara) — TBD
- `selat-solo.webp` — Selat Solo Tenda Biru (Restoran) — landed
- `smk-murni.webp` — SMK Murni 1 Surakarta (Sekolah) — landed
- `graha-58.webp` — Graha 58 Gedung Serbaguna UMS (venue destination) — landed

The three landed photos were linked by the couple via Google Maps and resized
to ~800px WebP. The other four are TBD. Until each file lands,
`VenueMap.astro`'s frontmatter existence filter drops the `image` field and
the popup renders text-only (no broken image banner). After a build, a
post-build deletion is also covered: the runtime `onerror` handler removes
the banner element.
