export type TodoStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthResult {
  accessToken: string;
  user: AuthUser;
}

export interface TodoList {
  id: string;
  name: string;
  ownerId: string;
}

export interface Todo {
  id: string;
  listId: string;
  name: string;
  description: string | null;
  status: TodoStatus;
  version: number;
}

export interface Viewer {
  userId: string;
  displayName: string;
  color: string;
}

export interface LockGranted {
  todoId: string;
  userId: string;
  displayName: string;
}
