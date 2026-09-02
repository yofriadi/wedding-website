## REMOVED Requirements

### Requirement: Demo tiles remain visible to everyone

**Reason**: The rail's placeholder model is replaced by three unnamed example mock tiles (story-rail-mocks) that retire together with the first real guest photo. Always-on demo identities (named fake guests with avatars) contradict the couple's direction that an empty rail shows exactly three nameless example posts and a non-empty rail shows only real posts.

**Migration**: The empty-wall mock tiles cover the placeholder role; on a non-empty wall the rail renders only real story tiles (first-name attributed per guest-photos). Demo image assets remain in use by other page sections (hero/parallax/timeline) and are not removed.

### Requirement: Couple-supplied teaser tiles are static images

**Reason**: The `story_example_*` assets become the interactive mock story tiles under story-rail-mocks; keeping static `<img>` teasers of the same three images under the same empty-wall gate would render each image twice across two placeholder systems, static where the couple wants posts. (The red `mock-gate-ssr.spec.ts` is a separate stale-path test bug — it scaffolds `/teasers/story-teaser-*` — fixed by this change's test rewrite, not by this retirement.)

**Migration**: The same three assets render through `StoryViewer` mock tiles (single story each, `.webp` src with `.avif` sibling derived by extension swap); no static teaser markup remains.

### Requirement: Teaser makes no fetches and stores nothing

**Reason**: No teaser tiles remain after this change; the no-fetch guarantee for placeholder tiles is already carried by the story-rail-mocks requirement "Mocks are honest interactive previews".

**Migration**: Covered by story-rail-mocks; mock tiles trigger no submissions-endpoint request of their own.
