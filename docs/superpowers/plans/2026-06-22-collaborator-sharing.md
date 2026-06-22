# Collaborator Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a list owner add an already-registered user as an editor from the list-detail UI and prove the resulting two-user collaboration flow in Playwright.

**Architecture:** Reuse the existing owner-authorized `POST /lists/:id/members` endpoint. Add the missing typed web client contract, keep the small owner-only form state inside `ListDetail`, and change the existing collaboration e2e to grant access through that form instead of a direct API call.

**Tech Stack:** React 18, TypeScript, Vite, Vitest + Testing Library, Playwright, existing NestJS membership API.

---

## File Structure

- Modify `web/src/types.ts` — define the membership role and response contract used by the web client.
- Modify `web/src/api.ts` — expose the existing add-member endpoint.
- Modify `web/src/ListDetail.test.tsx` — drive owner visibility, submission, pending, success, and error behavior.
- Modify `web/src/ListDetail.tsx` — render and manage the owner-only add-editor form.
- Modify `web/src/styles.css` — add responsive, accessible styles using existing tokens.
- Modify `web/e2e/collab.e2e.spec.ts` — add Bob through the UI before the existing concurrency assertions.

No backend file changes are required.

### Task 1: Drive the sharing UI with component tests

**Files:**
- Modify: `web/src/ListDetail.test.tsx`

- [ ] **Step 1: Replace the API mock with accessible hoisted mocks**

Import the interaction helpers and define mocks that tests can assert:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListDetail } from './ListDetail';

const apiMocks = vi.hoisted(() => ({
  todos: vi.fn(),
  addMember: vi.fn(),
}));

vi.mock('./api', () => ({ api: apiMocks }));

