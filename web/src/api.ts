import { AuthResult, Todo, TodoList, TodoPage, TodoPriority } from './types';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function req<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  // credentials:'include' so the httpOnly refresh cookie round-trips.
  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error((body as { message?: string }).message ?? res.statusText), {
      status: res.status,
    });
  }
  return body as T;
}

export const api = {
  register: (email: string, password: string, displayName: string) =>
    req<AuthResult>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    }),
  login: (email: string, password: string) =>
    req<AuthResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  refresh: () => req<AuthResult>('/auth/refresh', { method: 'POST' }),
  logout: () => req<void>('/auth/logout', { method: 'POST' }),
  lists: (token: string) => req<TodoList[]>('/lists', { method: 'GET' }, token),
  createList: (token: string, name: string) =>
    req<TodoList>('/lists', { method: 'POST', body: JSON.stringify({ name }) }, token),
  todos: (token: string, listId: string, queryString = '') =>
    req<TodoPage>(`/lists/${listId}/todos${queryString}`, { method: 'GET' }, token).then(
      (page) => page.items,
    ),
  createTodo: (
    token: string,
    listId: string,
    name: string,
    extra: { priority?: TodoPriority; dueDate?: string | null } = {},
  ) =>
    req<Todo>(
      `/lists/${listId}/todos`,
      { method: 'POST', body: JSON.stringify({ name, description: null, ...extra }) },
      token,
    ),
  updateTodo: (
    token: string,
    todoId: string,
    version: number,
    patch: Partial<
      Pick<
        Todo,
        | 'name'
        | 'description'
        | 'status'
        | 'priority'
        | 'dueDate'
        | 'recurrenceUnit'
        | 'recurrenceInterval'
      >
    >,
  ) =>
    req<Todo>(
      `/todos/${todoId}`,
      { method: 'PATCH', headers: { 'If-Match': String(version) }, body: JSON.stringify(patch) },
      token,
    ),
  deleteTodo: (token: string, todoId: string) =>
    req<void>(`/todos/${todoId}`, { method: 'DELETE' }, token),
  dependencies: (token: string, todoId: string) =>
    req<Todo[]>(`/todos/${todoId}/dependencies`, { method: 'GET' }, token),
  addDependency: (token: string, todoId: string, dependencyId: string) =>
    req<unknown>(
      `/todos/${todoId}/dependencies`,
      { method: 'POST', body: JSON.stringify({ dependencyId }) },
      token,
    ),
  removeDependency: (token: string, todoId: string, depId: string) =>
    req<void>(`/todos/${todoId}/dependencies/${depId}`, { method: 'DELETE' }, token),
};
