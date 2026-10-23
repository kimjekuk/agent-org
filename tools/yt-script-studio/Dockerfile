# linux/arm64(오라클 ARM VM)·linux/amd64 공통 — node 공식 이미지가 둘 다 제공
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
ENV HOST=0.0.0.0 PORT=7788 NODE_ENV=production
USER node
EXPOSE 7788
CMD ["node_modules/.bin/tsx", "src/server.ts"]
