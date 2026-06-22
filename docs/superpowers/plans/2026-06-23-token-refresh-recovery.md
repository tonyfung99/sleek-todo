# Token Refresh Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transparently refresh and replay one authenticated request after an access-token `401`, redirecting to login only when refresh recovery fails.

**Architecture:** The API request boundary owns a single-flight recovery map keyed by failed access token and permits exactly one replay. `App` registers the recovery implementation because it owns persisted/in-memory auth; the existing terminal unauthorized callback remains responsible for clearing only the matching session.

**Tech Stack:** React 18, TypeScript, Fetch API, Vitest, Testing Library, Playwright.

---

### Task 1: Add single-flight recovery and one replay to the API client

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/api.test.ts`

- [ ] **Step 1: Write failing API recovery tests**

Extend `api.test.ts` with deferred fetch responses and a new registered recovery callback. Prove these behaviors:

```ts
it('recovers an authenticated 401 and replays once with the replacement token', async () => {
  const recover = vi.fn().mockResolvedValue('new-token');
  setTokenRecoveryHandler(recover);
  vi.mocked(fetch)
    .mockResolvedValueOnce(response(401, { message: 'Invalid token' }))
    .mockResolvedValueOnce(response(200, [{ id: 'l1', name: 'Work', ownerId: 'u1' }]));

  await expect(api.lists('old-token')).resolves.toEqual([
    { id: 'l1', name: 'Work', ownerId: 'u1' },
  ]);
  expect(recover).toHaveBeenCalledOnce();
  expect(recover).toHaveBeenCalledWith('old-token');
  expect(vi.mocked(fetch).mock.calls[1]?.[1]).toMatchObject({
    headers: expect.objectContaining({ Authorization: 'Bearer new-token' }),
  });
});
```

Add tests for:

- Two concurrent requests receiving `401` for `old-token` share one recovery callback/promise and both replay with `new-token`.
- A replayed `401` performs no second recovery and invokes terminal unauthorized handling with `new-token`.
- Recovery resolving `null` or rejecting invokes terminal handling with the original failed token and rejects safely.
- Public `api.login` and `api.refresh` `401` responses invoke neither recovery nor terminal authenticated handling.
- `403` and network failures are not recovered or replayed.
- An ownership-safe cleanup from an old recovery registration cannot clear a newer recovery handler.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter web test -- api.test.ts`

Expected: FAIL because `setTokenRecoveryHandler` and request replay do not exist.

- [ ] **Step 3: Implement recovery registration and single-flight coordination**

Add to `api.ts`:

```ts
type TokenRecoveryHandler = (failedToken: string) => Promise<string | null>;

let tokenRecoveryHandler: TokenRecoveryHandler | null = null;
const recoveryByToken = new Map<string, Promise<string | null>>();

export function setTokenRecoveryHandler(handler: TokenRecoveryHandler): () => void;
export function setTokenRecoveryHandler(handler: null): void;
export function setTokenRecoveryHandler(
  handler: TokenRecoveryHandler | null,
): (() => void) | void {
  tokenRecoveryHandler = handler;
  if (!handler) return;
  return () => {
    if (tokenRecoveryHandler === handler) tokenRecoveryHandler = null;
  };
}

export function recoverAccessToken(failedToken: string): Promise<string | null> {
  const existing = recoveryByToken.get(failedToken);
  if (existing) return existing;
  if (!tokenRecoveryHandler) return Promise.resolve(null);

  const handler = tokenRecoveryHandler;
  const recovery = Promise.resolve(handler(failedToken))
    .catch(() => null)
    .finally(() => {
      if (recoveryByToken.get(failedToken) === recovery) recoveryByToken.delete(failedToken);
    });
  recoveryByToken.set(failedToken, recovery);
  return recovery;
}
```

The test cleanup must register both handlers as `null` so module state cannot leak between tests.

- [ ] **Step 4: Add one-replay request logic**

Change the private request signature to accept `allowRecovery = true`. After parsing a token-bearing `401`:

```ts
if (token && res.status === 401) {
  if (allowRecovery) {
    const replacementToken = await recoverAccessToken(token);
    if (replacementToken) return req<T>(path, init, replacementToken, false);
  }
  unauthorizedHandler?.(token);
}
throw error;
```

