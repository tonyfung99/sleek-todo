import { Todo } from '../todos/todo.entity';

export const REALTIME_EMITTER = 'REALTIME_EMITTER';

export interface RealtimeEmitter {
  emitTodoCreated(listId: string, todo: Todo): void;
  emitTodoUpdated(listId: string, todo: Todo): void;
  emitTodoDeleted(listId: string, todoId: string): void;
}

export interface PresenceViewer {
  userId: string;
  displayName: string;
  color: string;
}

export interface LockHolder {
  userId: string;
  displayName: string;
  socketId: string;
}
