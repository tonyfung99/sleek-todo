import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { api } from './api';
import { createSocket } from './socket';
import { AuthUser, LockGranted, Todo, TodoList, TodoStatus, Viewer } from './types';

const STATUSES: TodoStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'];

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
    <div style={{ maxWidth: 640, margin: '24px auto' }}>
      <button onClick={onBack}>&larr; Lists</button>
      <h2>{list.name}</h2>
      <div
        data-testid="presence-bar"
        style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}
      >
        <span>{viewers.length} viewing:</span>
        {viewers.map((v) => (
          <span
            key={v.userId}
            data-testid="presence-avatar"
            title={v.displayName}
            style={{
              background: v.color,
              color: 'white',
              borderRadius: 12,
              padding: '2px 8px',
              fontSize: 12,
            }}
          >
            {v.displayName}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          placeholder="New todo"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={{ flex: 1 }}
        />
        <button onClick={createTodo}>Add</button>
      </div>

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {todos.map((todo) => {
          const lock = lockedByOther(todo.id);
          const disabled = Boolean(lock);
          return (
            <li
              key={todo.id}
              data-testid={`todo-row-${todo.id}`}
              style={{ border: '1px solid #ddd', borderRadius: 8, padding: 8, marginBottom: 8 }}
            >
              <input
                data-testid={`todo-name-${todo.id}`}
                value={todo.name}
                disabled={disabled}
                onFocus={() => startEditing(todo.id)}
                onBlur={() => stopEditing(todo.id)}
                onChange={(e) => onNameChange(todo, e.target.value)}
                style={{ width: '100%', fontWeight: 600 }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                <select
                  value={todo.status}
                  disabled={disabled}
                  onChange={(e) => changeStatus(todo, e.target.value as TodoStatus)}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button
                  data-testid={`todo-delete-${todo.id}`}
                  disabled={disabled}
                  onClick={() => remove(todo)}
                >
                  Delete
                </button>
                {lock && (
                  <span
                    data-testid={`lock-badge-${todo.id}`}
                    style={{ color: '#b45309', fontSize: 12 }}
                  >
                    🔒 {lock.displayName} is editing
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
