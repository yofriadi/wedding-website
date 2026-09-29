# story-teaser Spec Delta

## Purpose

The story rail behaves as an honest public teaser until the guest-submissions capability ships: demo tiles visible to everyone, no dead input UI, and up to three couple-supplied text-image tiles that frame the rail as invite-only.

## ADDED Requirements

### Requirement: Demo tiles remain visible to everyone

The story rail SHALL keep demo `StoryViewer` tiles visible to all visitors (public and invitees) until the guest-submissions capability ships.

#### Scenario: Public visitor sees the rail

- **WHEN** a visitor without a cookie views the story rail section
- **THEN** demo story tiles render and no per-visitor state changes the rail

### Requirement: Add-story input tile removed

The story rail SHALL NOT render the "Add Story" input tile (the file-input tile) in any state.

#### Scenario: No upload affordance anywhere

- **WHEN** any visitor views the rail
- **THEN** no file input or "Add Story" tile is present in the DOM

### Requirement: Couple-supplied teaser tiles are static images

The rail SHALL include up to three couple-supplied static text-image tiles (e.g. "If you are invited, you will see people's stories here"), rendered as plain non-interactive `<img>` elements — not `StoryViewer` instances (no click-to-open modal, no hover affordances) — sized to match the rail tiles (112×200), with assets placed by convention in `apps/web/public/teasers/` (e.g. `story-teaser-1.webp`).

#### Scenario: Teaser tiles render

- **WHEN** the rail renders with teaser assets present in `public/teasers/`
- **THEN** up to three text-image tiles appear among the demo tiles with no interactive behavior

#### Scenario: Missing assets degrade silently

- **WHEN** fewer than three teaser assets exist (or none)

- **THEN** the rail renders with whatever assets exist; no broken-image placeholders

### Requirement: Teaser makes no fetches and stores nothing

The teaser state SHALL operate entirely from static assets; it SHALL NOT call any API or read cookies.

#### Scenario: Static-only behavior

- **WHEN** any visitor views the teaser rail
- **THEN** no network request beyond the static image assets occurs
