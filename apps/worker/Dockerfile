# 빌드 컨텍스트는 저장소 루트 (docker-compose.yml에서 지정)
FROM node:22-alpine AS base
RUN npm i -g pnpm@10.34.7
WORKDIR /repo
COPY . .

FROM base AS build
RUN pnpm install --frozen-lockfile --filter worker...
RUN pnpm --filter worker build

FROM base
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod --filter worker...
COPY --from=build /repo/apps/worker/dist ./apps/worker/dist
WORKDIR /repo/apps/worker
CMD ["node", "dist/index.js"]
