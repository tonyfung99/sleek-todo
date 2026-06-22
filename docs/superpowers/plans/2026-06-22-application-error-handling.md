# Application Error Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every REST and real-time failure visible, accessible, and recoverable, with automatic sign-out for expired authenticated sessions.

**Architecture:** Normalize failures into a typed `ApiError` at the request boundary and expose one unauthorized callback for authenticated `401` responses. Keep error state contextual in each screen and render it through one accessible `ErrorAlert` component; `App` alone owns session-expiration transitions.

**Tech Stack:** React 18, TypeScript, Fetch API, Socket.IO client, Vitest, Testing Library, Playwright, CSS.

---

## File Map

- Create `web/src/api.test.ts`: request-boundary classification and unauthorized-callback tests.
- Modify `web/src/api.ts`: `ApiError`, normalization, and authenticated `401` notification.
- Create `web/src/ErrorAlert.tsx`: shared accessible contextual alert.
- Create `web/src/ErrorAlert.test.tsx`: semantics and action tests.
- Modify `web/src/icons.tsx`: Lucide-style warning icon.
- Modify `web/src/styles.css`: semantic alert, connection status, loading, and row error styles.
- Create `web/src/App.test.tsx`: session-expiration integration tests.
- Modify `web/src/App.tsx`: unauthorized handler and session-expired state.
- Modify `web/src/AuthScreen.tsx`: initial mode/message support and shared alert.
- Create `web/src/ListsScreen.test.tsx`: load, retry, and create failure tests.
- Modify `web/src/ListsScreen.tsx`: explicit load state and contextual failures.
- Modify `web/src/ListDetail.test.tsx`: todo, dependency, collaborator, and socket failure tests.
- Modify `web/src/ListDetail.tsx`: scoped async errors, rollback, retry, and connection status.
- Create `web/e2e/error-handling.e2e.spec.ts`: invalid-token recovery test.

## Task 1: Normalize API Failures

**Files:**
- Create: `web/src/api.test.ts`
- Modify: `web/src/api.ts`

- [ ] **Step 1: Write failing request-boundary tests**

Create tests that mock `globalThis.fetch` and assert the public API behavior:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, setUnauthorizedHandler } from './api';

describe('api errors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setUnauthorizedHandler(null);
  });

  it('preserves a domain message and classifies a conflict', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Version mismatch' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(api.updateTodo('token', 't1', 1, { name: 'Changed' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      kind: 'conflict',
      message: 'Version mismatch',
    });
  });

  it('normalizes a network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.lists('token')).rejects.toEqual(
      expect.objectContaining({
        kind: 'network',
        message: "Couldn't connect. Check your connection and try again.",
      }),
    );
  });

  it('notifies once for an authenticated 401', async () => {
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Invalid token' }), { status: 401 }),
    );
    await expect(api.lists('expired')).rejects.toBeInstanceOf(ApiError);
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not notify for invalid login credentials', async () => {
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Invalid credentials' }), { status: 401 }),
    );
    await expect(api.login('user@example.com', 'wrong')).rejects.toMatchObject({
      message: 'Invalid credentials',
    });
    expect(unauthorized).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm --filter web test -- api.test.ts`

Expected: FAIL because `ApiError` and `setUnauthorizedHandler` are not exported and network errors are raw `TypeError` objects.

- [ ] **Step 3: Implement the typed error boundary**

Add these exports and classification rules to `web/src/api.ts`:

```ts
export type ApiErrorKind =
  | 'auth'
  | 'validation'
  | 'permission'
  | 'not-found'
  | 'conflict'
  | 'network'
  | 'unexpected';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly kind: ApiErrorKind,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'permission';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'validation';
  return 'unexpected';
}

function fallbackForStatus(status: number): string {
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return 'That item is no longer available.';
  return 'Something went wrong. Please try again.';
}
```

Wrap `fetch` in `try/catch`; convert `TypeError` into the specified network `ApiError`. For non-OK responses, read a string `message`, fall back by status, construct `ApiError`, invoke `unauthorizedHandler` only when `token` is present and status is `401`, then throw the same error.

- [ ] **Step 4: Run the request-boundary tests and verify GREEN**

Run: `pnpm --filter web test -- api.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit the request boundary**

```bash
git add web/src/api.ts web/src/api.test.ts
git commit -m "feat(web): normalize API failures"
```

## Task 2: Build the Accessible Error Alert

