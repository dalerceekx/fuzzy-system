# syntax=docker/dockerfile:1
FROM node:26.11.1-alpine3.24 AS build
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci --workspace apps/frontend --no-audit --no-fund
COPY apps/frontend apps/frontend
WORKDIR /repo/apps/frontend
# Cookies and CSRF require a single origin. No secrets are build arguments.
ENV VITE_API_BASE_URL=/api/v1
RUN npm run build && npm run verify:bundle

# Rebuild the official Caddy release with patched Go/x/net. The upstream
# 2.11.7 binary was built with Go 1.26.8 and contains fixed HIGH CVEs.
FROM golang:1.27.2-alpine3.24 AS caddy-build
WORKDIR /src
COPY apps/frontend/caddy/go.mod apps/frontend/caddy/go.sum ./
RUN go mod download
COPY apps/frontend/caddy/main.go ./
RUN CGO_ENABLED=0 GOMAXPROCS=2 go build -p 2 -mod=readonly -trimpath -ldflags='-s -w' -o /caddy .

FROM caddy:2.11.7-alpine
COPY --from=caddy-build /caddy /usr/bin/caddy
RUN addgroup -S -g 10001 app \
  && adduser -S -D -H -u 10001 -G app app \
  && mkdir -p /data /config \
  && chown -R app:app /data /config
COPY --from=build /repo/apps/frontend/dist /srv
COPY apps/frontend/Caddyfile /etc/caddy/Caddyfile
USER 10001:10001
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
EXPOSE 80 443
