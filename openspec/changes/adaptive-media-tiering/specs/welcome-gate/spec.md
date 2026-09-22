## MODIFIED Requirements

### Requirement: Music unlocks on the reveal gesture

The reveal commit SHALL invoke audio playback synchronously within the releasing touch gesture's activation window, so mobile autoplay policy permits it, but only on a `full` media tier (see the `media-tiering` capability). On a `lite` tier the commit SHALL neither start nor download the soundtrack and SHALL NOT arm any gesture fallback that would download it later. The gate SHALL hide its music note while the tier is `lite` or still `pending`, so no playback is promised before the verdict is `full`; a `pending` tier that resolves to `full` SHALL reveal the note again. Where autoplay already succeeded (or the desktop dismissal had no activation), existing playback fallback behavior applies unchanged on the full tier.

#### Scenario: First swipe starts the music on a full tier

- **WHEN** a mobile guest on a full tier commits the reveal swipe and autoplay was previously blocked
- **THEN** background music begins playing without any further interaction

#### Scenario: Lite commit is silent and byte-free

- **WHEN** a mobile guest on a lite tier commits the reveal swipe
- **THEN** no soundtrack request is issued, no music plays, and no later gesture triggers a soundtrack download

#### Scenario: Lite gate makes no music promise

- **WHEN** the gate renders on a lite tier
- **THEN** the "music will play upon opening" note is not visible

#### Scenario: Unresolved gate makes no music promise either

- **WHEN** the gate renders while the tier is still `pending`
- **THEN** the note is not visible, and becomes visible only if the tier resolves to `full`

#### Scenario: Commit before the verdict resolves

- **WHEN** the gate commits while the tier is still `pending` and the tier later resolves to `full`
- **THEN** the soundtrack begins preloading at resolution and starts on the guest's next qualifying gesture, rather than never
