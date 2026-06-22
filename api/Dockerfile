# ---- build ----
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./
COPY api/package.json ./api/
COPY web/package.json ./web/
RUN pnpm install --filter @sleek-todo/api... --frozen-lockfile=false
COPY api ./api
RUN pnpm --filter @sleek-todo/api build

# ---- runtime ----
FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production
COPY pnpm-workspace.yaml package.json ./
COPY api/package.json ./api/
COPY web/package.json ./web/
RUN pnpm install --filter @sleek-todo/api... --prod --frozen-lockfile=false
COPY --from=build /repo/api/dist ./api/dist
WORKDIR /repo/api
EXPOSE 3000
# Apply pending migrations, then start the server.
CMD ["sh", "-c", "node dist/database/run-migrations.js && node dist/main.js"]
