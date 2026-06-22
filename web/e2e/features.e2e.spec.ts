import { test, expect, request, Browser } from '@playwright/test';

const API = 'http://localhost:3000';

async function registerUser(rq: Awaited<ReturnType<typeof request.newContext>>, name: string) {
  const email = `${name.toLowerCase()}-feat-${Date.now()}@e2e.test`;
  const res = await rq.post(`${API}/auth/register`, {
    data: { email, password: 'password123', displayName: name },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { accessToken: string; user: { id: string } };
}

async function openAs(browser: Browser, session: { accessToken: string; user: unknown }) {
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

test('dependencies block, recurrence spawns next occurrence, logout works', async ({ browser }) => {
  const rq = await request.newContext();
  const user = await registerUser(rq, 'Casey');
  const headers = { Authorization: `Bearer ${user.accessToken}` };

  const post = async (path: string, data: object): Promise<{ id: string }> =>
    (await rq.post(`${API}${path}`, { headers, data })).json();

  const listId = (await post('/lists', { name: 'Feature list' })).id;
  const taskId = (await post(`/lists/${listId}/todos`, { name: 'Deploy release' })).id;
  // QA is seeded as a daily-recurring todo with a due date so a single UI
  // "Complete" action spawns the next occurrence.
  const prereqId = (
    await post(`/lists/${listId}/todos`, {
      name: 'Run QA',
      dueDate: '2026-09-01T00:00:00.000Z',
      recurrenceUnit: 'DAY',
      recurrenceInterval: 1,
    })
  ).id;

  const ctx = await openAs(browser, user);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByTestId(`list-item-${listId}`).click();

  // Both todos render.
  await expect(page.getByTestId(`todo-name-${taskId}`)).toHaveValue('Deploy release');
  await expect(page.getByTestId(`todo-name-${prereqId}`)).toHaveValue('Run QA');

  // --- Dependencies: make Deploy depend on QA → Deploy shows Blocked ---
  const taskRow = page.getByTestId(`todo-row-${taskId}`);
  await taskRow.getByRole('button', { name: 'Deps' }).click();
  await taskRow.getByLabel('Add dependency').selectOption({ label: 'Run QA' });
  await expect(page.getByTestId(`blocked-${taskId}`)).toBeVisible();

  // Two rows so far (Deploy, QA). QA already shows its Daily repeat.
  await expect(page.locator('[data-testid^="todo-row-"]')).toHaveCount(2);
  await expect(page.getByTestId(`todo-row-${prereqId}`).getByLabel('Repeat')).toHaveValue('DAY');

  // --- Recurrence: complete the recurring QA → a fresh NOT_STARTED occurrence is spawned ---
  await page.getByTestId(`todo-row-${prereqId}`).getByLabel('Status').selectOption('COMPLETED');

  // Original QA is COMPLETED and the next occurrence appears → 3 rows.
  await expect(page.locator('[data-testid^="todo-row-"]')).toHaveCount(3);

  // --- Logout (from the Lists screen) returns to the auth screen ---
  await page.getByRole('button', { name: 'Lists' }).click();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();

  await ctx.close();
  await rq.dispose();
});
