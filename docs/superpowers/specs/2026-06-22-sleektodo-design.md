# SleekTodo — Design Spec

**Date:** 2026-06-22
**Project:** SleekTodo — a Notion-style collaborative to-do application
**Context:** SleekFlow Software Engineer interview project. The brief is deliberately over-scoped; prioritization and reasoning are graded as heavily as code.

---

## 1. Objective & Guiding Principle

Build a collaborative to-do application: multiple users, multiple shareable lists, login-based access control, with a backend API and a simple functional web UI.

**Guiding principle for scope:** every "advanced" element must be *forced by a requirement in the brief*, never added for its own sake. Resume-driven over-engineering is penalized as hard as a too-basic stack. The decision log will explicitly state what we **deliberately did not build** and why — that restraint is part of the deliverable.

---

## 2. Scope Decisions

### In scope — Core (must build)
- **Auth** — registration + login, JWT **access + refresh-token rotation** (short-lived access token; refresh token in httpOnly cookie; rotation on refresh; server-side revocation). *Auth is promoted from nice-to-have to core* because access control cannot exist without identity (see §3 interpretation).
- **Collaborative lists with RBAC** — multiple to-do lists; each list has members with role `OWNER | EDITOR | VIEWER`.
- **Todo CRUD** — name, description, due date, status, priority.
- **Recurring tasks** — daily / weekly / monthly / custom (interval-based).
- **Task dependencies** — within a single list; dependency-gated status transitions; cycle detection.
- **Filtering & sorting** — server-side, by status / priority / due date / dependency status; sort by due date / priority / status / name.
- **Simple web UI** — functional, not polished.
- **Non-functional requirements** — concurrent multi-user access; no permanent data loss on delete; 10,000+ items without UX degradation.

### In scope — Nice-to-haves we keep
- **Real-time collaboration** (WebSocket live updates within a list, multi-instance via Redis pub/sub backplane).
- **Docker + CI** (`docker-compose` for api + web + postgres + redis + nginx; GitHub Actions running tests).
- **Architecture diagram** (in README / decision log).
- **Advanced upgrades:** ETag/`If-Match` optimistic concurrency; Testcontainers integration tests; pino structured logging + health/readiness probes; OpenTelemetry tracing.

### Deliberately deferred (documented, not built)
- Bulk operations.
- Full RRULE (iCal) recurrence — we do interval-based custom only.
- Granular per-todo permissions — RBAC is at list level.
- Durable message queue / BullMQ / transactional outbox — real-time is best-effort fan-out, not a system of record.
- CDC / event sourcing, microservices, GraphQL, Kafka/RabbitMQ, Kubernetes.

---

## 3. Requirement Interpretations (for the decision log)

| Ambiguity | Interpretation | Reasoning |
|---|---|---|
| "Multiple users accessing **the same TODO list**" + auth only nice-to-have | A Notion-style system of **multiple shareable lists** with **login-based access control**; auth is therefore **core**. | The literal phrase implies shared/collaborative lists. Real-time only becomes meaningful with shared state. Access control is impossible without identity, so auth cannot truly be optional. |
| Recurring completion semantics | On completion: keep the completed occurrence as history; create a **new `NOT_STARTED` occurrence** with `dueDate = oldDueDate + interval × unit`. | Predictable schedule, preserves history (aligns with "no permanent loss" spirit). Advancing from due date (not completion time) avoids drift. |
| "Custom" recurrence depth | **Interval-based**: unit (`DAY/WEEK/MONTH`) × interval count. daily/weekly/monthly are sugar for (DAY,1)/(WEEK,1)/(MONTH,1). | Covers realistic cases, bounded, testable. Full RRULE is over-investment. |
| Dependency scope | Dependencies are **within a single list only**. | Keeps the graph local — preserves partition locality (no cross-partition joins if we ever shard by `listId`) and simplifies cycle detection. |
| Archived dependency | An `ARCHIVED`-but-not-`COMPLETED` prerequisite **still blocks**; only `COMPLETED` unblocks. | Safe default — archiving is not completion. Noted as a reversible interpretation. |
| "No permanent loss on delete" | **Soft delete** (`deletedAt`), recoverable; distinct from the `ARCHIVED` status. | Archived = a normal visible workflow state; deleted = removed but retained. Two different concepts. |
| "Handle 10,000+ items" | Server-side pagination + filtering + sorting + indexes; never ship 10k rows to the browser. | At 10k, indexes + pagination are *plenty*; honest about this rather than over-building. Scaling path documented (§9). |

