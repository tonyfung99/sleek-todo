# SleekTodo

A Notion-style **collaborative** to-do application: shared lists with real-time
editing, presence, and per-todo edit locks, plus recurring tasks, dependencies,
filtering, and JWT auth with refresh-token rotation.

## Features

- **Auth** — register / login, short-lived JWT access tokens + **refresh-token
  rotation** (httpOnly cookie, server-side revocation).
- **Shared lists with RBAC** — `OWNER` / `EDITOR` / `VIEWER` per list.
- **Todos** — name, description, due date, status, priority; soft delete.
- **Real-time collaboration** — live updates over WebSockets, presence avatars,
  enforced **per-todo edit locks** ("X is editing"), multi-instance ready via a
  Redis adapter.
- **Recurrence** — daily / weekly / monthly; completing a recurring todo spawns
  the next occurrence.
- **Dependencies** — within a list, with cycle detection and dependency-gated
  status transitions (can't start until prerequisites are complete).
- **Filtering / sorting / keyset pagination** — server-side, built for large lists.

See [`docs/superpowers/specs/`](docs/superpowers/specs/) for the design specs and
decision log.

## Tech stack

NestJS 10 · TypeORM + PostgreSQL · Redis (locks, presence, socket.io adapter) ·
socket.io · JWT + bcrypt · React + Vite · Jest + Testcontainers · Playwright ·
Docker Compose · GitHub Actions.

## Prerequisites

- **Node 22** (`nvm use`)
- **pnpm** via Corepack (`corepack enable`)
- **Docker** + Docker Compose

## Quick start (local dev)

The app is a pnpm monorepo: `api/` (NestJS) and `web/` (React/Vite). Postgres and
Redis run in Docker; the API and web dev server run on your host.

```bash
# 0. install dependencies (repo root)
corepack enable
pnpm install

# 1. start Postgres + Redis
docker compose up -d postgres redis

# 2. create the database schema (run once; re-run after pulling new migrations)
DATABASE_URL=postgres://sleek:sleek@localhost:5432/sleektodo \
  pnpm --filter api migration:run

# 3. start the API (terminal 1) — http://localhost:3000
DATABASE_URL=postgres://sleek:sleek@localhost:5432/sleektodo \
REDIS_URL=redis://localhost:6379 \
JWT_SECRET=dev-only-change-me-0123456789 \
CORS_ORIGIN=http://localhost:5173 \
NODE_ENV=development \
  pnpm --filter api start:dev

# 4. start the web app (terminal 2) — http://localhost:5173
pnpm --filter web dev
```

Open **http://localhost:5173**, register an account, and create a list.

> **Hostnames:** `.env.example` uses `postgres` / `redis` (the service names used
> *inside* Docker). When running the API on your host, use **`localhost`** as shown
> above. Health check: `curl http://localhost:3000/health/ready`.

## Try real-time collaboration

1. Register **Alice** in one browser; create a list.
2. Add **Bob** as an editor (no share form in the UI yet — register Bob first,
   then call the API):
   ```bash
   curl -X POST http://localhost:3000/lists/<LIST_ID>/members \
     -H "Authorization: Bearer <ALICE_ACCESS_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"email":"bob@example.com","role":"EDITOR"}'
   ```
3. Open the same list as **Bob** in a second browser (or incognito).
4. Edit a todo as Alice → Bob sees the lock badge, the row goes read-only, and the
   text updates live. Complete a recurring todo → the next occurrence appears for both.

## Testing

```bash
docker compose up -d postgres redis     # required for integration + e2e tests

pnpm --filter api test                  # unit tests
pnpm --filter api test:int              # integration tests (Testcontainers spins real PG + Redis)
pnpm --filter web test                  # web component test (Vitest)
pnpm --filter web e2e                   # browser e2e (Playwright, two browser contexts)

pnpm lint                               # lint all workspaces
```

CI (`.github/workflows/ci.yml`) runs lint + builds + unit + integration on every
push/PR, plus a dedicated browser-e2e job (Postgres + Redis as service containers).

## Project structure

```
api/                 NestJS API
  src/
    auth/            JWT auth + refresh-token rotation
    lists/           lists + memberships (RBAC)
    todos/           todo CRUD, filtering/pagination, dependencies, recurrence
    realtime/        socket.io gateway, Redis locks + presence
    health/          liveness / readiness probes
    database/        TypeORM data source + migrations
web/                 React + Vite client
  src/               auth, lists, and real-time list-detail screens
  e2e/               Playwright browser tests
docker-compose.yml   postgres + redis + api
docs/                design specs, decision log, implementation plans
```

## Useful commands

```bash
pnpm api:dev                            # API in watch mode (alias)
pnpm --filter api migration:generate src/database/migrations/<Name>   # new migration from entity changes
pnpm --filter api migration:run         # apply migrations
pnpm --filter web build                 # type-check + production build of the web app
```
