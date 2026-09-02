# guest-wishes Specification

## Purpose

TBD - created by archiving change guest-submissions. Update Purpose after archive.

## Requirements

### Requirement: One submission per invite

The system SHALL enforce at most one submission per invite, via a database-level `UNIQUE(invite_id)` constraint, and SHALL reject further attempts with `409`.

#### Scenario: First post succeeds

- **WHEN** an invite holder posts via `POST /api/submissions` with a valid cookie and no prior submission
- **THEN** a submission row is created attributed to that invite and the response is `201`

#### Scenario: Second post is rejected

- **WHEN** the same invite posts again (including concurrent attempts racing the constraint)
- **THEN** the response is `409 { "error": "already_posted" }` and no new row exists

#### Scenario: Anonymous post is rejected invisibly

- **WHEN** `POST /api/submissions` is sent without a valid invite cookie
- **THEN** the response is `404` (same body shape as invite-session not-found; endpoint behaves as nonexistent)

### Requirement: Wish text validation

Wish text, when provided, SHALL be trimmed server-side, SHALL be 1–30 characters after trim, and SHALL be rejected otherwise with `400`.

#### Scenario: Blank wish text rejected

- **WHEN** wish text is provided but empty after trim
- **THEN** the response is `400` and no row is created

#### Scenario: Overlong wish rejected

- **WHEN** trimmed wish text exceeds 30 characters
- **THEN** the response is `400` and no row is created

### Requirement: Submission requires content

A submission SHALL contain at least one of wish text or photos; an empty submission SHALL be rejected with `400`.

#### Scenario: Empty submission rejected

- **WHEN** neither wish text nor photos are provided
- **THEN** the response is `400` and no row is created

### Requirement: Wishes readable via the wall

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

### Requirement: Marquee rebuild preserves the loop

When swapping demo content for real wishes, the client SHALL repeat the real list until each row's content width exceeds the track width, duplicate each row's content per the existing two-copy structure, and preserve staggered per-row animation timing.

#### Scenario: One real wish fills the track

- **WHEN** exactly one real wish exists and the marquee swaps to real-only
- **THEN** the wish text repeats across each row's content until the row is wider than the viewport and the scroll loop shows no blank gap

### Requirement: Wishes remain author-free

Wishes SHALL render without author names in every surface (wish marquee, demo and real states), and `GET /api/submissions` SHALL NOT include any invite display name, author field, or timestamp on wish entries. The caller's own submission remains identifiable only through the session (`mine`), never by a name rendered on the marquee.

#### Scenario: No names in wish entries

- **WHEN** any submissions endpoint responds successfully
- **THEN** no wish entry carries an author, name, or display_name field (story entries may carry `firstName` per guest-photos)

#### Scenario: No names rendered on the marquee

- **WHEN** real wishes render on the wish marquee for any visitor
- **THEN** no author attribution is displayed with any wish
