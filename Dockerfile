FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine

ARG VCS_REF
LABEL org.opencontainers.image.title="Protocol Viewer" \
      org.opencontainers.image.source="https://github.com/galacticcouncil/protocol-viewer" \
      org.opencontainers.image.revision="${VCS_REF}"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
RUN printf '%s\n' "$VCS_REF" > /usr/share/nginx/html/version.txt

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
