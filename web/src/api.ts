import { AuthResult, Todo, TodoList } from './types';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function req<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
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
  lists: (token: string) => req<TodoList[]>('/lists', { method: 'GET' }, token),
  createList: (token: string, name: string) =>
    req<TodoList>('/lists', { method: 'POST', body: JSON.stringify({ name }) }, token),
  todos: (token: string, listId: string) =>
    req<Todo[]>(`/lists/${listId}/todos`, { method: 'GET' }, token),
  createTodo: (token: string, listId: string, name: string) =>
    req<Todo>(
      `/lists/${listId}/todos`,
      { method: 'POST', body: JSON.stringify({ name, description: null }) },
      token,
    ),
  updateTodo: (
    token: string,
    todoId: string,
    version: number,
    patch: Partial<Pick<Todo, 'name' | 'description' | 'status'>>,
  ) =>
    req<Todo>(
      `/todos/${todoId}`,
      { method: 'PATCH', headers: { 'If-Match': String(version) }, body: JSON.stringify(patch) },
      token,
    ),
  deleteTodo: (token: string, todoId: string) =>
    req<void>(`/todos/${todoId}`, { method: 'DELETE' }, token),
};
