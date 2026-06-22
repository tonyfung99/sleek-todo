import { FormEvent, useEffect, useState } from 'react';
import { api } from './api';
import { TodoList } from './types';
import { CheckIcon, ListIcon, PlusIcon } from './icons';

export function ListsScreen({
  token,
  onOpen,
}: {
  token: string;
  onOpen: (list: TodoList) => void;
}) {
  const [lists, setLists] = useState<TodoList[]>([]);
  const [name, setName] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.lists(token).then((l) => {
      setLists(l);
      setLoaded(true);
    });
  }, [token]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const list = await api.createList(token, name.trim());
    setLists((prev) => [...prev, list]);
    setName('');
  }

  return (
    <main className="page">
      <div className="container" style={{ maxWidth: 560 }}>
        <div className="brand" style={{ marginBottom: 24 }}>
          <span className="brand-mark">
            <CheckIcon size={18} />
          </span>
          SleekTodo
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
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            <PlusIcon size={16} />
            Create
          </button>
        </form>

        {loaded && lists.length === 0 ? (
          <p className="empty">No lists yet — create your first one above.</p>
        ) : (
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
