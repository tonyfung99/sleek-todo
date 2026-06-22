import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { api } from './api';
import { createSocket } from './socket';
import { AuthUser, LockGranted, Todo, TodoList, TodoStatus, Viewer } from './types';
import { BackIcon, LockIcon, PlusIcon, TrashIcon } from './icons';

const STATUSES: TodoStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'];
const STATUS_LABEL: Record<TodoStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + second).toUpperCase() || '?';
}

export function ListDetail({
  token,
  me,
  list,
  onBack,
}: {
  token: string;
  me: AuthUser;
  list: TodoList;
  onBack: () => void;
}) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [locks, setLocks] = useState<Record<string, LockGranted>>({});
  const [newName, setNewName] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    api.todos(token, list.id).then(setTodos);
    const socket = createSocket(token);
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('list:join', { listId: list.id }));
    socket.on('presence:update', (p: { viewers: Viewer[] }) => setViewers(p.viewers));
    socket.on('todo:created', (p: { todo: Todo }) =>
      setTodos((prev) => (prev.some((t) => t.id === p.todo.id) ? prev : [...prev, p.todo])),
    );
    socket.on('todo:updated', (p: { todo: Todo }) =>
      setTodos((prev) => prev.map((t) => (t.id === p.todo.id ? p.todo : t))),
    );
    socket.on('todo:deleted', (p: { todoId: string }) =>
      setTodos((prev) => prev.filter((t) => t.id !== p.todoId)),
    );
    socket.on('lock:granted', (p: LockGranted) =>
      setLocks((prev) => ({ ...prev, [p.todoId]: p })),
    );
    socket.on('lock:released', (p: { todoId: string }) =>
      setLocks((prev) => {
        const next = { ...prev };
        delete next[p.todoId];
        return next;
      }),
    );
    return () => {
      socket.emit('list:leave', { listId: list.id });
      socket.disconnect();
    };
  }, [token, list.id]);

  function lockedByOther(todoId: string): LockGranted | undefined {
    const lock = locks[todoId];
    return lock && lock.userId !== me.id ? lock : undefined;
  }

  async function createTodo() {
    if (!newName.trim()) return;
    const todo = await api.createTodo(token, list.id, newName.trim());
    setTodos((prev) => (prev.some((t) => t.id === todo.id) ? prev : [...prev, todo]));
    setNewName('');
  }

  function startEditing(todoId: string) {
    socketRef.current?.emit('editing:start', { listId: list.id, todoId });
  }

  function stopEditing(todoId: string) {
    socketRef.current?.emit('editing:stop', { listId: list.id, todoId });
  }

  function onNameChange(todo: Todo, name: string) {
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, name } : t)));
    clearTimeout(saveTimers.current[todo.id]);
    saveTimers.current[todo.id] = setTimeout(async () => {
      try {
        const saved = await api.updateTodo(token, todo.id, todo.version, { name });
        setTodos((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
      } catch {
        // 409 / conflict: refetch authoritative state.
        api.todos(token, list.id).then(setTodos);
      }
    }, 400);
  }

  async function changeStatus(todo: Todo, status: TodoStatus) {
    startEditing(todo.id);
    try {
      const saved = await api.updateTodo(token, todo.id, todo.version, { status });
      setTodos((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
    } catch {
      api.todos(token, list.id).then(setTodos);
    } finally {
      stopEditing(todo.id);
    }
  }

  async function remove(todo: Todo) {
    await api.deleteTodo(token, todo.id);
    setTodos((prev) => prev.filter((t) => t.id !== todo.id));
  }

  return (
    <main className="page">
      <div className="container">
        <button className="btn btn-ghost" onClick={onBack}>
          <BackIcon size={16} />
          Lists
        </button>

        <div className="detail-head">
          <div>
            <h1 className="title">{list.name}</h1>
            <p className="subtitle">Changes sync live to everyone viewing.</p>
          </div>
          <div className="presence-bar" data-testid="presence-bar" aria-label="People viewing">
            <span className="presence-count">{viewers.length} viewing</span>
            {viewers.map((v) => (
              <span
                key={v.userId}
                data-testid="presence-avatar"
                className="avatar"
                title={v.displayName}
                style={{ background: v.color }}
              >
                {initials(v.displayName)}
              </span>
            ))}
          </div>
        </div>

        <div className="composer">
          <input
            className="input"
            placeholder="Add a todo…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createTodo();
            }}
            aria-label="New todo name"
          />
          <button className="btn btn-primary" onClick={createTodo} disabled={!newName.trim()}>
            <PlusIcon size={16} />
            Add
          </button>
        </div>

        {todos.length === 0 ? (
          <p className="empty">Nothing here yet — add your first todo above.</p>
        ) : (
          <ul className="todo-list">
            {todos.map((todo) => {
              const lock = lockedByOther(todo.id);
              const disabled = Boolean(lock);
              return (
                <li key={todo.id} data-testid={`todo-row-${todo.id}`} className="todo-row">
                  <input
                    data-testid={`todo-name-${todo.id}`}
                    className="todo-name"
                    value={todo.name}
                    disabled={disabled}
                    onFocus={() => startEditing(todo.id)}
                    onBlur={() => stopEditing(todo.id)}
                    onChange={(e) => onNameChange(todo, e.target.value)}
                    aria-label="Todo name"
                  />
                  <div className="todo-meta">
                    <select
                      className={`select status-${todo.status}`}
                      value={todo.status}
                      disabled={disabled}
                      onChange={(e) => changeStatus(todo, e.target.value as TodoStatus)}
                      aria-label="Status"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>

                    {lock && (
                      <span className="lock-badge" data-testid={`lock-badge-${todo.id}`}>
                        <LockIcon size={12} />
                        {lock.displayName} is editing
                      </span>
                    )}

                    <span className="spacer" />

                    <button
                      data-testid={`todo-delete-${todo.id}`}
                      className="btn-icon-danger"
                      disabled={disabled}
                      onClick={() => remove(todo)}
                      aria-label="Delete todo"
                      title="Delete"
                    >
                      <TrashIcon size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
