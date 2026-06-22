# ---- build ----
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json ./
COPY api/package.json ./api/
COPY web/package.json ./web/
RUN pnpm install --filter @sleek-todo/web... --frozen-lockfile=false
COPY web ./web
# VITE_API_URL is baked in at build time; defaults to http://localhost:3000
# (the browser reaches the API via the host-published port).
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN pnpm --filter @sleek-todo/web build

# ---- runtime ----
FROM nginx:1.27-alpine AS runtime
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/web/dist /usr/share/nginx/html
EXPOSE 80
