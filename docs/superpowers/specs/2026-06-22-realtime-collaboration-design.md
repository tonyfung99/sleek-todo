# Real-Time Collaboration — Design Spec

> Extends the core [SleekTodo Design Spec](./2026-06-22-sleektodo-design.md). Refines §10 (Real-Time Architecture) and stays inside the §9.3 scaling stance and §13 "what we did NOT build" boundary.

## 1. Objective

Make a shared todo list feel live and collaborative without a full collaborative-document engine. When one member edits or removes a todo, every other member viewing that list sees the change **in real time, without refreshing**. While someone is editing a todo, that todo is **locked** for everyone else so two people never mutate the same action item at once.

**Guiding framing:** a todo is an **action item, not a document.** We deliberately do *not* support two people typing into the same field simultaneously (no CRDT/OT, no per-character merge, no live cursors). Concurrency is resolved by *exclusion* (one editor at a time per todo), not by *merge*.

## 2. Scope Decisions

### In scope
- **Live propagation** of todo create / update / delete to all members viewing the list.
- **Enforced per-todo edit lock**: while a member is editing a todo, the entire todo (all fields) is read-only for others.
- **Presence**: list-level "who is viewing" avatars + a per-todo "X is editing" indicator.
- Works across **multiple API instances** (socket.io Redis adapter + shared lock/presence state in Redis).

### Out of scope (deliberately — consistent with core spec §13)
- Character-level concurrent co-editing (CRDT/OT, e.g. Yjs/Hocuspocus).
- Live remote cursors / selections.
- Operational-transform merge, offline edit queues, event sourcing / CDC / replay.
- Field-level locking (we lock the **whole** todo, not individual fields).

## 3. Prerequisites & Sequencing

This feature layers on top of capabilities built in earlier plans of the build sequence (core spec §15). It **cannot** be implemented before they exist:

| Needs | From | Why |
|---|---|---|
| Auth (JWT) | Plan 2 | Authenticate socket connections; identify who holds a lock / is present. |
| Lists + memberships + RBAC | Plan 3 | Room membership check on join; only members receive events. |
| Todo CRUD + optimistic concurrency (version/ETag) | Plan 4 | The mutations we broadcast; the 409 backstop. |
| Real-time gateway + Redis adapter + multi-instance/nginx | Plan 8 | The socket transport this builds on. |

**Placement:** this spec is realized as a refinement of **Plan 8 (real-time gateway)** plus a dedicated collaboration plan executed after Plans 2–4 and 8. The foundation (Plan 1) is already complete and does not contain any of this yet.

## 4. Architecture

### 4.1 Transport & rooms
- **socket.io** gateway (per core §10). Connections are **JWT-authed** at handshake; an unauthenticated or invalid token is rejected.
- **One room per list**: `list:{listId}`. A socket may `join` a list room only after a **membership/RBAC check** (the user must be a member of that list). VIEWER role may observe and receive events but cannot acquire edit locks; EDITOR/OWNER may.
- With 2+ API instances, the **socket.io Redis adapter** fans room events across instances, so a client on instance B sees an edit processed on instance A.

### 4.2 State stores
- **Postgres** — authoritative todo/list data (unchanged; existing entities). No schema change for this feature.
- **Redis** — *ephemeral* collaboration state only:
  - **Locks**: `lock:list:{listId}:todo:{todoId}` → `{ userId, displayName, socketId }`, written with an atomic `SET … NX` and a coarse TTL (see §5).
  - **Presence**: `presence:list:{listId}` → set/hash of currently-connected members (`userId`, `displayName`, `color`).
  - These must **not** outlive a disconnect, so they live in Redis, never Postgres. This keeps the core spec's "best-effort real-time, no event store" stance (§13) intact.

## 5. Lock Model (core of this feature)

**Per-todo, enforced, event-driven.** Driven by editor actions over the socket, *not* by polling or an application-level heartbeat.

