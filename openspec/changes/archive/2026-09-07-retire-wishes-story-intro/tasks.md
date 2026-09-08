## 1. Remove the wish marquee

- [x] 1.1 Delete `apps/web/src/components/WishMarquee.astro`.
- [x] 1.2 In `apps/web/src/pages/index.astro`: remove the `WishMarquee` import, the `<section id="wishes-section">` block, the `--wishes-*` tokens (dark `:root` and light override), the `#wishes-section` background rule, and the marquee comment near the orchestrator.
- [x] 1.3 Delete `apps/web/tests/wish-marquee.spec.ts`.
- [x] 1.4 Grep-confirm no remaining `WishMarquee`, `data-wish-marquee`, `#wishes-section`, or `--wishes-` references in `apps/web/src`.

## 2. Strip wishes from the add-story flow

- [x] 2.1 In `apps/web/src/components/AddStoryFlow.astro`: remove the wish input row, the `[data-wish-count]` counter, and the `[data-wish-error]` slot; keep the photo picker, previews, and action row.
- [x] 2.2 In `apps/web/src/scripts/add-story-flow.ts`: remove `wishInput`/`wishCount`/`wishError` from `FlowElements` and `qs`; remove `WISH_MAX`, `DEFAULT_WISH_PLACEHOLDER`, `WISH_PLACEHOLDER_TEMPLATES`, `startPlaceholderRotation`/`stopPlaceholderRotation`, `hasTyped`, `updateWishCount`, and the wish `input` listener.
- [x] 2.3 Make submit-enable photo-only: `isDirty()` / `updateSubmitEnabled()` gate on `selectedFiles.length > 0`; drop the `wishLen` branches.
- [x] 2.4 In `submit()`: stop appending `wishText`; drop the `wishLen > WISH_MAX` guard; change the empty-guard message to "Add at least one photo."
- [x] 2.5 In `applyServerError`: remove the `invalid_wish_text` case; update the `empty_submission` message to "Add at least one photo."
- [x] 2.6 In `openFlow()`: remove the `els.wishInput.focus()` initial-focus call; move initial focus to the photo picker trigger (or drop it) so the flow has no dangling focus target and stays a11y-sane.

## 3. Strip wishes from the API and client types

- [x] 3.1 In `apps/web/src/pages/api/submissions/index.ts`: remove the `submissions.wishText` select, `wallWishes`, the `wall.wishes` field, `wishText` from `mine`, and the `wishText` return on `201`; also drop `wishText` from the `db.insert(submissions).values({...})` object and from the `const { wishText, photos } = parsed` destructure.
- [x] 3.2 In the multipart parser (`parseMultipart`, the `{ ok, photos }` builder): remove the `normalizeWishText` call and the `invalid_wish_text` branch; `empty_submission` becomes `photos.length === 0`; return only `{ ok: true, photos }`.
- [x] 3.3 In `apps/web/src/lib/submissions.ts`: remove `normalizeWishText` and `WISH_TEXT_MAX_CHARS`.
- [x] 3.4 In `apps/web/src/lib/submissions-client.ts`: drop `wishText` from `mine`, drop `wishes` from `wall`, and update the module header comment (marquee no longer a consumer; the rail is the sole consumer).

## 4. Drop the `wish_text` column

- [x] 4.1 In `packages/db/src/schema/submissions.ts`: remove the `wishText: text("wish_text")` column and refresh the table comment (drop the "wish marquee / wishes stay author-free" clause).
- [x] 4.2 Generate the migration: `pnpm --filter @wedding-website/db db:generate`; confirm it drops `wish_text` and updates the meta snapshot/journal.
- [x] 4.3 Apply to dev/scratch DBs (`db:migrate`) and confirm the app boots and `GET /api/submissions` returns no `wishes`.

## 5. Remove the "Guest story" modal header text