const todo = {
  id: 't1',
  listId: 'l1',
  name: 'Buy milk',
  description: null,
  dueDate: null,
  status: 'NOT_STARTED',
  priority: 'MEDIUM',
  recurrenceUnit: null,
  recurrenceInterval: null,
  version: 1,
  blocked: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.todos.mockResolvedValue([todo]);
});
```

Keep the existing socket mock. Add a local `renderDetail` helper so ownership is explicit:

```tsx
function renderDetail(ownerId = 'u1') {
  return render(
    <ListDetail
      token="tok"
      me={{ id: 'u1', email: 'alice@example.com', displayName: 'Alice' }}
      list={{ id: 'l1', name: 'Groceries', ownerId }}
      onBack={() => undefined}
    />,
  );
}
```

- [ ] **Step 2: Write failing owner-visibility tests**

```tsx
it('shows the add-editor form only to the list owner', () => {
  const { unmount } = renderDetail('u1');
  expect(screen.getByLabelText('Collaborator email')).toBeTruthy();
  unmount();

  renderDetail('someone-else');
  expect(screen.queryByLabelText('Collaborator email')).toBeNull();
});
```

- [ ] **Step 3: Write the failing success-path test**

```tsx
it('adds an editor with a trimmed email and confirms access', async () => {
  apiMocks.addMember.mockResolvedValue({
    id: 'm1',
    listId: 'l1',
    userId: 'u2',
    role: 'EDITOR',
  });
  renderDetail();

  fireEvent.change(screen.getByLabelText('Collaborator email'), {
    target: { value: '  bob@example.com  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add editor' }));

  await waitFor(() =>
    expect(apiMocks.addMember).toHaveBeenCalledWith(
      'tok',
      'l1',
      'bob@example.com',
      'EDITOR',
    ),
  );
  expect((screen.getByLabelText('Collaborator email') as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('status').textContent).toContain(
    'bob@example.com can now edit this list',
  );
});
```

- [ ] **Step 4: Write failing pending and missing-user tests**

```tsx
it('disables submission while adding the editor', async () => {
  let finish!: (value: unknown) => void;
  apiMocks.addMember.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  renderDetail();

  fireEvent.change(screen.getByLabelText('Collaborator email'), {
    target: { value: 'bob@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add editor' }));

  expect(screen.getByRole('button', { name: 'Adding…' }).hasAttribute('disabled')).toBe(true);
  finish({ id: 'm1', listId: 'l1', userId: 'u2', role: 'EDITOR' });
  await screen.findByRole('status');
});

it('explains that a missing collaborator must register first', async () => {
  apiMocks.addMember.mockRejectedValue(
    Object.assign(new Error('User not found'), { status: 404 }),
  );
  renderDetail();

  fireEvent.change(screen.getByLabelText('Collaborator email'), {
    target: { value: 'missing@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add editor' }));

  expect((await screen.findByRole('alert')).textContent).toContain(
    'That email must register before you can add them',
  );
});
```

- [ ] **Step 5: Run the focused test and verify RED**

Run:

```bash
pnpm --filter web test -- ListDetail.test.tsx
```

Expected: failures because `Collaborator email` and `Add editor` do not exist.

### Task 2: Implement the typed add-editor flow

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/api.ts`
- Modify: `web/src/ListDetail.tsx`
- Modify: `web/src/styles.css`
- Test: `web/src/ListDetail.test.tsx`

- [ ] **Step 1: Add the membership types**

Append to `web/src/types.ts`:

```ts
export type MemberRole = 'OWNER' | 'EDITOR' | 'VIEWER';

export interface ListMembership {
  id: string;
  listId: string;
  userId: string;
  role: MemberRole;
}
```

- [ ] **Step 2: Add the typed API helper**

Add `ListMembership` and `MemberRole` to the import from `./types`, then add this method beside `createList`:

```ts
addMember: (
  token: string,
  listId: string,
  email: string,
  role: MemberRole,
) =>
  req<ListMembership>(
    `/lists/${listId}/members`,
    { method: 'POST', body: JSON.stringify({ email, role }) },
    token,
  ),
```

- [ ] **Step 3: Add form state and submission behavior to `ListDetail`**

Change the React import to:

```ts
import { FormEvent, useEffect, useRef, useState } from 'react';
```

Add state beside the existing composer state:

```ts
const [collaboratorEmail, setCollaboratorEmail] = useState('');
const [shareBusy, setShareBusy] = useState(false);
const [shareError, setShareError] = useState<string | null>(null);
const [shareSuccess, setShareSuccess] = useState<string | null>(null);
```

Add the submit handler before `createTodo`:

```ts
async function addEditor(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const email = collaboratorEmail.trim();
  if (!email) return;

  setShareBusy(true);
  setShareError(null);
  setShareSuccess(null);
  try {
    await api.addMember(token, list.id, email, 'EDITOR');
    setCollaboratorEmail('');
    setShareSuccess(`${email} can now edit this list.`);
  } catch (error) {
    const requestError = error as Error & { status?: number };
    if (requestError.status === 404) {
      setShareError('That email must register before you can add them.');
    } else if (requestError.status === 403) {
      setShareError('Only the list owner can add collaborators.');
    } else {
      setShareError(requestError.message);
    }
  } finally {
    setShareBusy(false);
  }
}
```

Before `return`, derive validity without adding a validation dependency:

```ts
const trimmedCollaboratorEmail = collaboratorEmail.trim();
const canShare = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedCollaboratorEmail);
```

- [ ] **Step 4: Render the owner-only form after the detail header**

Insert immediately after `.detail-head`:

```tsx
{me.id === list.ownerId && (
  <form className="share-form card" onSubmit={addEditor} data-testid="share-form">
    <div className="share-field">
      <label className="label" htmlFor="collaborator-email">
        Collaborator email
      </label>
      <input
        id="collaborator-email"
        className="input"
        type="email"
        autoComplete="email"
        placeholder="teammate@example.com"
        value={collaboratorEmail}
        disabled={shareBusy}
        onChange={(event) => {
          setCollaboratorEmail(event.target.value);
          setShareError(null);
          setShareSuccess(null);
        }}
      />
    </div>
    <button type="submit" className="btn btn-primary" disabled={!canShare || shareBusy}>
      {shareBusy ? 'Adding…' : 'Add editor'}
    </button>
    {shareError && (
      <p className="share-feedback error-text" role="alert">
        {shareError}
      </p>
    )}
    {shareSuccess && (
      <p className="share-feedback success-text" role="status">
        {shareSuccess}
      </p>
    )}
  </form>
)}
```

- [ ] **Step 5: Add focused responsive styles**

Add `--color-success: #047857;` with the other semantic root colors, then add after the list-detail header styles:

```css
.share-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 8px;
  margin: 12px 0 16px;
  padding: 12px;
}

.share-field {
  display: grid;
  gap: 6px;
}

.share-form .btn {
  min-height: 44px;
}

.share-feedback {
  grid-column: 1 / -1;
  margin: 0;
}

.success-text {
  color: var(--color-success);
  font-size: 13px;
}

@media (max-width: 560px) {
  .share-form {
    grid-template-columns: 1fr;
  }

  .share-form .btn {
    width: 100%;
  }
}
```

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter web test -- ListDetail.test.tsx
```

Expected: all `ListDetail` tests pass.

- [ ] **Step 7: Run type-check/build**

Run:

```bash
pnpm --filter web build
```

Expected: TypeScript and Vite build exit 0.

- [ ] **Step 8: Commit the component slice**

```bash
git add web/src/types.ts web/src/api.ts web/src/ListDetail.tsx web/src/ListDetail.test.tsx web/src/styles.css
git commit -m "feat(web): add collaborators from list detail"
```

### Task 3: Exercise sharing through the browser e2e

**Files:**
- Modify: `web/e2e/collab.e2e.spec.ts`

- [ ] **Step 1: Remove the direct membership API call**

Delete:

```ts
await rq.post(`${API}/lists/${list.id}/members`, {
  headers: { Authorization: `Bearer ${alice.accessToken}` },
  data: { email: bob.user.email, role: 'EDITOR' },
});
```

- [ ] **Step 2: Add Bob through Alice's UI before opening Bob's page**

Create Alice's context and open the list immediately after the todo is seeded:

```ts
const aliceCtx = await openAs(browser, alice);
const aPage = await aliceCtx.newPage();
await aPage.goto('/');
await aPage.getByTestId(`list-item-${list.id}`).click();
await aPage.getByLabel('Collaborator email').fill(bob.user.email);
await aPage.getByRole('button', { name: 'Add editor' }).click();
await expect(aPage.getByRole('status')).toContainText('can now edit this list');

const bobCtx = await openAs(browser, bob);
const bPage = await bobCtx.newPage();
await bPage.goto('/');
await expect(bPage.getByTestId(`list-item-${list.id}`)).toBeVisible();
await bPage.getByTestId(`list-item-${list.id}`).click();
```

Remove the old duplicate context/page creation and Alice list click. Keep all existing presence, lock, live-update, blur, and delete assertions unchanged.

- [ ] **Step 3: Run the collaboration e2e**

Run:

```bash
pnpm --filter web e2e -- collab.e2e.spec.ts
```

Expected: the test passes and Bob reaches the list through UI-created membership.

- [ ] **Step 4: Commit the e2e slice**

```bash
git add web/e2e/collab.e2e.spec.ts
git commit -m "test(e2e): share list through collaborator UI"
```

### Task 4: Final verification

**Files:**
- Verify only; no planned modifications.

- [ ] **Step 1: Run web unit tests**

```bash
pnpm --filter web test
```

Expected: all Vitest suites pass.

- [ ] **Step 2: Run the web production build**

```bash
pnpm --filter web build
```

Expected: TypeScript and Vite build exit 0.

- [ ] **Step 3: Run repository lint**

```bash
pnpm lint
```

Expected: exit 0; existing warnings may remain, but no new errors or warnings are introduced.

- [ ] **Step 4: Run the full API unit suite as a regression check**

```bash
pnpm --filter api exec jest --config jest.config.ts --runInBand
```

Expected: all API unit suites pass.

- [ ] **Step 5: Confirm the worktree contains only intended changes**

```bash
git status --short
git diff --check
```

Expected: clean worktree after the two feature commits and no whitespace errors.