### 5.1 Lifecycle (happy path)
1. **Acquire** — client emits `editing:start { listId, todoId }` when the user focuses any editable part of a todo (a text field, or the moment before a one-click structured change). Server runs an **atomic** `SET lock:list:{listId}:todo:{todoId} {owner} NX EX {ttl}`:
   - Success → broadcast `lock:granted { todoId, userId, displayName }` to the room. Everyone else renders that todo **fully read-only** with a "🔒 {displayName} is editing" badge.
   - Key already exists → reply `lock:denied { todoId, heldBy }` to the requester only; their controls stay disabled.
2. **Hold** — while the user edits, the client's natural edit traffic (debounced autosave `PATCH`es, keystroke-driven events) **refreshes the TTL** server-side. There is **no separate heartbeat timer.**
3. **Release** — client emits `editing:stop { listId, todoId }` on blur / save / navigate-away → server `DEL`s the key → broadcast `lock:released { todoId }`. Others' controls re-enable.

### 5.2 Crash handling (why a TTL exists at all)
Two distinct failure modes, two mechanisms:
- **Client dies** (tab closed, network drop, browser crash) — the client never sends `editing:stop`. socket.io's *own* transport-level ping/pong detects the dead socket (~25–45 s with defaults) and fires a server-side **`disconnect`**. The gateway's `disconnect` handler **releases every lock that socket held** and updates presence. *No application heartbeat is involved* — the framework provides this.
- **Server instance dies** (the API replica holding the socket crashes) — its `disconnect` handler dies with the process, so the lock sitting in *shared Redis* has no one to release it. The **coarse Redis TTL (~60–90 s)** is the self-healing backstop: the orphaned lock expires on its own. The TTL is refreshed by ongoing edit events (§5.1.2), so an actively-edited todo never expires mid-edit; a todo left *focused but idle* past the TTL releases on its own (idle ≠ editing) and the client transparently re-acquires on the next keystroke.

This is the **only** role of the TTL — crash insurance, not normal-path timing. Normal lock timing is purely event-driven.

### 5.3 Field gating (todo = action item)
The lock gates the **whole todo**, every field — name, description, status, priority, due date, dependencies. There is no per-field locking.
- **Sustained edits** (name/description text) hold the lock across the focus→blur session.
- **One-click structured actions** (status checkbox, priority/due-date change) are **acquire → mutate → release atomically**: the lock is held only for the instant of the write. If another member holds the lock, those controls are disabled.

A todo locked by someone else is, for everyone else, entirely read-only.

## 6. Live Edit & Remove Propagation

- **Edit** — the authoritative mutation is the existing `PATCH /todos/:id` (whole-field, honors `If-Match` ETag), driven from the client as **debounced autosave**. After the write commits, the **Todo service emits `todo:updated { todo }` through the gateway** (in-process call; the socket.io Redis adapter fans it across instances) to `list:{listId}`; receiving clients **patch their local cache** (e.g. React Query) so the new text/status appears live with no refresh. This covers *all* fields, not just status.
- **Remove** — `DELETE /todos/:id` (soft delete, per core §8.5) → broadcast `todo:deleted { todoId }` → clients remove the row live.
- **Create** — `POST /lists/:id/todos` → broadcast `todo:created { todo }` → clients insert the row live.

### 6.1 Conflict backstop
Because every mutation is gated by the enforced lock, conflicting concurrent writes should not occur. The existing **optimistic-concurrency** check (`version` / `If-Match` ETag, core §8.4 / §9.2) is retained as **defense-in-depth** for the rare gap (e.g. a lock expiring at the exact moment of a write): a stale `If-Match` → **HTTP 409**, and the client refetches and reconciles. Real-time remains **best-effort**; Postgres + the 409 are the source of truth.

## 7. Presence

- On `join`, the gateway adds the member to `presence:list:{listId}` and broadcasts `presence:update { viewers: [{ userId, displayName, color }] }`. The list header shows viewer avatars ("🟢 Alice  🔵 Bob — 2 viewing").
- The **per-todo "is editing" indicator is derived from lock state** (§5), not a separate store — no duplication.
- On `disconnect` (or socket leaving the room), the member is removed from the presence set and `presence:update` is re-broadcast. Presence entries also carry a short TTL refreshed by the socket's liveness, so a crashed client falls out of presence automatically.

