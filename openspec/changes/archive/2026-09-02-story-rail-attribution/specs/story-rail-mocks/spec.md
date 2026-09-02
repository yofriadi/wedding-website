## MODIFIED Requirements

### Requirement: Mock story tiles render while the wall is empty

The story rail SHALL render three mock story tiles in the server HTML for all visitors, as the rail's only story tiles, while zero real guest stories exist (no submission has any photo). The gate SHALL be uniform and cookie-blind: once at least one real guest story exists, the server SHALL NOT render mock tiles for any visitor — public or invitee. Mocks are a "coming soon" placeholder that yields to real content; the first real story removes them everywhere. With the public wall (public-wall change) and first-name attribution (story-rail-attribution change), the public rail then renders the real wall tiles carrying the poster's first name, alongside the invitee rail.

Each mock SHALL be an unnamed, avatar-less, timestamp-less, clickable `StoryViewer` component with exactly one story whose `src` is `/story_example_N.webp` (N = 1, 2, 3 in rail order), and each mock's `<story-viewer>` element SHALL carry a `data-mock` attribute. Mocks SHALL NOT render a username label, avatar, or timestamp anywhere; the tile label position SHALL keep the attribution-free filler span so mock tiles hold the same rail geometry as named tiles. The gating check SHALL be a server-side read for the existence of any guest photo; on database error it SHALL fail open (render mocks).

#### Scenario: Public visitor sees mocks on an empty wall

- **WHEN** a public visitor views the rail while no real guest story exists
- **THEN** three mock story tiles render as the rail's only story tiles (the page still makes its one submissions request per load — public-wall D2 retires the zero-request guarantee — but the empty wall evicts nothing)

#### Scenario: Public rail drops mocks after the first real post

- **WHEN** a public visitor views the rail after the first real story exists
- **THEN** no mock tiles render, and the public rail renders the real wall tiles with first-name attribution per the guest-photos capability

#### Scenario: Invitee sees mocks on an empty wall

- **WHEN** an invitee views the rail while no real guest story exists
- **THEN** three mock story tiles render as the rail's only story tiles, preceded by the add-story tile when the invitee is eligible for it

#### Scenario: Non-empty wall omits mocks for any visitor

- **WHEN** any visitor (public or invitee) views the rail and at least one submission has photos
- **THEN** the server HTML contains no mock tiles

#### Scenario: Database check failure fails open

- **WHEN** the mock-gating database read fails
- **THEN** mocks render as if the wall were empty

### Requirement: Mocks are honest interactive previews

Mock tiles SHALL behave as real story tiles: tap/click opens the story modal with working progress, gesture, and keyboard navigation, and rail hand-off (`story-viewer-end` / `story-viewer-prev`) traverses them in rail order. Each mock carries exactly one story, so advancing past its only slide SHALL hand off to the next story viewer in rail order, and reversing at its only slide SHALL hand off to the previous story viewer at its last slide. Mocks SHALL use only existing public image assets (no new asset pipeline) and SHALL NOT trigger any submissions-endpoint request of their own (the page's one shared per-load fetch — public-wall change — is not a per-mock request).

#### Scenario: Mock opens the story modal

- **WHEN** a visitor activates a mock tile
- **THEN** the story modal opens and plays the mock's single story like any other tile, with the attribution-free "Guest story" header placeholder

#### Scenario: Hand-off traverses mocks

- **WHEN** a mock's only slide advances past its end
- **THEN** viewing hands off to the next mock tile in rail order
- **AND WHEN** a mock's only slide is reversed at its first slide
- **THEN** viewing hands off to the previous mock tile at its last slide
