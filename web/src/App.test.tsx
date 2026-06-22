import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const apiMocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  lists: vi.fn(),
  unauthorizedHandler: null as ((failedToken: string) => void) | null,
  tokenRecoveryHandler: null as ((failedToken: string) => Promise<string | null>) | null,
  clearTokenRecoveryState: vi.fn(),
}));

vi.mock('./api', () => ({
  api: {
    login: apiMocks.login,
    register: apiMocks.register,
    refresh: apiMocks.refresh,
    logout: apiMocks.logout,
    lists: apiMocks.lists,
  },
  setUnauthorizedHandler: (handler: ((failedToken: string) => void) | null) => {
    apiMocks.unauthorizedHandler = handler;
    return () => {
      if (apiMocks.unauthorizedHandler === handler) apiMocks.unauthorizedHandler = null;
    };
  },
  setTokenRecoveryHandler: (handler: ((failedToken: string) => Promise<string | null>) | null) => {
    apiMocks.tokenRecoveryHandler = handler;
    return () => {
      if (apiMocks.tokenRecoveryHandler === handler) apiMocks.tokenRecoveryHandler = null;
    };
  },
  clearTokenRecoveryState: apiMocks.clearTokenRecoveryState,
}));

const storedSession = {
  accessToken: 'stored-token',
  user: { id: 'user-1', email: 'ada@example.com', displayName: 'Ada' },
};

const newSession = {
  accessToken: 'new-token',
  user: { id: 'user-2', email: 'grace@example.com', displayName: 'Grace' },
};

function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function storeSession() {
  localStorage.setItem('token', storedSession.accessToken);
  localStorage.setItem('user', JSON.stringify(storedSession.user));
}

async function renderStoredSession() {
  storeSession();
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'My lists' })).toBeTruthy();
  await waitFor(() => expect(apiMocks.unauthorizedHandler).not.toBeNull());
  await waitFor(() => expect(apiMocks.tokenRecoveryHandler).not.toBeNull());
}