---

## 4. Architecture (DDIA-grounded)

Mapped to *Designing Data-Intensive Applications* three pillars.

### Reliability
- Optimistic concurrency (version column + ETag/`If-Match`) → stale writes return **409 Conflict**.
- **SERIALIZABLE (SSI) + retry** for the write-skew-prone operations (dependency-gate transition, cycle-creating dependency add); **transaction + `SELECT … FOR UPDATE`** for single-row recurring completion. Default isolation is Read Committed, so these are applied surgically (see §9.2).
- Soft delete → no permanent data loss.
- Stateless API replicas; timeouts + retries with exponential backoff + jitter on Redis; health/readiness probes; graceful degradation (real-time is best-effort, DB is source of truth).

### Scalability
- Stateless API → run **2 replicas behind nginx**, which is what *forces* the **Redis pub/sub backplane** for real-time fan-out across instances.
- Server-side pagination + composite indexes for the 10k+ requirement.
- Honest scaling path beyond this scale: read replicas (with read-your-writes caveat), then **partition by `listId`** (preserves locality; dependencies are within-list so no cross-partition joins).

### Maintainability
- NestJS layered modules (controller → service → repository), DI, DTO validation.
- Auto-generated OpenAPI/Swagger.
- Tests (unit + Testcontainers integration); structured logging; tracing.

### Why relational (DDIA §1)
todos↔dependencies is a **many-to-many graph**; lists↔members↔todos need **referential integrity + joins**. A document store would push this complexity into application code. The one graph-flavored access pattern (cycle detection) is handled with a bounded recursive check, not a graph DB.

---

## 5. Tech Stack

| Layer | Choice |
|---|---|
| Backend | **NestJS** (TypeScript), layered modules |
| ORM | **TypeORM** + migrations |
| Database | **PostgreSQL** |
| Cache / real-time backplane | **Redis** (cache + socket.io Redis adapter pub/sub) |
| Real-time | **socket.io**, room-per-list |
| Frontend | **React + Vite + TypeScript**, React Query, socket.io-client |
| Validation | class-validator / class-transformer |
| API docs | @nestjs/swagger → `/api/docs` |
| Auth | JWT access + refresh rotation, bcrypt |
| Observability | pino logging, health/readiness endpoints, OpenTelemetry |
| Tests | Jest (unit), Testcontainers + supertest (integration) |
| DevOps | docker-compose (api×2 + web + postgres + redis + nginx), GitHub Actions |
| Repo | Monorepo: `/api`, `/web`, `/docs`, `docker-compose.yml` |

---

## 6. Data Model

- **User**: `id` (uuid), `email` (unique), `passwordHash` (bcrypt), `displayName`, timestamps.
- **TodoList**: `id`, `name`, `description`, `ownerId`, `deletedAt` (soft delete), timestamps.
- **ListMembership**: `id`, `listId`, `userId`, `role` (`OWNER|EDITOR|VIEWER`), **unique(listId, userId)**.
- **Todo**: `id`, `listId`, `name`, `description`, `dueDate?`, `status` (`NOT_STARTED|IN_PROGRESS|COMPLETED|ARCHIVED`), `priority` (`LOW|MEDIUM|HIGH`), `version` (optimistic lock), `recurrenceUnit?` (`DAY|WEEK|MONTH`), `recurrenceInterval?` (int), `completedAt?`, `createdById`, `deletedAt` (soft delete), timestamps.
- **TodoDependency**: `dependentId`, `dependencyId` (both FK → Todo, same list enforced), **unique(dependentId, dependencyId)**.

