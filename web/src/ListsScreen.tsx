import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { TodoList } from './types';
import { CheckIcon, ListIcon, PlusIcon } from './icons';
import { ErrorAlert } from './ErrorAlert';

type LoadState = 'loading' | 'ready' | 'error';

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}

export function ListsScreen({
  token,
  onOpen,
  onLogout,
}: {
  token: string;
  onOpen: (list: TodoList) => void;
  onLogout: () => void;
}) {
  const [lists, setLists] = useState<TodoList[]>([]);
  const [name, setName] = useState('');
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [createError, setCreateError] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const mountedRef = useRef(false);
  const loadRequestRef = useRef(0);
  const createRequestRef = useRef(0);
  const createBusyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    createRequestRef.current += 1;
    createBusyRef.current = false;
    setLists([]);
    setName('');
    setCreateError('');
    setCreateBusy(false);
  }, [token]);

  const loadLists = useCallback(async () => {
    const request = ++loadRequestRef.current;
    setLoadState('loading');
    setLoadError('');
    try {
      const nextLists = await api.lists(token);
      if (!mountedRef.current || request !== loadRequestRef.current) return;
      setLists((currentLists) => {
        const loadedIds = new Set(nextLists.map((list) => list.id));
        return [
          ...nextLists,
          ...currentLists.filter((list) => !loadedIds.has(list.id)),
        ];
      });
      setLoadState('ready');
    } catch (error) {
      if (!mountedRef.current || request !== loadRequestRef.current) return;
      setLoadError(errorMessage(error));
      setLoadState('error');
    }
  }, [token]);

  useEffect(() => {
    void loadLists();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [loadLists]);

  async function create(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || createBusyRef.current) return;
    const request = ++createRequestRef.current;
    createBusyRef.current = true;
    setCreateBusy(true);
    setCreateError('');
    try {
      const list = await api.createList(token, trimmedName);
      if (!mountedRef.current || request !== createRequestRef.current) return;
      setLists((prev) =>
        prev.some((existing) => existing.id === list.id) ? prev : [...prev, list],
      );
      setName('');
      setCreateError('');
    } catch (error) {
      if (!mountedRef.current || request !== createRequestRef.current) return;
      setCreateError(errorMessage(error));
    } finally {
      if (request !== createRequestRef.current) return;
      createBusyRef.current = false;
      if (mountedRef.current) setCreateBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="container" style={{ maxWidth: 560 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 24 }}>
          <div className="brand">
            <span className="brand-mark">
              <CheckIcon size={18} />
            </span>
            SleekTodo
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onLogout}>
            Log out
          </button>
        </div>

        <h1 className="title">My lists</h1>
        <p className="subtitle">Open a list to collaborate, or create a new one.</p>

        <form onSubmit={create} className="composer" style={{ marginTop: 20 }}>
          <input
            className="input"
            placeholder="New list name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="New list name"
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!name.trim() || createBusy}
          >
            <PlusIcon size={16} />
            {createBusy ? 'Creating…' : 'Create'}
          </button>
        </form>
        {createError && <ErrorAlert message={createError} compact />}

        {loadState === 'loading' && (
          <p className="loading-state" role="status" aria-live="polite">
            Loading lists…
          </p>
        )}
        {loadState === 'error' && <ErrorAlert message={loadError} onRetry={loadLists} />}
        {loadState === 'ready' && lists.length === 0 && (
          <p className="empty">No lists yet — create your first one above.</p>
        )}
        {(loadState === 'ready' || (loadState === 'error' && lists.length > 0)) && (
          <ul className="list-stack">
            {lists.map((l) => (
              <li key={l.id}>
                <button
                  data-testid={`list-item-${l.id}`}
                  className="list-item"
                  onClick={() => onOpen(l)}
                >
                  <ListIcon size={18} className="list-item-icon" />
                  {l.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
