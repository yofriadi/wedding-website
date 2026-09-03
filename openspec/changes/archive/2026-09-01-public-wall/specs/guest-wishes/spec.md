# guest-wishes Spec Delta

## MODIFIED Requirements

### Requirement: Wishes readable by invitees only

Renamed: **Wishes readable via the wall**

The system SHALL expose `GET /api/submissions` returning real wishes to ALL callers, ordered newest-first, with no author attribution. Anonymous callers receive `mine: null` (posting stays invite-only); cookie holders receive `mine` as their own submission or null.

- **WHEN** `GET /api/submissions` is sent with a valid invite cookie
- **THEN** the response is `200` with `wall.wishes` an array of `{ text }` ordered newest-first, and `mine` the caller's own submission or null, where `mine` is `{ id: string, wishText: string | null, photos: [{ photoUrl: string }] }` (photo entries ordered by position) or `null`
- **AND** `wall.stories` is an array of submissions, newest-first, each `{ photos: [{ photoUrl: string }] }` (positions are per-submission and not exposed on the wall)

#### Scenario: Anonymous read returns the wall

- **WHEN** `GET /api/submissions` is sent without a valid invite cookie
- **THEN** the response is `200` with `mine: null` and the same `wall` content cookie holders receive

### Requirement: Wish marquee display states

The wish marquee SHALL implement: demo + leading "Be the first to leave a wish ✨" card (zero real wishes, any visitor), real-only (≥1 real wish, any visitor).

#### Scenario: Public visitor with zero real wishes

- **WHEN** a visitor without a cookie views the marquee before any invitee has posted
- **THEN** demo wishes render with a leading "Be the first to leave a wish ✨" card, and one fetch to `/api/submissions` occurs (the zero-request guarantee is retired)

#### Scenario: Invitee with zero real wishes

- **WHEN** a cookie holder views the marquee before any invitee has posted
- **THEN** demo wishes render with a leading "Be the first to leave a wish ✨" card

#### Scenario: Any visitor after the first real wish exists

- **WHEN** any visitor views the marquee and at least one real wish exists
- **THEN** only real wishes render (demo content evicted)

#### Scenario: Returning poster sees their posted state

- **WHEN** a cookie holder who already posted loads the page
- **THEN** the add-story entry is not shown and `mine` reflects their submission
