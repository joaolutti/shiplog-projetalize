# One image. On Render's free plan, scripts/start.sh runs the migrations, the worker (pg-boss on Bun)
# and the web app (Next.js on Node) in one service; `bun run start` / `bun run worker` run them apart.
FROM node:22-slim AS base
RUN npm install -g bun@1.4.4
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
# Overridden per service in render.yaml.
CMD ["bun", "run", "start"]