import { type FormEvent, useEffect, useRef, useState } from 'react';
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
import { BackIcon, CheckIcon, LockIcon, PlusIcon, TrashIcon } from './icons';
import { ErrorAlert } from './ErrorAlert';

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

function formatDue(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
  onUnauthorized,
}: {
  token: string;
  me: AuthUser;
  list: TodoList;
  onBack: () => void;
  onUnauthorized?: () => void;
}) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [todoErrors, setTodoErrors] = useState<Record<string, string>>({});
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [locks, setLocks] = useState<Record<string, LockGranted>>({});
  const [newName, setNewName] = useState('');
  const [newPriority, setNewPriority] = useState<TodoPriority>('MEDIUM');
  const [collaboratorEmail, setCollaboratorEmail] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareSuccess, setShareSuccess] = useState<string | null>(null);
  const [openDeps, setOpenDeps] = useState<string | null>(null);
  const [depsByTodo, setDepsByTodo] = useState<Record<string, Todo[]>>({});
  const [depErrors, setDepErrors] = useState<Record<string, string>>({});
  const [connectionLost, setConnectionLost] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const saveGenerations = useRef<Record<string, number>>({});
  const patchGenerations = useRef<Record<string, number>>({});
  const loadGeneration = useRef(0);
  const mounted = useRef(true);
  const createGeneration = useRef(0);
  const createBusyRef = useRef(false);
  const pendingDeleteIds = useRef(new Set<string>());
  const activeContext = useRef({ token, listId: list.id });
  activeContext.current = { token, listId: list.id };

  function currentContext(expectedToken: string, expectedListId: string) {
    return (
      mounted.current &&
      activeContext.current.token === expectedToken &&
      activeContext.current.listId === expectedListId
    );
  }

  function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  async function loadTodos(showLoading = true) {
    const expectedToken = token;
    const expectedListId = list.id;
    const generation = ++loadGeneration.current;
    if (showLoading) setLoadState('loading');
    setLoadError(null);
    try {
      const loaded = await api.todos(expectedToken, expectedListId);
      if (generation !== loadGeneration.current || !currentContext(expectedToken, expectedListId)) {
        return false;
      }
      setTodos(loaded);
      setLoadState('ready');
      return true;
    } catch (error) {
      if (generation !== loadGeneration.current || !currentContext(expectedToken, expectedListId)) {
        return false;
      }
      setLoadError(errorMessage(error, 'Could not load todos'));
      setLoadState('error');
      return false;
    }
  }

  async function reloadConfirmedTodos(
    expectedToken: string,
    expectedListId: string,
    operationIsCurrent: () => boolean,
  ) {
    try {
      const loaded = await api.todos(expectedToken, expectedListId);
      if (!currentContext(expectedToken, expectedListId) || !operationIsCurrent()) return false;
      setTodos(loaded);
      setLoadError(null);
      setLoadState('ready');
      return true;
    } catch (error) {
      if (!currentContext(expectedToken, expectedListId) || !operationIsCurrent()) return false;
      setLoadError(errorMessage(error, 'Could not reload todos'));
      setLoadState('error');
      return false;
    }
  }

  useEffect(() => {
    mounted.current = true;
    setTodos([]);
    setTodoErrors({});
    setCreateError(null);
    setCreateBusy(false);
    createBusyRef.current = false;
    createGeneration.current += 1;
    pendingDeleteIds.current.clear();
    setPendingDeletes(new Set());
    setLoadState('loading');
    setLoadError(null);
    void loadTodos();
    const socket = createSocket(token);
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnectionLost(false);
      socket.emit('list:join', { listId: list.id });
    });
    socket.on('disconnect', () => setConnectionLost(true));
    socket.on('connect_error', (err: Error & { data?: { status?: number } }) => {
      if (err.data?.status === 401) {
        onUnauthorized?.();
      } else {
        setConnectionLost(true);
      }
    });
    socket.on('presence:update', (p: { viewers: Viewer[] }) => setViewers(p.viewers));
    socket.on('todo:created', (p: { todo: Todo }) =>
      setTodos((prev) => (prev.some((t) => t.id === p.todo.id) ? prev : [...prev, p.todo])),
    );
    socket.on('todo:updated', (p: { todo: Todo }) => {
      setTodos((prev) => prev.map((t) => (t.id === p.todo.id ? p.todo : t)));
      // A dependency's status may have changed — invalidate cached dep rows.
      setDepsByTodo((prev) => {
        const next = { ...prev };
        delete next[p.todo.id];
        return next;
      });
    });
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
      mounted.current = false;
      loadGeneration.current += 1;
      Object.values(saveTimers.current).forEach(clearTimeout);
      saveTimers.current = {};
      socket.emit('list:leave', { listId: list.id });
      socket.disconnect();
    };
  }, [token, list.id]);

  // Eagerly load dependencies for blocked todos so we can show "Blocked by …".
  useEffect(() => {
    todos.forEach((t) => {
      if (t.blocked && depsByTodo[t.id] === undefined) {
        api
          .dependencies(token, t.id)
          .then((deps) => setDepsByTodo((prev) => ({ ...prev, [t.id]: deps })))
          .catch(() => undefined);
      }
    });
  }, [todos, token, depsByTodo]);

  function lockedByOther(todoId: string): LockGranted | undefined {
    const lock = locks[todoId];
    return lock && lock.userId !== me.id ? lock : undefined;
  }

  async function createTodo() {
    if (!newName.trim() || createBusyRef.current) return;
    const expectedToken = token;
    const expectedListId = list.id;
    const generation = ++createGeneration.current;
    createBusyRef.current = true;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const todo = await api.createTodo(expectedToken, expectedListId, newName.trim(), {
        priority: newPriority,
      });
      if (!currentContext(expectedToken, expectedListId)) return;
      setTodos((prev) => (prev.some((t) => t.id === todo.id) ? prev : [...prev, todo]));
      setNewName('');
      setNewPriority('MEDIUM');
    } catch (error) {
      if (currentContext(expectedToken, expectedListId)) {
        setCreateError(errorMessage(error, 'Could not add todo'));
      }
    } finally {
      if (generation === createGeneration.current) {
        createBusyRef.current = false;
        if (currentContext(expectedToken, expectedListId)) setCreateBusy(false);
      }
    }
  }

  async function addEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = collaboratorEmail.trim();
    if (!email) return;

    setShareBusy(true);
    setShareError(null);
    setShareSuccess(null);
    try {
      const membership = await api.addMember(token, list.id, email, 'EDITOR');
      setCollaboratorEmail('');
      setShareSuccess(
        membership.role === 'VIEWER'
          ? `${email} already has viewer access.`
          : `${email} can now edit this list.`,
      );
    } catch (err) {
      const error = err as Error & { status?: number };
      if (error.status === 404) {
        setShareError('That email must register before you can add them.');
      } else if (error.status === 403) {
        setShareError('Only the list owner can add collaborators.');
      } else {
        setShareError(error.message);
      }
    } finally {
      setShareBusy(false);
    }
  }

  function startEditing(todoId: string) {
    socketRef.current?.emit('editing:start', { listId: list.id, todoId });
  }

  function stopEditing(todoId: string) {
    socketRef.current?.emit('editing:stop', { listId: list.id, todoId });
  }

  // Debounced text autosave shared by name + description.
  function autosaveText(
    todo: Todo,
    field: 'name' | 'description',
    value: string,
  ) {
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, [field]: value } : t)));
    const key = `${todo.id}:${field}`;
    const generation = (saveGenerations.current[key] ?? 0) + 1;
    saveGenerations.current[key] = generation;
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      const expectedToken = token;
      const expectedListId = list.id;
      try {
        const payload = field === 'description' ? { description: value || null } : { name: value };
        const saved = await api.updateTodo(expectedToken, todo.id, todo.version, payload);
        if (
          saveGenerations.current[key] !== generation ||
          !currentContext(expectedToken, expectedListId)
        ) return;
        setTodos((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
        setTodoErrors((prev) => {
          const next = { ...prev };
          delete next[todo.id];
          return next;
        });
      } catch (error) {
        const message = errorMessage(error, 'Could not save todo');
        if (
          saveGenerations.current[key] !== generation ||
          !currentContext(expectedToken, expectedListId)
        ) return;
        await reloadConfirmedTodos(
          expectedToken,
          expectedListId,
          () => saveGenerations.current[key] === generation,
        );
        if (
          saveGenerations.current[key] === generation &&
          currentContext(expectedToken, expectedListId)
        ) {
          setTodoErrors((prev) => ({ ...prev, [todo.id]: message }));
        }
      }
    }, 450);
  }

  async function patchField(
    todo: Todo,
    patch: Partial<
      Pick<Todo, 'status' | 'priority' | 'dueDate' | 'recurrenceUnit' | 'recurrenceInterval'>
    >,
  ) {
    const expectedToken = token;
    const expectedListId = list.id;
    const generation = (patchGenerations.current[todo.id] ?? 0) + 1;
    patchGenerations.current[todo.id] = generation;
    startEditing(todo.id);
    try {
      const saved = await api.updateTodo(expectedToken, todo.id, todo.version, patch);
      if (
        !currentContext(expectedToken, expectedListId) ||
        patchGenerations.current[todo.id] !== generation
      ) return;
      setTodos((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
      setTodoErrors((prev) => {
        const next = { ...prev };
        delete next[todo.id];
        return next;
      });
    } catch (error) {
      const message = errorMessage(error, 'Could not update todo');
      if (
        !currentContext(expectedToken, expectedListId) ||
        patchGenerations.current[todo.id] !== generation
      ) return;
      await reloadConfirmedTodos(
        expectedToken,
        expectedListId,
        () => patchGenerations.current[todo.id] === generation,
      );
      if (
        currentContext(expectedToken, expectedListId) &&
        patchGenerations.current[todo.id] === generation
      ) {
        setTodoErrors((prev) => ({ ...prev, [todo.id]: message }));
      }
    } finally {
      if (currentContext(expectedToken, expectedListId)) stopEditing(todo.id);
    }
  }

  function toggleComplete(todo: Todo) {
    const next: TodoStatus = todo.status === 'COMPLETED' ? 'NOT_STARTED' : 'COMPLETED';
    return patchField(todo, { status: next });
  }

  async function remove(todo: Todo) {
    if (pendingDeleteIds.current.has(todo.id)) return;
    const expectedToken = token;
    const expectedListId = list.id;
    pendingDeleteIds.current.add(todo.id);
    setPendingDeletes((prev) => new Set(prev).add(todo.id));
    setTodoErrors((prev) => {
      const next = { ...prev };
      delete next[todo.id];
      return next;
    });
    try {
      await api.deleteTodo(expectedToken, todo.id);
      if (!currentContext(expectedToken, expectedListId)) return;
      setTodos((prev) => prev.filter((t) => t.id !== todo.id));
    } catch (error) {
      if (currentContext(expectedToken, expectedListId)) {
        setTodoErrors((prev) => ({
          ...prev,
          [todo.id]: errorMessage(error, 'Could not delete todo'),
        }));
      }
    } finally {
      if (currentContext(expectedToken, expectedListId)) {
        pendingDeleteIds.current.delete(todo.id);
        setPendingDeletes((prev) => {
          const next = new Set(prev);
          next.delete(todo.id);
          return next;
        });
      }
    }
  }

  function refresh() {
    void loadTodos(false);
  }

  async function toggleDeps(todoId: string) {
    setDepErrors((prev) => {
      const next = { ...prev };
      delete next[todoId];
      return next;
    });
    if (openDeps === todoId) {
      setOpenDeps(null);
      return;
    }
    setOpenDeps(todoId);
    try {
      const deps = await api.dependencies(token, todoId);
      setDepsByTodo((prev) => ({ ...prev, [todoId]: deps }));
    } catch (err) {
      setDepErrors((prev) => ({ ...prev, [todoId]: errorMessage(err, 'Could not load dependencies') }));
    }
  }

  async function addDep(todoId: string, dependencyId: string) {
    if (!dependencyId) return;
    setDepErrors((prev) => {
      const next = { ...prev };
      delete next[todoId];
      return next;
    });
    try {
      await api.addDependency(token, todoId, dependencyId);
      const deps = await api.dependencies(token, todoId);
      setDepsByTodo((prev) => ({ ...prev, [todoId]: deps }));
      refresh();
    } catch (err) {
      setDepErrors((prev) => ({ ...prev, [todoId]: errorMessage(err, 'Could not add dependency') }));
    }
  }

  async function removeDep(todoId: string, depId: string) {
    setDepErrors((prev) => {
      const next = { ...prev };
      delete next[todoId];
      return next;
    });
    try {
      await api.removeDependency(token, todoId, depId);
      const deps = await api.dependencies(token, todoId);
      setDepsByTodo((prev) => ({ ...prev, [todoId]: deps }));
      refresh();
    } catch (err) {
      setDepErrors((prev) => ({ ...prev, [todoId]: errorMessage(err, 'Could not remove dependency') }));
    }
  }

  const canShare = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(collaboratorEmail.trim());

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

        {connectionLost && (
          <div className="connection-status" role="status" aria-live="polite">
            Live updates disconnected. Reconnecting…
          </div>
        )}

        {me.id === list.ownerId && (
          <form className="share-form" data-testid="share-form" onSubmit={addEditor}>
            <div className="share-field">
              <label className="label" htmlFor="collaborator-email">
                Collaborator email
              </label>
              <input
                className="input"
                id="collaborator-email"
                type="email"
                autoComplete="email"
                value={collaboratorEmail}
                disabled={shareBusy}
                onChange={(event) => {
                  setCollaboratorEmail(event.target.value);
                  setShareError(null);
                  setShareSuccess(null);
                }}
              />
            </div>
            <button
              className="btn btn-primary share-button"
              type="submit"
              disabled={!canShare || shareBusy}
            >
              {shareBusy ? 'Adding…' : 'Add editor'}
            </button>
            {(shareError || shareSuccess) && (
              <div className="share-feedback">
                {shareError && (
                  <ErrorAlert message={shareError} compact />
                )}
                {shareSuccess && (
                  <p className="success-text" role="status">
                    {shareSuccess}
                  </p>
                )}
              </div>
            )}
          </form>
        )}

        {loadState === 'loading' && (
          <p className="loading" role="status" aria-live="polite">
            Loading todos…
          </p>
        )}
        {loadError && <ErrorAlert message={loadError} onRetry={() => void loadTodos()} />}

        <div className="composer">
          <input
            className="input"
            placeholder="Add a todo…"
            value={newName}
            disabled={createBusy}
            onChange={(e) => {
              setNewName(e.target.value);
              setCreateError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createTodo();
            }}
            aria-label="New todo name"
          />
          <select
            className={`select priority-${newPriority}`}
            value={newPriority}
            disabled={createBusy}
            onChange={(e) => {
              setNewPriority(e.target.value as TodoPriority);
              setCreateError(null);
            }}
            aria-label="New todo priority"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
          <button
            className="btn btn-primary"
            onClick={() => void createTodo()}
            disabled={!newName.trim() || createBusy}
          >
            <PlusIcon size={16} />
            {createBusy ? 'Adding…' : 'Add'}
          </button>
        </div>
        {createError && <ErrorAlert message={createError} compact />}

        {loadState === 'ready' && todos.length === 0 ? (
          <p className="empty">Nothing here yet — add your first todo above.</p>
        ) : (
          <ul className="todo-list">
            {todos.map((todo) => {
              const lock = lockedByOther(todo.id);
              const disabled = Boolean(lock);
              const done = todo.status === 'COMPLETED';
              // "Blocked" only matters for actionable items — a completed or
              // archived todo is not waiting on anything.
              const blockedActive =
                Boolean(todo.blocked) && todo.status !== 'COMPLETED' && todo.status !== 'ARCHIVED';
              const unmet = (depsByTodo[todo.id] ?? []).filter((d) => d.status !== 'COMPLETED');
              return (
                <li
                  key={todo.id}
                  data-testid={`todo-row-${todo.id}`}
                  className={`todo-row${done ? ' is-done' : ''}`}
                >
                  <div className="todo-main">
                    <button
                      type="button"
                      data-testid={`todo-check-${todo.id}`}
                      className={`check check-${todo.priority}${done ? ' checked' : ''}`}
                      disabled={disabled || blockedActive}
                      onClick={() => void toggleComplete(todo)}
                      aria-label={done ? 'Mark as not done' : 'Mark as done'}
                      aria-pressed={done}
                      title={
                        blockedActive
                          ? 'Complete its dependencies first'
                          : done
                            ? 'Completed'
                            : 'Mark complete'
                      }
                    >
                      {done && <CheckIcon size={13} />}
                    </button>

                    <div className="todo-body">
                      <input
                        data-testid={`todo-name-${todo.id}`}
                        className="todo-name"
                        value={todo.name}
                        disabled={disabled}
                        onFocus={() => startEditing(todo.id)}
                        onBlur={() => stopEditing(todo.id)}
                        onChange={(e) => autosaveText(todo, 'name', e.target.value)}
                        aria-label="Todo name"
                      />
                      <input
                        data-testid={`todo-desc-${todo.id}`}
                        className="todo-desc"
                        value={todo.description ?? ''}
                        placeholder="Add description"
                        disabled={disabled}
                        onFocus={() => startEditing(todo.id)}
                        onBlur={() => stopEditing(todo.id)}
                        onChange={(e) => autosaveText(todo, 'description', e.target.value)}
                        aria-label="Description"
                      />

                      <div className="todo-tags">
                        {todo.dueDate && (
                          <span className="tag tag-due">{formatDue(todo.dueDate)}</span>
                        )}
                        {todo.priority !== 'MEDIUM' && (
                          <span className={`tag priority-${todo.priority}`}>
                            {PRIORITY_LABEL[todo.priority]}
                          </span>
                        )}
                        {todo.recurrenceUnit && (
                          <span className="tag tag-repeat">
                            {todo.recurrenceUnit === 'DAY'
                              ? 'Daily'
                              : todo.recurrenceUnit === 'WEEK'
                                ? 'Weekly'
                                : 'Monthly'}
                          </span>
                        )}
                        {blockedActive && (
                          <span className="tag tag-blocked" data-testid={`blocked-${todo.id}`}>
                            Blocked
                            {unmet.length > 0 && ` by ${unmet.map((d) => d.name).join(', ')}`}
                          </span>
                        )}
                        {lock && (
                          <span className="tag tag-lock" data-testid={`lock-badge-${todo.id}`}>
                            <LockIcon size={11} />
                            {lock.displayName} is editing
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      className={`deps-toggle${openDeps === todo.id ? ' active' : ''}`}
                      onClick={() => toggleDeps(todo.id)}
                      aria-expanded={openDeps === todo.id}
                    >
                      Deps
                    </button>
                    <button
                      data-testid={`todo-delete-${todo.id}`}
                      className="btn-icon-danger"
                      disabled={disabled || pendingDeletes.has(todo.id)}
                      onClick={() => void remove(todo)}
                      aria-label="Delete todo"
                      title="Delete"
                    >
                      <TrashIcon size={16} />
                    </button>
                  </div>

                  {todoErrors[todo.id] && (
                    <ErrorAlert message={todoErrors[todo.id]} compact />
                  )}

                  {openDeps === todo.id && (
                    <div className="deps-panel">
                      <div className="deps-controls">
                        <label className="deps-control">
                          <span className="deps-control-label">Status</span>
                          <select
                            className={`select status-${todo.status}`}
                            value={todo.status}
                            disabled={disabled}
                            onChange={(e) =>
                              patchField(todo, { status: e.target.value as TodoStatus })
                            }
                            aria-label="Status"
                          >
                            {STATUSES.map((s) => (
                              <option
                                key={s}
                                value={s}
                                disabled={blockedActive && (s === 'COMPLETED' || s === 'IN_PROGRESS')}
                              >
                                {STATUS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="deps-control">
                          <span className="deps-control-label">Priority</span>
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
                        </label>
                        <label className="deps-control">
                          <span className="deps-control-label">Due</span>
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
                        </label>
                        <label className="deps-control">
                          <span className="deps-control-label">Repeat</span>
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
                        </label>
                      </div>

                      <div className="deps-section">
                        <span className="deps-section-label">Depends on</span>
                        <div className="deps-chips">
                          {(depsByTodo[todo.id] ?? []).length === 0 ? (
                            <span className="deps-empty">No dependencies</span>
                          ) : (
                            (depsByTodo[todo.id] ?? []).map((d) => (
                              <span
                                key={d.id}
                                className={`dep-chip${d.status === 'COMPLETED' ? ' met' : ''}`}
                              >
                                <span className={`dep-dot status-${d.status}`} title={d.status} />
                                {d.name}
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
                          <select
                            className="select dep-add"
                            value=""
                            onChange={(e) => addDep(todo.id, e.target.value)}
                            aria-label="Add dependency"
                          >
                            <option value="">+ Add dependency…</option>
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
                        </div>
                        {depErrors[todo.id] && (
                          <ErrorAlert message={depErrors[todo.id]} compact onDismiss={() =>
                            setDepErrors((prev) => {
                              const next = { ...prev };
                              delete next[todo.id];
                              return next;
                            })
                          } />
                        )}
                      </div>
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