- [x] 5.1 In `apps/web/src/components/StoryViewer.astro`: replace the `Guest story` placeholder span's text with empty (keep an `aria-hidden` span as the `justify-between` spacer so the close button stays right).
- [x] 5.2 In `apps/web/src/scripts/guest-rail.ts` (`buildGuestModal`): set the placeholder `label.textContent = ""` (keep the element + `aria-hidden`).

## 6. First-tap story intro

- [x] 6.1 In `apps/web/src/pages/index.astro`: render one always-present `<StoryViewer stories={[example1, example2, example3]}>` inside a `hidden` wrapper carrying `data-story-intro`; do **not** pass `mock` (no `data-mock`). Reuse the existing `mockStories` slide definitions (three example `.webp` srcs, 4000ms).
- [x] 6.2 In `apps/web/src/pages/index.astro`: scope both hand-off handlers to `document.querySelectorAll('[data-story-rail] [data-story-viewer]')` (was global) so the intro is never a hand-off source/target.
- [x] 6.3 In `apps/web/src/scripts/guest-rail.ts` `wireTileOpen`: branch on `localStorage` key `ww-story-intro-seen` (try/catch). Unset → find `[data-story-intro] [data-story-viewer]`, `openStory()`, set the flag, and attach a one-shot `story-viewer-end` listener that `preventDefault()`s, `closeStory({ animate: false })`, then `openAddStoryFlow()`. Set → `openAddStoryFlow()` directly.
- [x] 6.4 Confirm Escape mid-intro does not open the flow (it closes without dispatching `story-viewer-end`).

## 7. Tests

- [x] 7.1 Delete `apps/web/tests/placeholder-verify.spec.ts` (rotating-wish-placeholder is gone).
- [x] 7.2 Add a `seedStoryIntroSeen(page)` helper in `apps/web/tests/helpers.ts` (init-script `localStorage.setItem("ww-story-intro-seen", "1")`); apply it in every existing test that opens the flow via the tile.
- [x] 7.3 `apps/web/tests/guest-rail.spec.ts`: remove wish fills and wish payload fields; delete the `wish-only post keeps mocks` and `text-only submit posts wishText` tests; switch the 400/409/network tests to a photo instead of a wish; update the "opens the flow" test to assert the photo picker (no `[data-wish-input]`/`[data-wish-count]`).
- [x] 7.4 `apps/web/tests/mock-tiles-verify.spec.ts`: assert the modal header shows no "Guest story" text (empty slot) and the close button stays right-aligned.
- [x] 7.5 `apps/web/tests/mock-gate-ssr.spec.ts`: empty wall now has 4 `<story-viewer>` (3 mocks + intro) and 3 `data-mock`; non-empty wall has 1 `<story-viewer>` (the intro) and 0 `data-mock` (was 0 viewers).
- [x] 7.6 `apps/web/tests/story-viewer.spec.ts` and `apps/web/tests/photo-pipeline.spec.ts`: drop `wishText`/`wishes` from fixtures and the multipart `form.append("wishText", …)`.
- [x] 7.7 Add first-tap-intro coverage: first tap opens the intro (first slide `= /story_example_1.webp`) and sets the flag; watching to the end opens the flow; a second tap (flag set) opens the flow directly; a reload keeps the flag.

## 8. Docs

- [x] 8.1 `ops/MODERATION.md`: remove the wish-removal SQL/section and the marquee/wish wording; submissions are photo-only.
- [x] 8.2 `ops/README.md`: update the archival prose that still names wishes ("export the final wishes/photos…", "the DB has every wish") to photos-only.

## 9. Verification

- [x] 9.1 `pnpm --filter @wedding-website/db check-types` and `pnpm --filter web check-types` pass.
- [x] 9.2 `pnpm --filter web build` passes.
- [x] 9.3 Story/submission Playwright subset green: `guest-rail`, `mock-tiles-verify`, `mock-gate-ssr`, `story-viewer`, `photo-pipeline`, and the new intro spec.
- [x] 9.4 `openspec validate retire-wishes-story-intro --strict` passes.
