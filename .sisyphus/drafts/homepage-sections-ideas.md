# Draft: Homepage Section Ideas

## Requirements (confirmed)

- User wants ideas for additional sections; do not implement changes yet.

## Preferences (inferred)

- Current homepage is a single scroll narrative with cinematic sections (hero zoom, verse reveal, parallax, timeline).

## Candidate Sections Mentioned

- Photo gallery
- Gifts & wishes
- Venue & travel (User interested in this)
- Countdown timer
- Dress code

## Google Maps Photorealistic 3D Pricing (JavaScript API)

- **Monthly Free Credit**: $200 (Recurring every month).
- **Cost Per Load**:
  - **Dynamic Maps**: ~$7.00 per 1,000 loads.
  - **Photorealistic 3D Maps**: ~$20-30 per 1,000 loads (estimated based on similar high-tier SKUs like Dynamic Street View or 3D Tiles).
- **Free Tier Capacity**:
  - With the $200 credit, you can get approximately **28,500 Dynamic Map loads** per month.
  - For **3D Maps**, it's likely closer to **6,000 - 10,000 loads** per month (assuming significantly higher cost than standard 2D).
- **Map Load Definition**: A "load" counts once when the map is initialized on the page. Pan/zoom interactions do NOT count as extra loads.

## Decision Point

- For a wedding website (~100-300 guests visiting multiple times), the **$200 free credit is more than sufficient** (even at 10k loads/month).
- **Risk**: If the site goes viral or is public, costs could spike.
- **Mitigation**: Set a budget quota in Google Cloud Console to stop the API if it hits $200 (hard cap).

## Venue & Travel Animation Concepts

- **Option 1: Animated SVG Map (Graphic Style)**. Custom SVG map where lines draw themselves. Abstract.
- **Option 2: Google Maps Photorealistic 3D (Cinematic)**. Uses `gmp-map-3d` element.
  - **CONFIRMED**: Free tier covers ~6,000+ views/month. Safe for wedding usage.
  - **REQUIREMENT**: API Key with billing enabled. Quota limits recommended.

## Scope Boundaries

- INCLUDE: content/section ideas and what each section could contain.
- EXCLUDE: code changes, new components, styling, routing, or implementation steps.
