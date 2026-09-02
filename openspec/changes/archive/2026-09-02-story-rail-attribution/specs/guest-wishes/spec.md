## REMOVED Requirements

### Requirement: No author attribution anywhere

**Reason**: The story-rail-attribution change introduces first-name attribution on story tiles (specified in guest-photos), so a wall-wide "no attribution anywhere" rule no longer holds. Wish anonymity itself is unchanged and is re-stated below as a wishes-scoped requirement.

**Migration**: Wish anonymity is preserved by the ADDED requirement "Wishes remain author-free" in this capability; story attribution is governed by guest-photos ("First-name attribution on story tiles", "Wall payload carries poster first name and timestamp").

## ADDED Requirements

### Requirement: Wishes remain author-free

Wishes SHALL render without author names in every surface (wish marquee, demo and real states), and `GET /api/submissions` SHALL NOT include any invite display name, author field, or timestamp on wish entries. The caller's own submission remains identifiable only through the session (`mine`), never by a name rendered on the marquee.

#### Scenario: No names in wish entries

- **WHEN** any submissions endpoint responds successfully
- **THEN** no wish entry carries an author, name, or display_name field (story entries may carry `firstName` per guest-photos)

#### Scenario: No names rendered on the marquee

- **WHEN** real wishes render on the wish marquee for any visitor
- **THEN** no author attribution is displayed with any wish
