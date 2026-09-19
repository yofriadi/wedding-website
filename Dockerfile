# syntax=docker/dockerfile:1
#
# Multi-stage build for the wedding-website monorepo (pnpm + Turbo + Astro
# standalone Node adapter). The runtime image carries the whole workspace
# (apps/web + packages/*) because the Astro server bundles workspace source
# but keeps npm dependencies external in node_modules.
#
# Build on the VPS itself (same arch as runtime) — `docker compose up -d --build`.
FROM node:24-slim AS base
WORKDIR /app

FROM base AS build
RUN npm install -g pnpm@11.21.0
# First copy only the manifests so dependency install is a cacheable layer.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/env/package.json packages/env/package.json
# --ignore-scripts: pnpm would otherwise run the root "prepare" script
# (prek install), which needs a git repo. esbuild/sharp build scripts are
# then restored explicitly; sharp itself is prebuilt platform packages.
RUN pnpm install --frozen-lockfile --ignore-scripts \
    && pnpm rebuild esbuild sharp
COPY . .
# Build-time env: values here are defaults only; the container gets real
# configuration from docker-compose environment at runtime.
RUN cp apps/web/.env.example apps/web/.env \
    && pnpm run build

FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    DATABASE_URL=file:/data/wedding.db \
    PHOTO_STORAGE_DIR=/data/photos
WORKDIR /app
# Copy the built workspace; pnpm's node_modules symlinks survive the COPY.
COPY --from=build /app /app
# /data is owned by the unprivileged runtime user; a named volume
# initialized from here inherits that ownership on first mount.
RUN mkdir -p /data/photos && chown -R node:node /data
VOLUME /data
EXPOSE 4321
# Run as the unprivileged node user, not root.
USER node
# Apply migrations before starting the server, then hand off PID 1 to node
# so SIGTERM from `docker compose down` stops the server promptly.
CMD ["sh", "-c", "node packages/db/scripts/migrate.mjs && exec node apps/web/dist/server/entry.mjs"]