**Files:**
- Create: `web/src/ErrorAlert.tsx`
- Create: `web/src/ErrorAlert.test.tsx`
- Modify: `web/src/icons.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Write failing component tests**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorAlert } from './ErrorAlert';

describe('ErrorAlert', () => {
  it('announces the message and exposes recovery actions', () => {
    const retry = vi.fn();
    const dismiss = vi.fn();
    render(<ErrorAlert message="Could not load lists." onRetry={retry} onDismiss={dismiss} />);
    expect(screen.getByRole('alert').textContent).toContain('Could not load lists.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the component test and verify RED**

Run: `pnpm --filter web test -- ErrorAlert.test.tsx`

Expected: FAIL because `ErrorAlert.tsx` does not exist.

- [ ] **Step 3: Implement the alert and styling**

Create `web/src/ErrorAlert.tsx`:

```tsx
import { WarningIcon } from './icons';

export function ErrorAlert({
  message,
  onRetry,
  onDismiss,
  compact = false,
}: {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`error-alert${compact ? ' error-alert-compact' : ''}`} role="alert">
      <WarningIcon size={18} />
      <span className="error-alert-message">{message}</span>
      {(onRetry || onDismiss) && (
        <div className="error-alert-actions">
          {onRetry && <button type="button" className="btn-link" onClick={onRetry}>Try again</button>}
          {onDismiss && <button type="button" className="btn-link" onClick={onDismiss}>Dismiss</button>}
        </div>
      )}
    </div>
  );
}
```

Add `WarningIcon` to `web/src/icons.tsx` using the existing SVG conventions. Add semantic `.error-alert`, `.error-alert-message`, `.error-alert-actions`, `.error-alert-compact`, `.loading-state`, and `.connection-status` rules to `styles.css`; use existing CSS variables, 8/12/16px spacing, wrapping layout, visible focus states, and a 44px minimum action height.

- [ ] **Step 4: Run the alert test and web build**

Run: `pnpm --filter web test -- ErrorAlert.test.tsx && pnpm --filter web build`

Expected: test PASS and build exits 0.

- [ ] **Step 5: Commit the shared feedback UI**

```bash
git add web/src/ErrorAlert.tsx web/src/ErrorAlert.test.tsx web/src/icons.tsx web/src/styles.css
git commit -m "feat(web): add accessible error alert"
```

## Task 3: Recover from Expired Sessions

**Files:**
- Create: `web/src/App.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/AuthScreen.tsx`

- [ ] **Step 1: Write the failing session-expiration test**

Mock `ListsScreen` so it captures the registered handler, render with stored auth, trigger the handler, and assert storage plus UI:

```tsx
it('clears an expired session and shows the login recovery message', async () => {
  localStorage.setItem('token', 'expired');
  localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'a@x.com', displayName: 'Alice' }));
  render(<App />);
  act(() => registeredUnauthorizedHandler?.());
  expect(localStorage.getItem('token')).toBeNull();
  expect(await screen.findByRole('button', { name: 'Log in' })).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain(
    'Your session expired. Please log in again.',
  );
});
```

Also assert a successful authentication clears this message.

- [ ] **Step 2: Run the App test and verify RED**

Run: `pnpm --filter web test -- App.test.tsx`

Expected: FAIL because `App` does not register an unauthorized handler or pass an initial alert/mode.

- [ ] **Step 3: Implement the session transition**

In `App.tsx`, add `authNotice`, register `setUnauthorizedHandler` in an effect, and use one idempotent callback that calls `clearSession()`, clears the open list, clears auth, and sets the session-expired message. Clean up by registering `null` on unmount. Clear `authNotice` in `handleAuth` and explicit logout.

Change `AuthScreen` props to:

```ts
{
  onAuth: (result: AuthResult) => void;
  initialMode?: 'login' | 'register';
  initialError?: string | null;
}
```

Initialize mode from `initialMode`, render `initialError` through `ErrorAlert`, and pass `initialMode="login"` plus `authNotice` from `App`.

- [ ] **Step 4: Run App and existing web tests**

Run: `pnpm --filter web test -- App.test.tsx && pnpm --filter web test`

Expected: all tests PASS.

- [ ] **Step 5: Commit session recovery**

```bash
git add web/src/App.tsx web/src/App.test.tsx web/src/AuthScreen.tsx
git commit -m "feat(web): recover from expired sessions"
```

## Task 4: Handle List-Screen Failures

**Files:**
- Create: `web/src/ListsScreen.test.tsx`
- Modify: `web/src/ListsScreen.tsx`

- [ ] **Step 1: Write failing list load and create tests**

Cover these exact assertions:

```tsx
it('shows a retry alert instead of an empty state when loading fails', async () => {
  apiMocks.lists.mockRejectedValueOnce(new Error('Could not load lists'));
  renderScreen();
  expect((await screen.findByRole('alert')).textContent).toContain('Could not load lists');
  expect(screen.queryByText(/No lists yet/)).toBeNull();
  apiMocks.lists.mockResolvedValueOnce([{ id: 'l1', name: 'Work', ownerId: 'u1' }]);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Work')).toBeTruthy();
});

