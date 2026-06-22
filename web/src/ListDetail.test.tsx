import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ListDetail } from './ListDetail';

vi.mock('./api', () => ({
  api: {
    todos: vi.fn().mockResolvedValue([
      {
        id: 't1',
        listId: 'l1',
        name: 'Buy milk',
        description: null,
        status: 'NOT_STARTED',
        version: 1,
      },
    ]),
  },
}));

const emit = vi.fn();
vi.mock('./socket', () => ({
  createSocket: () => ({
    on: vi.fn(),
    emit,
    disconnect: vi.fn(),
  }),
}));

describe('ListDetail', () => {
  it('renders the list name and a fetched todo', async () => {
    render(
      <ListDetail
        token="tok"
        me={{ id: 'u1', email: 'a@x.com', displayName: 'Alice' }}
        list={{ id: 'l1', name: 'Groceries', ownerId: 'u1' }}
        onBack={() => undefined}
      />,
    );
    expect(screen.getByText('Groceries')).toBeTruthy();
    expect(await screen.findByDisplayValue('Buy milk')).toBeTruthy();
  });
});
