export type TodoStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'ARCHIVED';

export type TodoPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export type RecurrenceUnit = 'DAY' | 'WEEK' | 'MONTH';

export type MemberRole = 'OWNER' | 'EDITOR' | 'VIEWER';

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

export interface ListMembership {
  id: string;
  listId: string;
  userId: string;
  role: MemberRole;
}

export interface Todo {
  id: string;
  listId: string;
  name: string;
  description: string | null;
  dueDate: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  recurrenceUnit: RecurrenceUnit | null;
  recurrenceInterval: number | null;
  version: number;
  blocked?: boolean;
}

export interface TodoPage {
  items: Todo[];
  nextCursor: string | null;
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
