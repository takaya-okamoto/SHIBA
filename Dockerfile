FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
RUN pnpm build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && (pnpm install --prod --frozen-lockfile || pnpm install --prod)
COPY --from=build /app/dist ./dist
COPY src/index/schema.sql ./dist/index/schema.sql
# data/ (memory + state) is a mounted volume, not baked into the image.
USER node
CMD ["node", "dist/main.js", "serve"]
