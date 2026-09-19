## Capability retirement

This delta retires the entire capability. During the eventual authorized spec sync, apply all six requirement removals, then delete `openspec/specs/add-story-flow/spec.md` and its now-empty directory. Do not leave a Purpose-only spec or recreate an empty capability on a repeated sync. Retain this change delta and archived history as the retirement record; replacement behavior belongs to `guest-photo-trail`. No main-spec deletion is performed while editing this plan.

## REMOVED Requirements

### Requirement: Add-story tile visible only to eligible invitees

**Reason**: The story rail and add-story tile are no longer the posting surface.
**Migration**: Use `guest-photo-trail` posting eligibility and the existing add-image control, resolved from `inviteValid` and `mineId`.

#### Scenario: Eligibility uses the new control

- **WHEN** an eligible invitee loads the memories section
- **THEN** posting is offered through the add-image control and no add-story tile is required

### Requirement: One-screen photo flow

**Reason**: The old one-to-three-photo modal has been replaced by direct single-file selection and upload.
**Migration**: Use the native single-photo picker and singular `photo` multipart field defined by guest-photo-trail and guest-photos.

#### Scenario: Selection has no modal step

- **WHEN** an eligible invitee activates uploading
- **THEN** the native picker opens directly and a selected valid photo is uploaded without a modal Share step

### Requirement: Add-story tile plays the example intro on first tap

**Reason**: Story examples and persistent first-tap intro state are obsolete.
**Migration**: Remove the intro viewer, orchestration, and localStorage flag consumer; do not add a replacement intro.

#### Scenario: First activation is direct

- **WHEN** a guest activates uploading for the first time in a browser
- **THEN** the picker opens without playing examples or waiting on persistent intro state

### Requirement: Post-submit state transitions

**Reason**: There is no modal to close, story tile to remove, or story rail to repopulate.
**Migration**: Use the new control's committed state, refreshed flat collection, and decoded-image success feedback.

#### Scenario: Success uses trail feedback

- **WHEN** a photo is accepted and becomes displayable
- **THEN** the trail updates and the add-image control shows success without closing an add-story modal

### Requirement: Error handling maps to inline states

**Reason**: The old errors target a modal and `mine` story state that no longer exist.
**Migration**: Preserve inline validation/network feedback in the new control; handle `409` through a collection refresh and post-commit failures through refresh-only retries.

#### Scenario: Error does not revive the modal

- **WHEN** upload validation or gallery refresh fails
- **THEN** feedback appears in the add-image control's inline error/status area with no story modal

### Requirement: The flow modal animates open and closed

**Reason**: The add-story modal is retired, so its entrance, exit, interruption, and reduced-motion requirements are no longer applicable.
**Migration**: Remove the dead modal animation implementation and tests; retain the existing upload control's feedback and reduced-motion behavior without redesign.

#### Scenario: No modal transition remains

- **WHEN** uploading is opened, completed, or cancelled
- **THEN** no add-story panel/backdrop animation or modal scroll lock runs
