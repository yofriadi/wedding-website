# story-teaser Spec Delta

## MODIFIED Requirements

### Requirement: Couple-supplied teaser tiles are static images

The rail SHALL include up to three couple-supplied static text-image tiles (e.g. "If you are invited, you will see people's stories here"), rendered as plain non-interactive `<img>` elements — not `StoryViewer` instances (no click-to-open modal, no hover affordances) — sized to match the rail tiles (112×200), with assets placed by convention in `apps/web/public/teasers/` (e.g. `story-teaser-1.webp`). The teaser tiles SHALL render only while no real guest photo exists (the same SSR gate as the story-rail-mocks mock tiles): once any `submission_photos` row exists, the teaser tiles SHALL be omitted for all visitors (cookie-blind), and they SHALL NOT return while real photos exist.

#### Scenario: Teaser tiles render on the empty wall

- **WHEN** the rail renders with teaser assets present and no guest photos exist
- **THEN** up to three text-image tiles appear among the demo tiles with no interactive behavior

#### Scenario: Missing assets degrade silently

- **WHEN** fewer than three teaser assets exist (or none)
- **THEN** the rail renders with whatever assets exist; no broken-image placeholders

#### Scenario: Teaser tiles retire when real content exists

- **WHEN** any guest photo exists in the database
- **THEN** the teaser tiles are omitted from the rail for every visitor, alongside the mock tiles (story-rail-mocks)
