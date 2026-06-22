import { test, expect, request, Browser, BrowserContext } from '@playwright/test';

const API = 'http://localhost:3000';

async function registerUser(rq: Awaited<ReturnType<typeof request.newContext>>, name: string) {
  const email = `${name.toLowerCase()}-${Date.now()}@e2e.test`;
  const res = await rq.post(`${API}/auth/register`, {
    data: { email, password: 'password123', displayName: name },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { accessToken: string; user: { id: string; email: string; displayName: string } };
}

async function openAs(
  browser: Browser,
  session: { accessToken: string; user: unknown },
): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(
    ([token, user]) => {
      localStorage.setItem('token', token as string);
      localStorage.setItem('user', JSON.stringify(user));
    },
    [session.accessToken, session.user],
  );
  return ctx;
}

test('two users collaborate live on a shared list', async ({ browser }) => {
  const rq = await request.newContext();
  const alice = await registerUser(rq, 'Alice');
  const bob = await registerUser(rq, 'Bob');

  // Alice creates a list, adds Bob as EDITOR, adds a todo.
  const listRes = await rq.post(`${API}/lists`, {
    headers: { Authorization: `Bearer ${alice.accessToken}` },
    data: { name: 'Demo' },
  });
  const list = (await listRes.json()) as { id: string };
  await rq.post(`${API}/lists/${list.id}/members`, {
    headers: { Authorization: `Bearer ${alice.accessToken}` },
    data: { email: bob.user.email, role: 'EDITOR' },
  });
  const todoRes = await rq.post(`${API}/lists/${list.id}/todos`, {
    headers: { Authorization: `Bearer ${alice.accessToken}` },
    data: { name: 'Buy milk' },
  });
  const todo = (await todoRes.json()) as { id: string };

  // Both open the list in separate browser contexts.
  const aliceCtx = await openAs(browser, alice);
  const bobCtx = await openAs(browser, bob);
  const aPage = await aliceCtx.newPage();
  const bPage = await bobCtx.newPage();
  await aPage.goto('/');
  await bPage.goto('/');
  await aPage.getByTestId(`list-item-${list.id}`).click();
  await bPage.getByTestId(`list-item-${list.id}`).click();

  // Presence: each sees 2 viewers.
  await expect(aPage.getByTestId('presence-avatar')).toHaveCount(2);
  await expect(bPage.getByTestId('presence-avatar')).toHaveCount(2);

  // Alice focuses the todo name → Bob sees the lock + read-only.
  await aPage.getByTestId(`todo-name-${todo.id}`).click();
  await expect(bPage.getByTestId(`lock-badge-${todo.id}`)).toContainText('Alice');
  await expect(bPage.getByTestId(`todo-name-${todo.id}`)).toBeDisabled();

  // Alice edits → Bob sees the new text live (debounced autosave → todo:updated).
  await aPage.getByTestId(`todo-name-${todo.id}`).fill('Buy oat milk');
  await expect(bPage.getByTestId(`todo-name-${todo.id}`)).toHaveValue('Buy oat milk');

  // Alice blurs → Bob's row re-enables.
  await aPage.getByTestId(`todo-name-${todo.id}`).blur();
  await expect(bPage.getByTestId(`lock-badge-${todo.id}`)).toHaveCount(0);
  await expect(bPage.getByTestId(`todo-name-${todo.id}`)).toBeEnabled();

  // Alice deletes → Bob's row disappears.
  await aPage.getByTestId(`todo-delete-${todo.id}`).click();
  await expect(bPage.getByTestId(`todo-row-${todo.id}`)).toHaveCount(0);

  await aliceCtx.close();
  await bobCtx.close();
  await rq.dispose();
});
