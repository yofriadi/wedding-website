## REMOVED Requirements

### Requirement: One submission per invite

**Reason**: Relocated verbatim to the `guest-photos` capability. It is a submission-level invariant (post-once via `UNIQUE(invite_id)`) independent of wishes, and `guest-wishes` is being retired.

**Migration**: The identical requirement (and its three scenarios) now lives in `guest-photos`; no behavior change.

### Requirement: Wish text validation

**Reason**: Wishes are removed end-to-end. There is no wish input in the add-story flow and no `wishText` field on `POST /api/submissions`, so there is nothing to validate.

**Migration**: None. `normalizeWishText`/`WISH_TEXT_MAX_CHARS` are deleted from `lib/submissions.ts`; the `invalid_wish_text` error code is removed.

### Requirement: Submission requires content

**Reason**: Relocated and narrowed to `guest-photos` as `Submission requires photos`. With wishes gone, "at least one of wish or photos" collapses to "at least one photo".

**Migration**: See `guest-photos` → `Submission requires photos`. `empty_submission` now means zero photos.

### Requirement: Wishes readable via the wall

**Reason**: Wishes are removed. `GET /api/submissions` no longer returns `wall.wishes` or `mine.wishText`; no surface renders wishes.

**Migration**: The payload's story/photo fields are unchanged; only the wish fields are dropped. Clients read `wall.stories` and `mine.photos` as before.

### Requirement: Wish marquee display states

**Reason**: The wish marquee (`WishMarquee.astro`) is deleted. There is no marquee surface and no wish content to display in any state.

**Migration**: None. The `#wishes-section` band and its `--wishes-*` tokens are removed from `index.astro`.

### Requirement: Marquee rebuild preserves the loop

**Reason**: The wish marquee is deleted; there is no scrolling loop to rebuild.

**Migration**: None.

### Requirement: Wishes remain author-free

**Reason**: Wishes are removed entirely, so the "wishes carry no author" invariant is moot. Story attribution (first name on story tiles) is owned by `guest-photos` and is unaffected.

**Migration**: None. No wish entries exist in the payload after this change.
