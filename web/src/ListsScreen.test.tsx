import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListsScreen } from './ListsScreen';
import { TodoList } from './types';

const apiMocks = vi.hoisted(() => ({
  lists: vi.fn(),
  createList: vi.fn(),
}));

vi.mock('./api', () => ({
  api: {
    lists: apiMocks.lists,
    createList: apiMocks.createList,
  },
}));

function deferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const token = 'token-1';
const groceries: TodoList = { id: 'list-1', name: 'Groceries', ownerId: 'user-1' };

function renderScreen() {
  render(<ListsScreen token={token} onOpen={vi.fn()} onLogout={vi.fn()} />);
}

describe('ListsScreen', () => {
  beforeEach(() => {
    apiMocks.lists.mockReset();
    apiMocks.createList.mockReset();
  });

  afterEach(cleanup);

  it('shows loading without the empty state while the initial request is pending', () => {
    apiMocks.lists.mockReturnValue(new Promise(() => undefined));

    renderScreen();

    expect(screen.getByRole('status').textContent).toBe('Loading lists…');
    expect(screen.getByRole('status').className).toContain('loading-state');
    expect(screen.queryByText(/No lists yet/)).toBeNull();
  });

  it('shows a load error and retries successfully without flashing the empty state', async () => {
    apiMocks.lists
      .mockRejectedValueOnce(new Error("Couldn't load your lists."))
      .mockResolvedValueOnce([groceries]);

    renderScreen();

    expect((await screen.findByRole('alert')).textContent).toContain(
      "Couldn't load your lists.",
    );
    expect(screen.queryByText(/No lists yet/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(apiMocks.lists).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Groceries')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the empty state after a successful empty load', async () => {
    apiMocks.lists.mockResolvedValue([]);

    renderScreen();

    expect(await screen.findByText(/No lists yet/)).toBeTruthy();
    expect(screen.queryByText('Loading lists…')).toBeNull();
  });

  it('preserves the exact name and shows a contextual alert when creation fails', async () => {
    apiMocks.lists.mockResolvedValue([]);
    const creation = deferredPromise<TodoList>();
    apiMocks.createList.mockReturnValue(creation.promise);
    renderScreen();
    await screen.findByText(/No lists yet/);

    const input = screen.getByLabelText('New list name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  Weekend errands  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    const pendingButton = screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement;
    expect(pendingButton.disabled).toBe(true);
    expect(apiMocks.createList).toHaveBeenCalledWith(token, 'Weekend errands');

    await act(async () => {
      creation.reject(new Error('List name is already in use.'));
      await creation.promise.catch(() => undefined);
    });

    expect(screen.getByRole('alert').textContent).toContain('List name is already in use.');
    expect(input.value).toBe('  Weekend errands  ');
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('clears a prior create error and appends exactly one list after a successful retry', async () => {
    apiMocks.lists.mockResolvedValue([]);
    apiMocks.createList.mockRejectedValueOnce(new Error('Please try again.'));
    renderScreen();
    await screen.findByText(/No lists yet/);

    const input = screen.getByLabelText('New list name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Groceries' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByRole('alert');

    const retry = deferredPromise<TodoList>();
    apiMocks.createList.mockReturnValueOnce(retry.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    fireEvent.submit(input.closest('form')!);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(apiMocks.createList).toHaveBeenCalledTimes(2);

    await act(async () => {
      retry.resolve(groceries);
      await retry.promise;
    });

    expect(screen.getAllByText('Groceries')).toHaveLength(1);
    expect(input.value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a created list when creation finishes before a stale initial load', async () => {
    const loading = deferredPromise<TodoList[]>();
    const creation = deferredPromise<TodoList>();
    apiMocks.lists.mockReturnValue(loading.promise);
    apiMocks.createList.mockReturnValue(creation.promise);
    renderScreen();

    const input = screen.getByLabelText('New list name');
    fireEvent.change(input, { target: { value: 'Groceries' } });
    fireEvent.submit(input.closest('form')!);

    await act(async () => {
      creation.resolve(groceries);
      await creation.promise;
    });
    await act(async () => {
      loading.resolve([]);
      await loading.promise;
    });

    expect(screen.getAllByText('Groceries')).toHaveLength(1);
    expect(screen.queryByText(/No lists yet/)).toBeNull();
  });

  it('does not duplicate a created list when loading finishes before creation', async () => {
    const loading = deferredPromise<TodoList[]>();
    const creation = deferredPromise<TodoList>();
    apiMocks.lists.mockReturnValue(loading.promise);
    apiMocks.createList.mockReturnValue(creation.promise);
    renderScreen();

    const input = screen.getByLabelText('New list name');
    fireEvent.change(input, { target: { value: 'Groceries' } });
    fireEvent.submit(input.closest('form')!);

    await act(async () => {
      loading.resolve([groceries]);
      await loading.promise;
    });
    await act(async () => {
      creation.resolve(groceries);
      await creation.promise;
    });

    expect(screen.getAllByText('Groceries')).toHaveLength(1);
  });

  it('keeps a created list visible when the concurrent load fails', async () => {
    const loading = deferredPromise<TodoList[]>();
    apiMocks.lists.mockReturnValue(loading.promise);
    apiMocks.createList.mockResolvedValue(groceries);
    renderScreen();

    const input = screen.getByLabelText('New list name');
    fireEvent.change(input, { target: { value: 'Groceries' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(apiMocks.createList).toHaveBeenCalledTimes(1));

    await act(async () => {
      loading.reject(new Error("Couldn't refresh your lists."));
      await loading.promise.catch(() => undefined);
    });

    expect(screen.getByRole('alert').textContent).toContain(
      "Couldn't refresh your lists.",
    );
    expect(screen.getAllByText('Groceries')).toHaveLength(1);
    expect(screen.queryByText(/No lists yet/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('ignores an old-token creation and allows the new account to create', async () => {
    const oldCreation = deferredPromise<TodoList>();
    const newCreation = deferredPromise<TodoList>();
    apiMocks.lists.mockResolvedValue([]);
    apiMocks.createList
      .mockReturnValueOnce(oldCreation.promise)
      .mockReturnValueOnce(newCreation.promise);
    const view = render(
      <ListsScreen token="old-token" onOpen={vi.fn()} onLogout={vi.fn()} />,
    );
    await screen.findByText(/No lists yet/);

    const input = screen.getByLabelText('New list name');
    fireEvent.change(input, { target: { value: 'Groceries' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeTruthy();

    view.rerender(
      <ListsScreen token="new-token" onOpen={vi.fn()} onLogout={vi.fn()} />,
    );
    await waitFor(() => expect(apiMocks.lists).toHaveBeenCalledWith('new-token'));
    expect((screen.getByLabelText('New list name') as HTMLInputElement).value).toBe('');

    fireEvent.change(screen.getByLabelText('New list name'), { target: { value: 'Work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await act(async () => {
      oldCreation.resolve(groceries);
      await oldCreation.promise;
    });

    expect(screen.queryByText('Groceries')).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await act(async () => {
      newCreation.resolve({ id: 'list-2', name: 'Work', ownerId: 'user-2' });
      await newCreation.promise;
    });

    expect(screen.getAllByText('Work')).toHaveLength(1);
  });
});
