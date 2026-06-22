import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const apiMocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  lists: vi.fn(),
  unauthorizedHandler: null as (() => void) | null,
}));

vi.mock('./api', () => ({
  api: {
    login: apiMocks.login,
    register: apiMocks.register,
    refresh: apiMocks.refresh,
    logout: apiMocks.logout,
    lists: apiMocks.lists,
  },
  setUnauthorizedHandler: (handler: (() => void) | null) => {
    apiMocks.unauthorizedHandler = handler;
  },
}));

const storedSession = {
  accessToken: 'stored-token',
  user: { id: 'user-1', email: 'ada@example.com', displayName: 'Ada' },
};

const newSession = {
  accessToken: 'new-token',
  user: { id: 'user-2', email: 'grace@example.com', displayName: 'Grace' },
};

function storeSession() {
  localStorage.setItem('token', storedSession.accessToken);
  localStorage.setItem('user', JSON.stringify(storedSession.user));
}

async function renderStoredSession() {
  storeSession();
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'My lists' })).toBeTruthy();
  await waitFor(() => expect(apiMocks.unauthorizedHandler).not.toBeNull());
}

function expireSession() {
  act(() => apiMocks.unauthorizedHandler?.());
}

describe('App session recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    apiMocks.login.mockReset();
    apiMocks.register.mockReset();
    apiMocks.refresh.mockReset().mockRejectedValue(new Error('no refresh session'));
    apiMocks.logout.mockReset().mockResolvedValue(undefined);
    apiMocks.lists.mockReset().mockResolvedValue([]);
    apiMocks.unauthorizedHandler = null;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('clears stored auth and returns an expired session to login with an alert', async () => {
    await renderStoredSession();

    expireSession();

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'Your session expired. Please log in again.',
    );
  });

  it('keeps the logged-out expired state stable when notified twice', async () => {
    await renderStoredSession();

    act(() => {
      apiMocks.unauthorizedHandler?.();
      apiMocks.unauthorizedHandler?.();
    });

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('stores a successful login after expiry and clears the session alert', async () => {
    apiMocks.login.mockResolvedValue(newSession);
    await renderStoredSession();
    expireSession();

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: newSession.user.email },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('heading', { name: 'My lists' })).toBeTruthy();
    expect(localStorage.getItem('token')).toBe(newSession.accessToken);
    expect(localStorage.getItem('user')).toBe(JSON.stringify(newSession.user));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears an auth notice on explicit logout even when logout fails', async () => {
    apiMocks.refresh
      .mockResolvedValueOnce(newSession)
      .mockReturnValue(new Promise(() => undefined));
    apiMocks.logout.mockRejectedValue(new Error('offline'));
    await renderStoredSession();
    expireSession();

    expect(await screen.findByRole('heading', { name: 'My lists' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });
});