## 8. Reconnect & Correctness

Real-time delivery is **best-effort**. On reconnect the client:
1. Re-fetches the list's todos over REST (authoritative Postgres state) — this reconciles any events missed while disconnected.
2. Re-joins the list room and re-subscribes.
3. Any lock it previously held has already been released (by `disconnect` or TTL); it re-acquires on the next focus.

There is no event replay / event store — consistent with core §13.

## 9. Multi-Instance & Scale

- Stateless API replicas + Redis (socket.io adapter + lock/presence store) + **sticky sessions at nginx** for the socket tier (core §9.3).
- Locks use atomic Redis `SET NX`, so **enforcement is global** across instances regardless of which replica each user is connected to.
- **Per-todo** (not per-list) locking keeps contention fine-grained; optimistic reads never block. Comfortably supports **tens** of concurrent editors per list (realistic Notion-like use).
- A single list with **thousands** of simultaneous editors (the "celebrity"/hot-key problem, DDIA §4) stays **explicitly out of scope**; mitigation path if ever needed = throttled/batched emits + lightweight invalidation signals (core §9.3).

## 10. Socket Event Protocol

| Direction | Event | Payload | Meaning |
|---|---|---|---|
| C → S | `list:join` | `{ listId }` | Subscribe to a list room (RBAC-checked). |
| C → S | `list:leave` | `{ listId }` | Unsubscribe. |
| C → S | `editing:start` | `{ listId, todoId }` | Request the per-todo edit lock. |
| C → S | `editing:stop` | `{ listId, todoId }` | Release the lock (blur/save). |
| S → C | `lock:granted` | `{ todoId, userId, displayName }` | Lock acquired (broadcast to room). |
| S → C | `lock:denied` | `{ todoId, heldBy }` | Lock is held by someone else (to requester). |
| S → C | `lock:released` | `{ todoId }` | Lock freed (broadcast to room). |
| S → C | `todo:created` | `{ todo }` | New todo (broadcast). |
| S → C | `todo:updated` | `{ todo }` | Todo changed (broadcast). |
| S → C | `todo:deleted` | `{ todoId }` | Todo soft-deleted (broadcast). |
| S → C | `presence:update` | `{ viewers: [...] }` | Current viewers of the list (broadcast). |

Mutations themselves go over **REST** (`PATCH`/`POST`/`DELETE`); after a successful write the Todo service emits the corresponding `todo:*` broadcast through the gateway (fanned out by the Redis adapter). The socket carries lock/presence traffic. (Lock acquire/release is the one place the socket drives state directly, because it is inherently connection-scoped.)

## 11. Testing Strategy

- **Unit (TDD):**
  - Lock service: acquire-when-free, deny-when-held, TTL-refresh-on-activity, release, release-on-disconnect, expiry self-heal.
  - Presence service: join / leave / dedupe / disconnect-cleanup.
  - RBAC join guard: non-member rejected; VIEWER cannot acquire a lock.
- **Integration (Testcontainers — real Redis + Postgres, two socket clients in one room):**
  1. A `editing:start` → B receives `lock:granted`; B's own `editing:start` → `lock:denied`.
  2. A `PATCH`es the todo → B receives `todo:updated` with the new value.
  3. A `DELETE`s → B receives `todo:deleted`.
  4. A disconnects mid-edit → B receives `lock:released` (disconnect cleanup).
  5. Lock auto-expiry after TTL when refreshes stop (server-crash simulation).
  6. Presence add/remove on connect/disconnect.

## 12. Deliberately NOT Built (decision log)

Character-level CRDT/OT co-typing; live remote cursors; operational-transform merge; offline edit queues; event sourcing / CDC / replay; per-field locking. Each carries real cost and is unjustified for an action-item model where one-editor-at-a-time exclusion delivers the collaborative feel. (Extends core spec §13.)
