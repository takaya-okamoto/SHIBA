FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
# minimumReleaseAge: pnpm rejects very-recently-published (transitive/optional) packages by policy;
# disable for the build so a fresh deploy isn't blocked by a dep published in the last day.
RUN pnpm config set minimumReleaseAge 0 2>/dev/null; pnpm install --frozen-lockfile --config.minimumReleaseAge=0 || pnpm install --config.minimumReleaseAge=0
COPY . .
RUN pnpm build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# git (+ ssh client + CA certs) so the app can version memory and push it to MEMORY_GIT_REMOTE for
# offsite backup (docs/91, 94 — "source of truth = Markdown + git"). Without git, store.commit() is a
# silent no-op (execFile("git",...) -> ENOENT), so memory is never versioned or backed up.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm config set minimumReleaseAge 0 2>/dev/null; pnpm install --prod --frozen-lockfile --config.minimumReleaseAge=0 || pnpm install --prod --config.minimumReleaseAge=0
COPY --from=build /app/dist ./dist
COPY src/index/schema.sql ./dist/index/schema.sql
# data/ (memory + state) is a mounted volume, not baked into the image.
USER node
CMD ["node", "dist/main.js", "serve"]
