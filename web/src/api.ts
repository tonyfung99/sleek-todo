import {
  AuthResult,
  ListMembership,
  MemberRole,
  Todo,
  TodoList,
  TodoPage,
  TodoPriority,
} from './types';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export type ApiErrorKind =
  | 'auth'
  | 'validation'
  | 'permission'
  | 'not-found'
  | 'conflict'
  | 'network'
  | 'unexpected';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;

  constructor(message: string, kind: ApiErrorKind, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

type UnauthorizedHandler = (failedToken: string) => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler): () => void;
export function setUnauthorizedHandler(handler: null): void;
export function setUnauthorizedHandler(
  handler: UnauthorizedHandler | null,
): (() => void) | void {
  unauthorizedHandler = handler;
  if (!handler) return;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

function classifyStatus(status: number): ApiErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'permission';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'validation';
  return 'unexpected';
}

function fallbackMessage(kind: ApiErrorKind): string {
  if (kind === 'permission') return "You don't have permission to do that.";
  if (kind === 'not-found') return 'That item is no longer available.';
  return 'Something went wrong. Please try again.';
}

function responseMessage(body: unknown, kind: ApiErrorKind): string {
  if (kind !== 'unexpected' && typeof body === 'object' && body !== null) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return fallbackMessage(kind);
}

async function req<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  // credentials:'include' so the httpOnly refresh cookie round-trips.
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ApiError(
        "Couldn't connect. Check your connection and try again.",
        'network',
      );
    }
    throw new ApiError('Something went wrong. Please try again.', 'unexpected');
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const kind = classifyStatus(res.status);
    const error = new ApiError(responseMessage(body, kind), kind, res.status);
    if (token && res.status === 401) {
      try {
        unauthorizedHandler?.(token);
      } finally {
        throw error;
      }
    }
    throw error;
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
  addMember: (token: string, listId: string, email: string, role: MemberRole) =>
    req<ListMembership>(
      `/lists/${listId}/members`,
      { method: 'POST', body: JSON.stringify({ email, role }) },
      token,
    ),
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
