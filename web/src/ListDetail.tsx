import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { api } from './api';
import { createSocket } from './socket';
import {
  AuthUser,
  LockGranted,
  RecurrenceUnit,
  Todo,
  TodoList,
  TodoPriority,
  TodoStatus,
  Viewer,
} from './types';
import { BackIcon, LockIcon, PlusIcon, TrashIcon } from './icons';

const STATUSES: TodoStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED'];
const STATUS_LABEL: Record<TodoStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};
const PRIORITIES: TodoPriority[] = ['LOW', 'MEDIUM', 'HIGH'];
const PRIORITY_LABEL: Record<TodoPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
};

function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

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
  const [newPriority, setNewPriority] = useState<TodoPriority>('MEDIUM');
  const [openDeps, setOpenDeps] = useState<string | null>(null);
  const [depsByTodo, setDepsByTodo] = useState<Record<string, Todo[]>>({});
  const [depError, setDepError] = useState<string | null>(null);
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
    const todo = await api.createTodo(token, list.id, newName.trim(), { priority: newPriority });
    setTodos((prev) => (prev.some((t) => t.id === todo.id) ? prev : [...prev, todo]));
    setNewName('');
    setNewPriority('MEDIUM');
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

  async function patchField(
    todo: Todo,
    patch: Partial<
      Pick<Todo, 'status' | 'priority' | 'dueDate' | 'recurrenceUnit' | 'recurrenceInterval'>
    >,
  ) {
    startEditing(todo.id);
    try {
      const saved = await api.updateTodo(token, todo.id, todo.version, patch);
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

  function refresh() {
    api.todos(token, list.id).then(setTodos);
  }

  async function toggleDeps(todoId: string) {
    setDepError(null);
    if (openDeps === todoId) {
      setOpenDeps(null);
      return;
    }
    setOpenDeps(todoId);
    const deps = await api.dependencies(token, todoId);
    setDepsByTodo((prev) => ({ ...prev, [todoId]: deps }));
  }

  async function addDep(todoId: string, dependencyId: string) {
    if (!dependencyId) return;
    setDepError(null);
    try {
      await api.addDependency(token, todoId, dependencyId);
      const deps = await api.dependencies(token, todoId);
      setDepsByTodo((prev) => ({ ...prev, [todoId]: deps }));
      refresh();
    } catch (err) {
      setDepError((err as Error).message);
    }
  }

  async function removeDep(todoId: string, depId: string) {
    await api.removeDependency(token, todoId, depId);
    const deps = await api.dependencies(token, todoId);
    setDepsByTodo((prev) => ({ ...prev, [todoId]: deps }));
    refresh();
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
          <select
            className={`select priority-${newPriority}`}
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value as TodoPriority)}
            aria-label="New todo priority"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
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
                      onChange={(e) => patchField(todo, { status: e.target.value as TodoStatus })}
                      aria-label="Status"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>

                    <select
                      className={`select priority-${todo.priority}`}
                      value={todo.priority}
                      disabled={disabled}
                      onChange={(e) =>
                        patchField(todo, { priority: e.target.value as TodoPriority })
                      }
                      aria-label="Priority"
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {PRIORITY_LABEL[p]}
                        </option>
                      ))}
                    </select>

                    <input
                      type="date"
                      className="input date-input"
                      value={toDateInput(todo.dueDate)}
                      disabled={disabled}
                      onChange={(e) =>
                        patchField(todo, {
                          dueDate: e.target.value
                            ? new Date(e.target.value).toISOString()
                            : null,
                        })
                      }
                      aria-label="Due date"
                    />

                    <select
                      className="select"
                      value={todo.recurrenceUnit ?? 'NONE'}
                      disabled={disabled || !todo.dueDate}
                      title={!todo.dueDate ? 'Set a due date to enable repeat' : 'Repeat'}
                      onChange={(e) =>
                        patchField(
                          todo,
                          e.target.value === 'NONE'
                            ? { recurrenceUnit: null, recurrenceInterval: null }
                            : {
                                recurrenceUnit: e.target.value as RecurrenceUnit,
                                recurrenceInterval: 1,
                              },
                        )
                      }
                      aria-label="Repeat"
                    >
                      <option value="NONE">No repeat</option>
                      <option value="DAY">Daily</option>
                      <option value="WEEK">Weekly</option>
                      <option value="MONTH">Monthly</option>
                    </select>

                    {todo.blocked && (
                      <span className="blocked-badge" data-testid={`blocked-${todo.id}`}>
                        Blocked
                      </span>
                    )}

                    {lock && (
                      <span className="lock-badge" data-testid={`lock-badge-${todo.id}`}>
                        <LockIcon size={12} />
                        {lock.displayName} is editing
                      </span>
                    )}

                    <span className="spacer" />

                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => toggleDeps(todo.id)}
                      aria-expanded={openDeps === todo.id}
                    >
                      Deps
                    </button>

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

                  {openDeps === todo.id && (
                    <div className="deps-panel">
                      <div className="deps-chips">
                        {(depsByTodo[todo.id] ?? []).length === 0 ? (
                          <span className="deps-empty">No dependencies</span>
                        ) : (
                          (depsByTodo[todo.id] ?? []).map((d) => (
                            <span key={d.id} className="dep-chip">
                              {d.name}
                              <span className={`dep-dot status-${d.status}`} title={d.status} />
                              <button
                                className="dep-remove"
                                onClick={() => removeDep(todo.id, d.id)}
                                aria-label={`Remove dependency ${d.name}`}
                              >
                                ×
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                      <select
                        className="select"
                        value=""
                        onChange={(e) => addDep(todo.id, e.target.value)}
                        aria-label="Add dependency"
                      >
                        <option value="">Add dependency…</option>
                        {todos
                          .filter(
                            (t) =>
                              t.id !== todo.id &&
                              !(depsByTodo[todo.id] ?? []).some((d) => d.id === t.id),
                          )
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                      </select>
                      {depError && <span className="error-text">{depError}</span>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
