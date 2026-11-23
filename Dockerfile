# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY index.html tsconfig.json vite.config.ts ./
COPY src/ ./src/
ARG VITE_USE_MOCK
ARG VITE_NOCODB_API_URL
ARG VITE_N8N_WEBHOOK_BASE_URL
ARG VITE_WF2_GENERATE_WEBHOOK_URL
ARG VITE_WF3_RENDER_WEBHOOK_URL
ARG VITE_NOCODB_RSS_SOURCES_TABLE_ID
ARG VITE_NOCODB_RSS_SYNC_SETTINGS_TABLE_ID
ARG VITE_NOCODB_RSS_SYNC_SETTINGS_RECORD_ID
ARG VITE_NOCODB_PRODUCTION_POOL_TABLE_ID
ARG VITE_NOCODB_RADAR_POOL_TABLE_ID
ARG VITE_NOCODB_ACCOUNT_METRICS_TABLE_ID
ARG VITE_NOCODB_POST_METRICS_TABLE_ID
ARG VITE_NOCODB_ID_FIELD
# 挂载构建上下文供 Vite 读取可选的根目录 .env，最终镜像只复制 dist。
RUN --mount=type=bind,target=/contenthub-build-context \
    CONTENTHUB_BUILD_ENV_DIR=/contenthub-build-context npm run build

FROM nginx:stable-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /srv/contenthub/
EXPOSE 80