it('preserves the list name when creation fails', async () => {
  apiMocks.lists.mockResolvedValue([]);
  apiMocks.createList.mockRejectedValue(new Error('Could not create list'));
  renderScreen();
  const input = await screen.findByLabelText('New list name');
  fireEvent.change(input, { target: { value: 'Planning' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Could not create list');
  expect((input as HTMLInputElement).value).toBe('Planning');
});
```

- [ ] **Step 2: Run the screen test and verify RED**

Run: `pnpm --filter web test -- ListsScreen.test.tsx`

Expected: FAIL because load rejection is unhandled and create rejection has no alert.

- [ ] **Step 3: Implement explicit load and create states**

Replace `loaded` with `loadState: 'loading' | 'ready' | 'error'` and `loadError`. Extract an async `loadLists` that clears the error, sets loading, catches with `setLoadError((error as Error).message)`, and ignores results after effect cleanup. Add `createError` and `createBusy`; preserve `name` on failure and clear it only after success. Render `Loading lists…`, `ErrorAlert` with `onRetry={loadLists}`, or list/empty content according to `loadState`. Render the creation error directly below the composer.

- [ ] **Step 4: Run the list tests and build**

Run: `pnpm --filter web test -- ListsScreen.test.tsx && pnpm --filter web build`

Expected: tests PASS and build exits 0.

- [ ] **Step 5: Commit list-screen handling**

```bash
git add web/src/ListsScreen.tsx web/src/ListsScreen.test.tsx
git commit -m "feat(web): surface list operation failures"
```

## Task 5: Handle Todo Load and Mutation Failures

**Files:**
- Modify: `web/src/ListDetail.test.tsx`
- Modify: `web/src/ListDetail.tsx`

- [ ] **Step 1: Extend API mocks and write failing tests**

Add mocks for `createTodo`, `updateTodo`, `deleteTodo`, `dependencies`, `addDependency`, and `removeDependency`. Add tests proving:

```tsx
it('shows retry feedback instead of an empty state when todos fail to load', async () => {
  apiMocks.todos.mockRejectedValueOnce(new Error('Could not load todos'));
  renderDetail();
  expect((await screen.findByRole('alert')).textContent).toContain('Could not load todos');
  expect(screen.queryByText(/Nothing here yet/)).toBeNull();
  apiMocks.todos.mockResolvedValueOnce([todo]);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByDisplayValue('Buy milk')).toBeTruthy();
});

it('preserves composer input when todo creation fails', async () => {
  apiMocks.createTodo.mockRejectedValue(new Error('Could not add todo'));
  renderDetail();
  const input = await screen.findByLabelText('New todo name');
  fireEvent.change(input, { target: { value: 'Call supplier' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Could not add todo');
  expect((input as HTMLInputElement).value).toBe('Call supplier');
});

it('keeps a todo visible and reports a failed delete in its row', async () => {
  apiMocks.deleteTodo.mockRejectedValue(new Error('Could not delete todo'));
  renderDetail();
  const row = await screen.findByTestId('todo-row-t1');
  fireEvent.click(within(row).getByRole('button', { name: 'Delete todo' }));
  expect((await within(row).findByRole('alert')).textContent).toContain('Could not delete todo');
  expect(screen.getByDisplayValue('Buy milk')).toBeTruthy();
});
```

Add one fake-timer autosave test that rejects `updateTodo`, resolves the subsequent `todos` reload with the confirmed todo, and asserts both the restored name and retained row alert.

- [ ] **Step 2: Run ListDetail tests and verify RED**

Run: `pnpm --filter web test -- ListDetail.test.tsx`

Expected: the new tests FAIL because load/create/delete/autosave failures have no scoped alert.

- [ ] **Step 3: Implement todo-scoped state and recovery**

Add:

```ts
const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
const [loadError, setLoadError] = useState<string | null>(null);
const [createError, setCreateError] = useState<string | null>(null);
const [createBusy, setCreateBusy] = useState(false);
const [todoErrors, setTodoErrors] = useState<Record<string, string>>({});
```

Extract `loadTodos`; use it for initial load and Retry. Wrap create, patch, autosave, and delete operations. Clear only the affected error when retrying. On update/autosave failure, await a confirmed todo reload, then set the original failure message in `todoErrors[todo.id]`; on delete failure, do not remove the row. Render load feedback above the composer, create feedback below the composer, and compact row feedback inside the corresponding `<li>`.

- [ ] **Step 4: Run ListDetail tests**

Run: `pnpm --filter web test -- ListDetail.test.tsx`

Expected: all ListDetail tests PASS.

- [ ] **Step 5: Commit todo operation handling**

```bash
git add web/src/ListDetail.tsx web/src/ListDetail.test.tsx
git commit -m "feat(web): surface todo operation failures"
```

## Task 6: Scope Dependency and Real-Time Failures

**Files:**
- Modify: `web/src/ListDetail.test.tsx`
- Modify: `web/src/ListDetail.tsx`

- [ ] **Step 1: Write failing dependency and socket tests**

Capture socket event callbacks in the mock. Add tests that reject dependency load/removal and verify the alert appears only inside the affected todo row. Add:

```tsx
it('shows and clears real-time reconnection status', async () => {
  renderDetail();
  await screen.findByDisplayValue('Buy milk');
  act(() => socketHandlers.disconnect?.());
  expect(screen.getByRole('status').textContent).toContain(
    'Live updates disconnected. Reconnecting…',
  );
  act(() => socketHandlers.connect?.());
  expect(screen.queryByText(/Live updates disconnected/)).toBeNull();
});
```

Add a socket `connect_error` test whose error has `{ data: { status: 401 } }` and assert the `onUnauthorized` prop is invoked.

- [ ] **Step 2: Run ListDetail tests and verify RED**

Run: `pnpm --filter web test -- ListDetail.test.tsx`

Expected: FAIL because dependency errors use one shared string and socket status/auth events are not handled.

- [ ] **Step 3: Implement scoped dependency and connection handling**

Replace `depError` with `depErrors: Record<string, string>`. Wrap `toggleDeps`, `addDep`, and `removeDep`; preserve current dependency data on failure and render only `depErrors[todo.id]` in that panel. Add `connectionLost` state. On `disconnect` and non-auth `connect_error`, set it true; on `connect`, clear it and join the list. Add `onUnauthorized` to `ListDetail` props and invoke it for socket errors with status `401`. Render a polite connection status near the detail header.

Pass the same idempotent unauthorized callback from `App` into `ListDetail`.

- [ ] **Step 4: Run all component tests and build**

Run: `pnpm --filter web test && pnpm --filter web build`

Expected: all tests PASS and build exits 0.

- [ ] **Step 5: Commit dependency and socket handling**

```bash
git add web/src/App.tsx web/src/ListDetail.tsx web/src/ListDetail.test.tsx web/src/styles.css
git commit -m "feat(web): report dependency and realtime failures"
```

## Task 7: Verify Expired-Token Recovery End to End

**Files:**
- Create: `web/e2e/error-handling.e2e.spec.ts`

- [ ] **Step 1: Write the failing browser test**

```ts
import { expect, test } from '@playwright/test';

test('an invalid stored token signs the user out with a visible warning', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'invalid-token');
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 'stale', email: 'stale@example.com', displayName: 'Stale user' }),
    );
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(
    'Your session expired. Please log in again.',
  );
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
});
```

- [ ] **Step 2: Run the E2E test**

Run: `pnpm --filter web e2e -- error-handling.e2e.spec.ts`

Expected after Tasks 1–6: PASS. If it fails, fix only the session-expiration path demonstrated by the browser trace, then rerun until PASS.

- [ ] **Step 3: Run the full verification suite**

Run:

```bash
pnpm --filter web test
pnpm --filter web build
pnpm lint
pnpm --filter web e2e -- error-handling.e2e.spec.ts collab.e2e.spec.ts features.e2e.spec.ts
```

Expected: unit/component tests PASS, build exits 0, lint has no errors, and all selected E2E tests PASS.

- [ ] **Step 4: Perform responsive and accessibility smoke checks**

At 375px and desktop width, verify alerts wrap without horizontal scrolling; keyboard focus reaches Try again/Dismiss; session and action errors are announced by their roles; connection status uses a polite live region; no alert depends on color alone.

- [ ] **Step 5: Commit E2E coverage**

```bash
git add web/e2e/error-handling.e2e.spec.ts
git commit -m "test(e2e): cover expired session recovery"
```
