import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListDetail } from './ListDetail';

const apiMocks = vi.hoisted(() => ({
  todos: vi.fn(),
  createTodo: vi.fn(),
  updateTodo: vi.fn(),
  deleteTodo: vi.fn(),
  dependencies: vi.fn(),
  addDependency: vi.fn(),
  removeDependency: vi.fn(),
  addMember: vi.fn(),
}));

vi.mock('./api', () => ({
  api: apiMocks,
}));

const emit = vi.fn();
const socketHandlers: Record<string, (payload: never) => void> = {};
vi.mock('./socket', () => ({
  createSocket: () => ({
    on: vi.fn((event: string, handler: (payload: never) => void) => {
      socketHandlers[event] = handler;
    }),
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

const onUnauthorized = vi.fn();

function renderDetail(ownerId = 'u1', token = 'tok', listId = 'l1') {
  onUnauthorized.mockReset();
  return render(
    <ListDetail
      token={token}
      me={{ id: 'u1', email: 'a@x.com', displayName: 'Alice' }}
      list={{ id: listId, name: 'Groceries', ownerId }}
      onBack={() => undefined}
      onUnauthorized={onUnauthorized}
    />,
  );
}

describe('ListDetail', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    apiMocks.todos.mockReset().mockResolvedValue([todo]);
    apiMocks.createTodo.mockReset();
    apiMocks.updateTodo.mockReset();
    apiMocks.deleteTodo.mockReset();
    apiMocks.dependencies.mockReset().mockResolvedValue([]);
    apiMocks.addDependency.mockReset();
    apiMocks.removeDependency.mockReset();
    apiMocks.addMember.mockReset().mockResolvedValue({
      id: 'm1',
      listId: 'l1',
      userId: 'u2',
      role: 'EDITOR',
    });
    emit.mockReset();
    Object.keys(socketHandlers).forEach((key) => delete socketHandlers[key]);
  });

  it('shows loading feedback instead of the empty state while todos are pending', () => {
    apiMocks.todos.mockReturnValue(new Promise(() => undefined));
    renderDetail();

    expect(screen.getByRole('status').textContent).toContain('Loading todos…');
    expect(screen.queryByText(/Nothing here yet/)).toBeNull();
  });

  it('retries a failed initial load without showing the empty state', async () => {
    apiMocks.todos
      .mockRejectedValueOnce(new Error('Could not load todos'))
      .mockResolvedValueOnce([todo]);
    renderDetail();

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load todos');
    expect(screen.queryByText(/Nothing here yet/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByDisplayValue('Buy milk')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores a completed load from a previous token and list', async () => {
    let resolveOld: ((value: typeof todo[]) => void) | undefined;
    apiMocks.todos
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce([{ ...todo, id: 't2', listId: 'l2', name: 'Current todo' }]);
    const view = renderDetail('u1', 'old-token', 'l1');

    view.rerender(
      <ListDetail
        token="new-token"
        me={{ id: 'u1', email: 'a@x.com', displayName: 'Alice' }}
        list={{ id: 'l2', name: 'Current list', ownerId: 'u1' }}
        onBack={() => undefined}
      />,
    );
    expect(await screen.findByDisplayValue('Current todo')).toBeTruthy();

    await act(async () => resolveOld?.([todo]));
    expect(screen.queryByDisplayValue('Buy milk')).toBeNull();
    expect(screen.getByDisplayValue('Current todo')).toBeTruthy();
  });

  it('guards creation, preserves exact fields on failure, and appends once on retry', async () => {
    let rejectCreate: ((error: Error) => void) | undefined;
    apiMocks.createTodo
      .mockReturnValueOnce(new Promise((_, reject) => { rejectCreate = reject; }))
      .mockResolvedValueOnce({ ...todo, id: 't2', name: '  Call supplier  ', priority: 'HIGH' });
    renderDetail();
    await screen.findByDisplayValue('Buy milk');
    const input = screen.getByLabelText('New todo name') as HTMLInputElement;
    const priority = screen.getByLabelText('New todo priority') as HTMLSelectElement;
    fireEvent.change(input, { target: { value: '  Call supplier  ' } });
    fireEvent.change(priority, { target: { value: 'HIGH' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(apiMocks.createTodo).toHaveBeenLastCalledWith(
      'tok',
      'l1',
      'Call supplier',
      { priority: 'HIGH' },
    );
    const busy = screen.getByRole('button', { name: 'Adding…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(apiMocks.createTodo).toHaveBeenCalledTimes(1);
    await act(async () => rejectCreate?.(new Error('Could not add todo')));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not add todo');
    expect(input.value).toBe('  Call supplier  ');
    expect(priority.value).toBe('HIGH');

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const createdRow = await screen.findByTestId('todo-row-t2');
    expect((within(createdRow).getByLabelText('Todo name') as HTMLInputElement).value).toBe(
      '  Call supplier  ',
    );
    expect(input.value).toBe('');
    expect(priority.value).toBe('MEDIUM');
    expect(screen.queryByRole('alert')).toBeNull();

    act(() => socketHandlers['todo:created']?.({ todo: { ...todo, id: 't2', name: 'Duplicate' } } as never));
    expect(screen.getAllByTestId('todo-row-t2')).toHaveLength(1);
  });

  it('keeps a todo visible after failed deletion and removes it on retry', async () => {
    apiMocks.deleteTodo
      .mockRejectedValueOnce(new Error('Could not delete todo'))
      .mockResolvedValueOnce(undefined);
    renderDetail();
    const row = await screen.findByTestId('todo-row-t1');
    fireEvent.click(within(row).getByRole('button', { name: 'Delete todo' }));

    expect((await within(row).findByRole('alert')).textContent).toContain('Could not delete todo');
    expect(screen.getByDisplayValue('Buy milk')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Delete todo' }));
    await waitFor(() => expect(screen.queryByTestId('todo-row-t1')).toBeNull());
  });

  it('reloads a confirmed todo after patch failure and retains the operation alert', async () => {
    apiMocks.updateTodo
      .mockRejectedValueOnce(new Error('Priority update failed'))
      .mockResolvedValueOnce({ ...todo, priority: 'HIGH', version: 2 });
    apiMocks.todos
      .mockResolvedValueOnce([todo])
      .mockResolvedValueOnce([{ ...todo, priority: 'MEDIUM', version: 2 }]);
    renderDetail();
    const row = await screen.findByTestId('todo-row-t1');
    fireEvent.click(within(row).getByRole('button', { name: 'Deps' }));
    fireEvent.change(within(row).getByLabelText('Priority'), { target: { value: 'HIGH' } });

    expect((await within(row).findByRole('alert')).textContent).toContain('Priority update failed');
    expect((within(row).getByLabelText('Priority') as HTMLSelectElement).value).toBe('MEDIUM');
    fireEvent.change(within(row).getByLabelText('Priority'), { target: { value: 'HIGH' } });
    await waitFor(() => expect((within(row).getByLabelText('Priority') as HTMLSelectElement).value).toBe('HIGH'));
    expect(within(row).queryByRole('alert')).toBeNull();
  });

  it('restores confirmed text and keeps the original alert after autosave failure', async () => {
    vi.useFakeTimers();
    apiMocks.updateTodo.mockRejectedValueOnce(new Error('Name save failed'));
    apiMocks.todos
      .mockResolvedValueOnce([todo])
      .mockResolvedValueOnce([{ ...todo, name: 'Confirmed name', description: 'Confirmed description', version: 2 }]);
    renderDetail();
    await act(async () => { await vi.runAllTimersAsync(); });
    const row = screen.getByTestId('todo-row-t1');
    fireEvent.change(within(row).getByLabelText('Todo name'), { target: { value: 'Draft name' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    vi.useRealTimers();

    expect((within(row).getByLabelText('Todo name') as HTMLInputElement).value).toBe('Confirmed name');
    expect((within(row).getByLabelText('Description') as HTMLInputElement).value).toBe('Confirmed description');
    expect(within(row).getByRole('alert').textContent).toContain('Name save failed');
  });

  it('does not apply an autosave result after switching token and list', async () => {
    vi.useFakeTimers();
    let resolveSave: ((value: typeof todo) => void) | undefined;
    apiMocks.updateTodo.mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve; }));
    apiMocks.todos
      .mockResolvedValueOnce([todo])
      .mockResolvedValueOnce([{ ...todo, id: 't2', listId: 'l2', name: 'Current todo' }]);
    const view = renderDetail('u1', 'old-token', 'l1');
    await act(async () => { await vi.runAllTimersAsync(); });
    fireEvent.change(screen.getByLabelText('Todo name'), { target: { value: 'Old draft' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });

    view.rerender(
      <ListDetail
        token="new-token"
        me={{ id: 'u1', email: 'a@x.com', displayName: 'Alice' }}
        list={{ id: 'l2', name: 'Current list', ownerId: 'u1' }}
        onBack={() => undefined}
      />,
    );
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(screen.getByDisplayValue('Current todo')).toBeTruthy();
    await act(async () => resolveSave?.({ ...todo, name: 'Stale saved todo', version: 2 }));

    expect(screen.queryByDisplayValue('Stale saved todo')).toBeNull();
    expect(screen.getByDisplayValue('Current todo')).toBeTruthy();
    vi.useRealTimers();
  });

  it('keeps confirmed todos visible when a recovery reload also fails', async () => {
    apiMocks.updateTodo.mockRejectedValueOnce(new Error('Status update failed'));
    apiMocks.todos
      .mockResolvedValueOnce([todo])
      .mockRejectedValueOnce(new Error('Could not reload todos'));
    renderDetail();
    const row = await screen.findByTestId('todo-row-t1');
    fireEvent.click(within(row).getByRole('button', { name: 'Mark as done' }));

    await waitFor(() => {
      expect(screen.getAllByRole('alert')).toHaveLength(2);
    });
    expect(screen.getByDisplayValue('Buy milk')).toBeTruthy();
    expect(within(row).getByRole('alert').textContent).toContain('Status update failed');
    expect(screen.getByText('Could not reload todos')).toBeTruthy();
    expect(screen.queryByText(/Nothing here yet/)).toBeNull();
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
    fireEvent.click(screen.getByRole('button', { name: 'Add editor' }));

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

  it('reports existing viewer access without claiming edit access', async () => {
    apiMocks.addMember.mockResolvedValue({
      id: 'm1',
      listId: 'l1',
      userId: 'u2',
      role: 'VIEWER',
    });
    renderDetail();

    fireEvent.change(screen.getByLabelText('Collaborator email'), {
      target: { value: 'viewer@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add editor' }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain(
        'viewer@example.com already has viewer access',
      );
    });
  });

  it('keeps the submit button disabled for an invalid email', async () => {
    renderDetail();
    await screen.findByDisplayValue('Buy milk');

    fireEvent.change(screen.getByLabelText('Collaborator email'), {
      target: { value: 'not-an-email' },
    });

    const button = screen.getByRole('button', { name: 'Add editor' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('disables the submit button while adding an editor', async () => {
    apiMocks.addMember.mockReturnValue(new Promise(() => undefined));
    renderDetail();
    await screen.findByDisplayValue('Buy milk');

    fireEvent.change(screen.getByLabelText('Collaborator email'), {
      target: { value: 'bob@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add editor' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Add editor' }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain(
        'That email must register before you can add them',
      );
      expect(alert.classList.contains('error-alert')).toBe(true);
      expect(alert.classList.contains('error-alert-compact')).toBe(true);
    });
  });

  it('shows a dependency error scoped to its todo row', async () => {
    apiMocks.addDependency.mockRejectedValue(new Error('Would create a cycle'));
    const dep = { ...todo, id: 't2', name: 'Other task' };
    apiMocks.todos.mockResolvedValue([todo, dep]);
    renderDetail();
    const row = await screen.findByTestId('todo-row-t1');
    fireEvent.click(within(row).getByRole('button', { name: 'Deps' }));
    await waitFor(() => expect(within(row).getByLabelText('Add dependency')).toBeTruthy());
    fireEvent.change(within(row).getByLabelText('Add dependency'), { target: { value: 't2' } });
    await waitFor(() =>
      expect(within(row).getByRole('alert').textContent).toContain('Would create a cycle'),
    );
    const otherRow = screen.getByTestId('todo-row-t2');
    expect(within(otherRow).queryByRole('alert')).toBeNull();
  });

  it('shows a dependency removal error scoped to its todo row', async () => {
    apiMocks.removeDependency.mockRejectedValue(new Error('Could not remove dependency'));
    const dep = { ...todo, id: 't2', name: 'Prereq' };
    apiMocks.todos.mockResolvedValue([todo, dep]);
    apiMocks.dependencies.mockResolvedValue([dep]);
    renderDetail();
    const row = await screen.findByTestId('todo-row-t1');
    fireEvent.click(within(row).getByRole('button', { name: 'Deps' }));
    await waitFor(() => expect(within(row).getByText('Prereq')).toBeTruthy());
    fireEvent.click(within(row).getByRole('button', { name: 'Remove dependency Prereq' }));
    await waitFor(() =>
      expect(within(row).getByRole('alert').textContent).toContain('Could not remove dependency'),
    );
  });

  it('shows and clears real-time reconnection status', async () => {
    renderDetail();
    await screen.findByDisplayValue('Buy milk');
    act(() => socketHandlers.disconnect?.(undefined as never));
    expect(screen.getByRole('status', { name: '' }).textContent).toContain(
      'Live updates disconnected. Reconnecting…',
    );
    act(() => socketHandlers.connect?.(undefined as never));
    expect(screen.queryByText(/Live updates disconnected/)).toBeNull();
  });

  it('invokes onUnauthorized for a socket auth error', async () => {
    renderDetail();
    await screen.findByDisplayValue('Buy milk');
    act(() => {
      const err = Object.assign(new Error('Auth failed'), { data: { status: 401 } });
      socketHandlers.connect_error?.(err as never);
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Live updates disconnected/)).toBeNull();
  });

  it('shows connection status for non-auth socket errors', async () => {
    renderDetail();
    await screen.findByDisplayValue('Buy milk');
    act(() => {
      const err = Object.assign(new Error('Network error'), { data: {} });
      socketHandlers.connect_error?.(err as never);
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(screen.getByText(/Live updates disconnected/)).toBeTruthy();
  });
});