**Recurrence** lives as two columns on Todo (no separate table); `null` unit ⇒ non-recurring. **Recurring todos require a due date** (validated).

**Indexes:** `(listId, status)`, `(listId, dueDate)`, `(listId, priority)`, `(listId, deletedAt)`; membership `(userId)`, `(listId)`.

---

## 7. API Design

- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
- `GET/POST /lists`, `GET/PATCH/DELETE /lists/:id`
- `POST /lists/:id/members`, `PATCH /lists/:id/members/:userId`, `DELETE /lists/:id/members/:userId`
- `GET /lists/:id/todos` (filter/sort/paginate query params), `POST /lists/:id/todos`
- `GET/PATCH/DELETE /todos/:id` (PATCH honors `If-Match` ETag → 409 on conflict)
- `POST /todos/:id/dependencies`, `DELETE /todos/:id/dependencies/:depId`
- Swagger at `/api/docs`.

**Cross-cutting:** JWT guard + list-role guard (RBAC); global validation pipe; consistent error envelope; **keyset (cursor) pagination** (`WHERE (sort_key, id) > (:cursor)`) — O(limit), stable under deep scrolling, unlike OFFSET.

**Filtering/sorting:** `status`, `priority`, `dueBefore`/`dueAfter`, `dependencyStatus=blocked|unblocked` (via `EXISTS` subquery over dependencies). Sort: `dueDate|priority|status|name`, asc/desc.

---

## 8. Key Behaviors & Edge Cases

1. **Recurring completion** (transaction + `SELECT … FOR UPDATE` row lock): set current → `COMPLETED` + `completedAt`; create new `NOT_STARTED` occurrence, `dueDate += interval × unit`; do **not** copy dependencies. Validate that recurring todos have a due date. Single-row, so a row lock suffices (no write skew).
2. **Dependency gate**: cannot move to `IN_PROGRESS` unless **all** dependencies are `COMPLETED`. Runs at **SERIALIZABLE** isolation (SSI) + retry — prevents the write-skew anomaly where C is unblocked while a dependency is concurrently un-completed (see §9).
3. **Cycle detection**: adding a dependency runs a DFS (recursive CTE / app-side) and rejects cycles; also at **SERIALIZABLE** + retry to prevent two concurrent adds (`A→B`, `B→A`) from jointly creating a cycle.
4. **Optimistic concurrency**: version/ETag mismatch → 409.
5. **Soft delete**: `deletedAt`; excluded from queries; recoverable. Distinct from `ARCHIVED`.
6. **Blocked/unblocked**: computed — blocked = has ≥1 non-`COMPLETED` dependency.

---

## 9. Concurrency, Consistency & Scale

### 9.1 NFR → implementation
- **Concurrent multi-user access** → see race-condition matrix below.
- **No permanent loss** → soft delete (`deletedAt`).
- **10,000+ items** → server-side keyset pagination + filter + sort + composite indexes; UI never loads the full set.

### 9.2 Race conditions (the "multiple users, same list" scenarios)

| # | Scenario | Anomaly | Mechanism |
|---|---|---|---|
| 1 | Two users edit the same todo | Lost update | Optimistic concurrency: `version` + ETag/`If-Match` → **409**, refetch & retry. Row-level (non-overlapping fields still collide) — accepted over silent loss / complex merge. |
| 2 | Two users complete the same recurring todo | Duplicate next occurrence | Transaction + `SELECT … FOR UPDATE`; second tx re-reads "already completed" → no-op. |
| 3 | Move C→`IN_PROGRESS` while a dependency is concurrently un-completed | **Write skew** (touches different rows, no single-row lock helps) | **SERIALIZABLE (SSI)** + retry on `40001`. |
| 4 | Concurrent `A→B` and `B→A` dependency adds | **Write skew** → cycle created | **SERIALIZABLE (SSI)** + retry. |

