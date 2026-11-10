# One image, two processes on Render: `web` (Next.js on Node) and `worker` (pg-boss jobs on Bun).
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