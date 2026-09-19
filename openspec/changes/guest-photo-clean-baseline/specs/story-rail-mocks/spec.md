## Capability retirement

This delta retires the entire capability. During the eventual authorized spec sync, apply all four requirement removals, then delete `openspec/specs/story-rail-mocks/spec.md` and its now-empty directory. Do not leave a Purpose-only spec or recreate an empty capability on a repeated sync. Retain this change delta and archived history as the retirement record; family starter presentation belongs to `guest-photo-trail`. No main-spec deletion is performed while editing this plan.

## REMOVED Requirements

### Requirement: Mock story tiles render while the wall is empty

**Reason**: The magnetic trail replaces the story rail, and starter family photos are not mock submissions.
**Migration**: Keep family starter images as presentation-only trail fallbacks; remove the mock-gating database query and mock story markup.

#### Scenario: Empty collection shows family images

- **WHEN** no guest photos exist
- **THEN** the trail shows family starter images without mock story tiles or a mock-existence database query

### Requirement: Mock tiles evict live on the first real story

**Reason**: There are no mock viewers to evict; a partial trail intentionally mixes guest sources with starter fillers.
**Migration**: Recompute the trail's source pool after collection refresh, retaining starter fillers only while needed to fill the visible positions.

#### Scenario: First photo fills part of the trail

- **WHEN** the first guest photo is accepted
- **THEN** it joins the trail with remaining starter fillers rather than triggering story-mock eviction

### Requirement: Mocks are honest interactive previews

**Reason**: The current trail is a photo presentation, not a chain of clickable story-preview modals.
**Migration**: Remove mock modal, progress, keyboard/gesture hand-off, and viewer events; do not label starter images as guest content.

#### Scenario: Starter image does not open a story

- **WHEN** the memories section contains family starter images
- **THEN** no mock story navigation runtime or modal is attached to them

### Requirement: Example stories play as a first-tap intro

**Reason**: A hidden always-present example viewer and first-tap sequence are no longer part of uploading.
**Migration**: Remove the hidden intro viewer and its hand-off exclusions; uploading directly opens the native single-file picker.

#### Scenario: Non-empty collection has no hidden examples

- **WHEN** guest photos already exist and an eligible invitee activates uploading
- **THEN** the picker opens directly and no hidden example-story viewer is required in the DOM
