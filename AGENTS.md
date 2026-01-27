# Repository Guidelines

## Project Structure & Module Organization

- Monorepo managed by pnpm workspaces and Turborepo.
- `apps/web/` holds the Astro site. Key folders:
  - `apps/web/src/pages/` for routes, `apps/web/src/components/` for UI pieces, `apps/web/src/layouts/` for page shells, and `apps/web/src/styles/` for global styles.
  - Static assets live in `apps/web/public/`.
- Shared packages live in `packages/`:
  - `packages/db/` for Drizzle + Turso/SQLite database code.
  - `packages/env/` for environment schema/validation.
  - `packages/infra/` for deployment (Cloudflare via Alchemy).
  - `packages/config/` for shared config.

## Build, Test, and Development Commands

- `pnpm install`: install workspace dependencies.
- `pnpm dev`: run all dev servers via Turborepo.
- `pnpm dev:web`: run only the Astro site.
- `pnpm build`: build all apps/packages.
- `pnpm check-types`: run TypeScript checks across the repo.
- `pnpm check`: run Oxlint + Oxfmt for linting/formatting.
- Database:
  - `pnpm db:local` starts a local SQLite DB (Turso dev server).
  - `pnpm db:push` applies schema changes.
  - `pnpm db:studio` opens the Drizzle Studio UI.

## Coding Style & Naming Conventions

- Use the existing TypeScript + Astro style; format with `pnpm check`.
- Lint/format on commit via Lefthook (`oxlint` and `oxfmt`).
- Prefer descriptive component and file names that match existing patterns in `apps/web/src`.
- Frontend implementation should be vanilla (no React or similar frameworks).
- For animations, use vanilla Motion (formerly Framer Motion).

## Testing Guidelines

- No automated test runner is configured yet.
- If you add tests, document the runner and add scripts in `package.json`.
- If using Playwright to inspect or test UI in a browser, use the `agent-browser` skill.

## Commit & Pull Request Guidelines

- Commit messages follow Conventional Commits; current history uses `feat: ...` (limited sample).
- PRs should include:
  - A short summary of changes and affected paths (e.g., `apps/web/src/pages/`).
  - Screenshots or GIFs for UI changes.
  - Notes about DB migrations or schema changes (run `pnpm db:push` if needed).

## Security & Configuration Notes

- Set environment variables in `apps/web/.env` as needed; schema is defined in `packages/env/`.
- Do not commit secrets or database credentials.
