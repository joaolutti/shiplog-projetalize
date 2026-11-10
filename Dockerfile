# One image, two processes on Render: `web` (Next.js) and `worker` (pg-boss jobs).
FROM node:22-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
# Overridden per service in render.yaml.
CMD ["npm", "run", "start"]
