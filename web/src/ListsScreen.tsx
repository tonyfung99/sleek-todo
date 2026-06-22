import { FormEvent, useEffect, useState } from 'react';
import { api } from './api';
import { TodoList } from './types';

export function ListsScreen({
  token,
  onOpen,
}: {
  token: string;
  onOpen: (list: TodoList) => void;
}) {
  const [lists, setLists] = useState<TodoList[]>([]);
  const [name, setName] = useState('');

  useEffect(() => {
    api.lists(token).then(setLists);
  }, [token]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const list = await api.createList(token, name.trim());
    setLists((prev) => [...prev, list]);
    setName('');
  }

  return (
    <div style={{ maxWidth: 480, margin: '32px auto' }}>
      <h2>My lists</h2>
      <form onSubmit={create} style={{ display: 'flex', gap: 8 }}>
        <input
          placeholder="New list name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit">Create</button>
      </form>
      <ul>
        {lists.map((l) => (
          <li key={l.id}>
            <button
              data-testid={`list-item-${l.id}`}
              onClick={() => onOpen(l)}
              style={{ cursor: 'pointer' }}
            >
              {l.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