function expireSession(token = storedSession.accessToken) {
  act(() => apiMocks.unauthorizedHandler?.(token));
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
    apiMocks.tokenRecoveryHandler = null;
    apiMocks.clearTokenRecoveryState.mockReset();
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
    expect(screen.getByRole('alert').textContent).toBe(
      'Your session expired. Please log in again.',
    );
    expect(apiMocks.refresh).not.toHaveBeenCalled();
  });

  it('silently recovers a stored session and returns the exact replacement token', async () => {
    apiMocks.refresh.mockResolvedValue(newSession);
    await renderStoredSession();

    const recoveredToken = await act(() =>
      apiMocks.tokenRecoveryHandler!(storedSession.accessToken),
    );

    expect(recoveredToken).toBe(newSession.accessToken);
    expect(apiMocks.refresh).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('token')).toBe(newSession.accessToken);
    expect(localStorage.getItem('user')).toBe(JSON.stringify(newSession.user));
    expect(screen.getByRole('heading', { name: 'My lists' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(apiMocks.clearTokenRecoveryState).not.toHaveBeenCalled();
  });

  it('returns null after failed recovery and terminally expires the matching session', async () => {
    await renderStoredSession();

    const recoveredToken = await act(() =>
      apiMocks.tokenRecoveryHandler!(storedSession.accessToken),
    );
    expect(recoveredToken).toBeNull();

    expireSession(storedSession.accessToken);

    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      'Your session expired. Please log in again.',
    );
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(apiMocks.clearTokenRecoveryState).toHaveBeenCalledTimes(1);
    expect(apiMocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not recover an old token after a successful manual login', async () => {
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
    apiMocks.refresh.mockClear();

    const recoveredToken = await act(() =>
      apiMocks.tokenRecoveryHandler!(storedSession.accessToken),
    );

    expect(recoveredToken).toBeNull();
    expect(apiMocks.refresh).not.toHaveBeenCalled();
    expect(localStorage.getItem('token')).toBe(newSession.accessToken);
    expect(localStorage.getItem('user')).toBe(JSON.stringify(newSession.user));
  });

  it('does not let late recovery overwrite a newer manual login', async () => {
    const refresh = deferredPromise<typeof storedSession>();
    apiMocks.refresh.mockReturnValue(refresh.promise);
    apiMocks.login.mockResolvedValue(newSession);
    await renderStoredSession();

    const recovery = apiMocks.tokenRecoveryHandler!(storedSession.accessToken);
    expireSession();
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: newSession.user.email },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'My lists' })).toBeTruthy();

    await act(async () => refresh.resolve(storedSession));

    await expect(recovery).resolves.toBeNull();
    expect(localStorage.getItem('token')).toBe(newSession.accessToken);
    expect(localStorage.getItem('user')).toBe(JSON.stringify(newSession.user));
  });

  it('keeps the logged-out expired state stable when notified twice', async () => {
    await renderStoredSession();

    act(() => {
      apiMocks.unauthorizedHandler?.(storedSession.accessToken);
      apiMocks.unauthorizedHandler?.(storedSession.accessToken);
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
    apiMocks.clearTokenRecoveryState.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('heading', { name: 'My lists' })).toBeTruthy();
    expect(localStorage.getItem('token')).toBe(newSession.accessToken);
    expect(localStorage.getItem('user')).toBe(JSON.stringify(newSession.user));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(apiMocks.clearTokenRecoveryState).toHaveBeenCalledTimes(1);
  });

  it('ignores a delayed unauthorized response from the old token after login', async () => {
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

    expireSession(storedSession.accessToken);

    expect(screen.getByRole('heading', { name: 'My lists' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(localStorage.getItem('token')).toBe(newSession.accessToken);
    expect(localStorage.getItem('user')).toBe(JSON.stringify(newSession.user));
  });

  it('clears the current session when its token receives an unauthorized response', async () => {
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

    apiMocks.clearTokenRecoveryState.mockClear();
    expireSession(newSession.accessToken);

    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      'Your session expired. Please log in again.',
    );
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(apiMocks.clearTokenRecoveryState).toHaveBeenCalledTimes(1);
  });

  it('logs out locally before a failed logout request and does not bootstrap again', async () => {
    apiMocks.logout.mockRejectedValue(new Error('offline'));
    await renderStoredSession();

    apiMocks.clearTokenRecoveryState.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(apiMocks.clearTokenRecoveryState).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(apiMocks.logout).toHaveBeenCalledTimes(1));
    expect(apiMocks.refresh).not.toHaveBeenCalled();
  });

  it('clears recovery state before adopting an initial refresh-cookie session', async () => {
    apiMocks.refresh.mockResolvedValue(newSession);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'My lists' })).toBeTruthy();
    expect(localStorage.getItem('token')).toBe(newSession.accessToken);
    expect(apiMocks.clearTokenRecoveryState).toHaveBeenCalledTimes(1);
  });

  it('shares one bootstrap refresh across StrictMode effect replay', async () => {
    const refresh = deferredPromise<typeof newSession>();
    apiMocks.refresh.mockReturnValue(refresh.promise);

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await waitFor(() => expect(apiMocks.refresh).toHaveBeenCalledTimes(1));

    await act(async () => refresh.resolve(newSession));

    expect(await screen.findByRole('heading', { name: 'My lists' })).toBeTruthy();
    expect(apiMocks.refresh).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('token')).toBe(newSession.accessToken);
  });

  it('does not let late bootstrap overwrite a manual login', async () => {
    const refresh = deferredPromise<typeof storedSession>();
    apiMocks.refresh.mockReturnValue(refresh.promise);
    apiMocks.login.mockResolvedValue(newSession);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: newSession.user.email },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'My lists' })).toBeTruthy();

    await act(async () => refresh.resolve(storedSession));

    expect(localStorage.getItem('token')).toBe(newSession.accessToken);
    expect(localStorage.getItem('user')).toBe(JSON.stringify(newSession.user));
  });

  it('logs out immediately and waits for recovery before revoking the server session', async () => {
    const refresh = deferredPromise<typeof newSession>();
    const logout = deferredPromise<void>();
    apiMocks.refresh.mockReturnValue(refresh.promise);
    apiMocks.logout.mockReturnValue(logout.promise);
    await renderStoredSession();

    const recovery = apiMocks.tokenRecoveryHandler!(storedSession.accessToken);
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeTruthy();
    expect(localStorage.getItem('token')).toBeNull();
    await act(async () => Promise.resolve());
    expect(apiMocks.logout).not.toHaveBeenCalled();

    await act(async () => refresh.resolve(newSession));
    await expect(recovery).resolves.toBeNull();
    await waitFor(() => expect(apiMocks.logout).toHaveBeenCalledTimes(1));
    await act(async () => logout.resolve());

    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeTruthy();
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(apiMocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('waits for an obsolete bootstrap refresh before logging out a manual session', async () => {
    const bootstrap = deferredPromise<typeof storedSession>();
    apiMocks.refresh.mockReturnValue(bootstrap.promise);
    apiMocks.login.mockResolvedValue(newSession);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: newSession.user.email },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'My lists' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeTruthy();
    expect(localStorage.getItem('token')).toBeNull();
    await act(async () => Promise.resolve());
    expect(apiMocks.logout).not.toHaveBeenCalled();

    await act(async () => bootstrap.resolve(storedSession));
    await waitFor(() => expect(apiMocks.logout).toHaveBeenCalledTimes(1));

    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeTruthy();
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('releases only its own recovery-handler registration on cleanup', async () => {
    storeSession();
    const view = render(<App />);
    await waitFor(() => expect(apiMocks.tokenRecoveryHandler).not.toBeNull());
    const replacement = vi.fn(async () => null);

    apiMocks.tokenRecoveryHandler = replacement;
    view.unmount();

    expect(apiMocks.tokenRecoveryHandler).toBe(replacement);
  });
});