Do not recover public requests without a token. Do not recover network/non-401 failures. The replay uses `false`, preventing recursive refresh. Preserve success, 204, safe messages, and request bodies/headers.

- [ ] **Step 5: Run focused tests and build**

Run: `pnpm --filter web test -- api.test.ts && pnpm --filter web build`

Expected: API tests PASS and build exits 0.

- [ ] **Step 6: Commit API recovery**

```bash
git add web/src/api.ts web/src/api.test.ts
git commit -m "feat(web): refresh and replay expired requests"
```

### Task 2: Connect recovery to App session state

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.test.tsx`

- [ ] **Step 1: Write failing App recovery tests**

Update the API mock to capture `setTokenRecoveryHandler`. Add:

```ts
it('silently replaces the session when access-token recovery succeeds', async () => {
  apiMocks.refresh.mockResolvedValue(newSession);
  await renderStoredSession();

  let recovered: string | null | undefined;
  await act(async () => {
    recovered = await apiMocks.tokenRecoveryHandler?.(storedSession.accessToken);
  });

  expect(recovered).toBe(newSession.accessToken);
  expect(localStorage.getItem('token')).toBe(newSession.accessToken);
  expect(screen.getByRole('heading', { name: 'My lists' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
```

Add tests that:

- Refresh rejection returns `null`; the subsequent terminal unauthorized callback clears the matching session and shows the exact warning.
- Recovery called with an old token after a manual new login returns `null`, does not call refresh, does not change storage, and cannot clear the new session.
- Recovery result arriving after the user manually logs into a different session returns `null` and does not overwrite that newer identity.
- Recovery registration cleanup is ownership-safe through the mocked API contract.

- [ ] **Step 2: Run focused App tests and verify RED**

Run: `pnpm --filter web test -- App.test.tsx`

Expected: FAIL because App does not register a token recovery handler.

- [ ] **Step 3: Implement App-owned recovery**

Import `setTokenRecoveryHandler`. Add a stable callback:

```ts
const recoverSession = useCallback(async (failedToken: string): Promise<string | null> => {
  if (authRef.current?.accessToken !== failedToken) return null;
  try {
    const result = await api.refresh();
    if (authRef.current?.accessToken !== failedToken) return null;
    authRef.current = result;
    saveSession(result);
    setAuth(result);
    setAuthNotice(null);
    return result.accessToken;
  } catch {
    return null;
  }
}, []);
```

Register it in an effect and return the ownership-safe unsubscribe:

```ts
useEffect(() => setTokenRecoveryHandler(recoverSession), [recoverSession]);
```

Do not clear the session inside `recoverSession`; returning `null` lets the request boundary invoke the existing terminal unauthorized callback with the matching failed token. Preserve initial refresh-cookie restoration, manual login, logout, and stale-token protections.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
pnpm --filter web test -- App.test.tsx api.test.ts
pnpm --filter web test
pnpm --filter web build
```

Expected: focused tests PASS, full web tests PASS, build exits 0.

- [ ] **Step 5: Commit App recovery**

```bash
git add web/src/App.tsx web/src/App.test.tsx
git commit -m "feat(web): recover expired authenticated sessions"
```

### Task 3: Extend browser coverage

**Files:**
- Create: `web/e2e/error-handling.e2e.spec.ts`

- [ ] **Step 1: Add valid-refresh recovery scenario**

Create a browser context first and register through `context.request`, which shares its cookie jar with pages in that context, so the browser receives a valid refresh cookie. Seed only localStorage's access token with `invalid-access-token` and the registered user. Navigate to the app and assert the protected My lists screen remains visible, localStorage receives a different valid token, and no session-expired alert appears.

- [ ] **Step 2: Add invalid-refresh redirect scenario**

Create a fresh browser context without a refresh cookie, seed localStorage with an invalid token and user, navigate, then assert login mode, the exact session-expired alert, and cleared token/user storage.

- [ ] **Step 3: Run focused E2E**

Run: `pnpm --filter web e2e -- error-handling.e2e.spec.ts`

Expected: both scenarios PASS.

- [ ] **Step 4: Commit E2E coverage**

```bash
git add web/e2e/error-handling.e2e.spec.ts
git commit -m "test(e2e): cover token refresh recovery"
```
