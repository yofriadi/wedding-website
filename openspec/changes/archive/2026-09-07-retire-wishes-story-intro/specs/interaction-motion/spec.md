## REMOVED Requirements

### Requirement: Wish marquee is pausable in its real state and smooths state changes

**Reason**: The wish marquee (`WishMarquee.astro`) is deleted along with the wishes feature. There is no marquee band to pause, cross-fade between states, or rebuild.

**Migration**: None. The `#wishes-section` band and its scroll/pause behavior are removed from `index.astro`; no other surface has marquee motion.
