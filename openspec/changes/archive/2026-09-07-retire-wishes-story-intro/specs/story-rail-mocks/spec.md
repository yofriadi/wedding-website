## MODIFIED Requirements

### Requirement: Mock tiles evict live on the first real story

The client SHALL remove all mock tiles without a page reload once the fresh submissions payload contains any real story — the caller's own or the wall's — both at initial load and on the `submissions:posted` re-sync. Mock removal SHALL leave no side effects: no body-portaled modal element, no scroll lock, no live timers. (With the public wall, all visitors run this client eviction path — anonymous and invitee alike — since all visitors now fetch the payload.) The always-present example intro (see "Example stories play as a first-tap intro") SHALL NOT be a mock tile and SHALL NOT be evicted.

#### Scenario: Anonymous visitor's rail evicts mocks on load

- **WHEN** an anonymous visitor's page shows SSR mocks (empty-wall gate) and the fetched payload contains any real story
- **THEN** the client removes every mock tile with no side effects, and the wall tiles render in its place

#### Scenario: Posting guest's mocks evict without reload

- **WHEN** a guest successfully posts a submission with photos
- **THEN** mock tiles are removed from the rail in the same session and real guest tiles render in the rail

#### Scenario: Every submission has photos, so any post evicts mocks

- **WHEN** any submission exists (submissions are photo-only after wishes are retired)
- **THEN** mock tiles are removed — there is no content-only submission that leaves mocks in place

#### Scenario: Race between SSR and client fetch

- **WHEN** mocks were server-rendered but another guest posted photos before this client's submissions fetch resolves
- **THEN** the client removes the mock tiles at initial load

#### Scenario: Eviction while a mock's story is open

- **WHEN** mock eviction runs while a mock tile's story modal is open
- **THEN** the modal is removed, body scroll is restored, and no progress timers keep running on detached elements

### Requirement: Mocks are honest interactive previews

Mock tiles SHALL behave as real story tiles: tap/click opens the story modal with working progress, gesture, and keyboard navigation, and rail hand-off (`story-viewer-end` / `story-viewer-prev`) traverses them in rail order. Each mock carries exactly one story, so advancing past its only slide SHALL hand off to the next story viewer in rail order, and reversing at its only slide SHALL hand off to the previous story viewer at its last slide. The story modal header for an unnamed tile (mocks, and real entries whose first name is null) SHALL render an empty attribution slot — no placeholder text — while preserving the header layout so the close button stays right-aligned. Mocks SHALL use only existing public image assets (no new asset pipeline) and SHALL NOT trigger any submissions-endpoint request of their own (the page's one shared per-load fetch — public-wall change — is not a per-mock request).

#### Scenario: Mock opens the story modal

- **WHEN** a visitor activates a mock tile
- **THEN** the story modal opens and plays the mock's single story like any other tile, with an empty attribution slot in the header (no "Guest story" text) and the close button right-aligned

#### Scenario: Hand-off traverses mocks

- **WHEN** a mock's only slide advances past its end
- **THEN** viewing hands off to the next mock tile in rail order
- **AND WHEN** a mock's only slide is reversed at its first slide
- **THEN** viewing hands off to the previous mock tile at its last slide

## ADDED Requirements

### Requirement: Example stories play as a first-tap intro

Independently of the empty-wall mock gate, the page SHALL always render a hidden example story viewer containing the three `/story_example_{1,2,3}.webp` cards so the informational examples remain reachable after real stories have evicted the rail mocks. This intro viewer SHALL NOT carry `data-mock` and SHALL NOT participate in rail hand-off (the hand-off orchestrator SHALL scope its traversal to viewers inside the rail container). The add-story tile's first activation SHALL play this intro and then open the add-story flow, per the add-story-flow capability.

#### Scenario: Examples reachable on a non-empty wall

- **WHEN** the wall has real stories (rail mocks are gone) and an eligible invitee taps the add-story tile for the first time
- **THEN** the three example stories play from the always-present hidden intro viewer, then the flow opens

#### Scenario: Intro is not evicted and not chained

- **WHEN** the client evicts rail mocks after a real story appears
- **THEN** the intro viewer remains in the DOM (it carries no `data-mock`), and rail hand-off never advances into or out of it