Postgres default isolation is **Read Committed**, which permits #3/#4 — hence SSI is applied specifically to those two operations. SSI is preferred over hand-rolled `FOR SHARE`/`FOR UPDATE` ordering: optimistic, **no deadlock risk**, cleaner to reason about. Retry wrapper: re-run the tx on serialization failure with exponential backoff + jitter, small bounded attempts.

### 9.3 Scaling path (DDIA §3–§4, honest about current scale)
- **Reads**: single-leader Postgres + indexes + connection pooling handles this scale comfortably. Growth → **read replicas**, which introduce **replication lag → read-your-writes anomaly**; mitigate by routing a user's reads to the leader briefly after their own write.
- **Writes**: single leader now. Growth → **partition by `listId`** (a list is a natural shard: deps are within-list ⇒ no cross-shard joins; real-time rooms are per-list ⇒ map cleanly to a shard/channel).
- **WebSocket connections** are stateful/memory-heavy → stateless API replicas + Redis backplane + **sticky sessions at nginx** scale the socket tier.
- **Hot list ("celebrity problem", DDIA §4)** — one list with *thousands* of simultaneous editors is the real bottleneck (lock contention + fan-out to thousands of subscribers on one channel). Per-todo (not per-list) locking keeps contention fine-grained and optimistic reads never block, so we comfortably support **tens** of concurrent editors per list (realistic for Notion-like use). Thousands-on-one-list is **explicitly out of scope**; mitigation path = throttled/batched emits + lightweight invalidation signals.

---

## 10. Real-Time Architecture

socket.io gateway; JWT-authed connections; one **room per list** (membership-checked on join). Todo create/update/delete publish to the room; with 2+ API instances, the **socket.io Redis adapter** fans events out across instances so a client on instance B sees an edit processed by instance A. Real-time is **best-effort**; clients reconcile via REST on reconnect (no CDC/event-sourcing — stated as a conscious non-goal).

---

## 11. Web UI

React + Vite + React Query. Screens: register/login → my lists → list detail (todo table + filter/sort controls + create/edit modal + dependency picker + sharing/members panel). socket.io-client applies live updates by invalidating/patching the React Query cache. Functional, minimal styling.

---

## 12. Testing Strategy

TDD on logic-heavy units: recurrence date math, cycle detection, dependency-gated transitions, RBAC guard, optimistic-conflict (409), soft-delete exclusion. **Testcontainers** spins up real Postgres for integration tests via supertest covering the main flows (auth, sharing, recurring completion, dependency gate, concurrency conflict). Frontend tests kept light.

---

## 13. What We Deliberately Did NOT Build (decision log)

Bulk operations; full RRULE; per-todo permissions; durable queue / outbox / CDC / event sourcing; microservices; GraphQL; Kafka/RabbitMQ; Kubernetes. Each: real cost, no requirement forcing it at this scope.

---

## 14. With More Time

- Bulk operations + multi-select UI.
- Transactional outbox + worker for guaranteed event delivery / audit log.
- Read replicas and `listId` partitioning once data outgrows a single node.
- Notifications (email/push) on due dates and shares.
- Richer recurrence (RRULE) and per-todo permissions if real use cases demand them.

---

## 15. Build Sequence

1. Monorepo scaffold + docker-compose (postgres, redis) + NestJS + TypeORM migrations + React/Vite.
2. Auth (register/login/refresh rotation/guards).
3. Lists + memberships + RBAC.
4. Todo CRUD + validation + soft delete + optimistic concurrency (ETag).
5. Dependencies + cycle detection + gated transitions.
6. Recurrence on completion.
7. Filtering/sorting/pagination + indexes.
8. Real-time gateway + Redis adapter + multi-instance/nginx.
9. Web UI wiring.
10. Observability (pino, health, OpenTelemetry), Swagger, README, decision log, architecture diagram, CI.
