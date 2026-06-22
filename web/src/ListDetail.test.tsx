import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListDetail } from './ListDetail';

const apiMocks = vi.hoisted(() => ({
  todos: vi.fn(),
  addMember: vi.fn(),
}));

vi.mock('./api', () => ({
  api: apiMocks,
}));

const emit = vi.fn();
vi.mock('./socket', () => ({
  createSocket: () => ({
    on: vi.fn(),
    emit,
    disconnect: vi.fn(),
  }),
}));

const todo = {
  id: 't1',
  listId: 'l1',
  name: 'Buy milk',
  description: null,
  dueDate: null,
  status: 'NOT_STARTED',
  priority: 'MEDIUM',
  recurrenceUnit: null,
  recurrenceInterval: null,
  version: 1,
  blocked: false,
};

function renderDetail(ownerId = 'u1') {
  return render(
    <ListDetail
      token="tok"
      me={{ id: 'u1', email: 'a@x.com', displayName: 'Alice' }}
      list={{ id: 'l1', name: 'Groceries', ownerId }}
      onBack={() => undefined}
    />,
  );
}

describe('ListDetail', () => {
  beforeEach(() => {
    apiMocks.todos.mockReset().mockResolvedValue([todo]);
    apiMocks.addMember.mockReset().mockResolvedValue({
      id: 'm1',
      listId: 'l1',
      userId: 'u2',
      role: 'EDITOR',
    });
  });

  it('renders the list name and a fetched todo', async () => {
    renderDetail();
    expect(screen.getByText('Groceries')).toBeTruthy();
    expect(await screen.findByDisplayValue('Buy milk')).toBeTruthy();
  });

  it('shows collaborator sharing only to the list owner', async () => {
    const ownerView = renderDetail();
    await screen.findByDisplayValue('Buy milk');
    expect(screen.getByLabelText('Collaborator email')).toBeTruthy();

    ownerView.unmount();
    renderDetail('u2');
    await screen.findByDisplayValue('Buy milk');
    expect(screen.queryByLabelText('Collaborator email')).toBeNull();
  });

  it('adds an editor with a trimmed email and reports success', async () => {
    renderDetail();
    const email = screen.getByLabelText('Collaborator email') as HTMLInputElement;

    fireEvent.change(email, { target: { value: '  bob@example.com  ' } });
    fireEvent.submit(screen.getByTestId('share-form'));

    await waitFor(() => {
      expect(apiMocks.addMember).toHaveBeenCalledWith(
        'tok',
        'l1',
        'bob@example.com',
        'EDITOR',
      );
    });
    await waitFor(() => expect(email.value).toBe(''));
    expect(screen.getByRole('status').textContent).toContain(
      'bob@example.com can now edit this list',
    );
  });

  it('disables the submit button while adding an editor', async () => {
    apiMocks.addMember.mockReturnValue(new Promise(() => undefined));
    renderDetail();
    await screen.findByDisplayValue('Buy milk');

    fireEvent.change(screen.getByLabelText('Collaborator email'), {
      target: { value: 'bob@example.com' },
    });
    fireEvent.submit(screen.getByTestId('share-form'));

    const button = screen.getByRole('button', { name: 'Adding…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('explains that an unknown collaborator must register first', async () => {
    apiMocks.addMember.mockRejectedValue(
      Object.assign(new Error('User not found'), { status: 404 }),
    );
    renderDetail();

    fireEvent.change(screen.getByLabelText('Collaborator email'), {
      target: { value: 'missing@example.com' },
    });
    fireEvent.submit(screen.getByTestId('share-form'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'That email must register before you can add them',
      );
    });
  });
});
