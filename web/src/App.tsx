import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  clearTokenRecoveryState,
  setTokenRecoveryHandler,
  setUnauthorizedHandler,
} from './api';
import { AuthScreen } from './AuthScreen';
import { ListDetail } from './ListDetail';
import { ListsScreen } from './ListsScreen';
import { AuthResult, TodoList } from './types';

function loadSession(): AuthResult | null {
  try {
    const token = localStorage.getItem('token');
    const userRaw = localStorage.getItem('user');
    if (!token || !userRaw) return null;
    return { accessToken: token, user: JSON.parse(userRaw) };
  } catch {
    return null;
  }
}

function saveSession(result: AuthResult): void {
  localStorage.setItem('token', result.accessToken);
  localStorage.setItem('user', JSON.stringify(result.user));
}

function clearSession(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

export function App() {
  const [auth, setAuth] = useState<AuthResult | null>(loadSession);
  const authRef = useRef(auth);
  const [openList, setOpenList] = useState<TodoList | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const handleUnauthorized = useCallback((failedToken: string) => {
    if (authRef.current?.accessToken !== failedToken) return;
    clearTokenRecoveryState();
    authRef.current = null;
    clearSession();
    setOpenList(null);
    setAuth(null);
    setAuthNotice('Your session expired. Please log in again.');
  }, []);

  const recoverSession = useCallback(async (failedToken: string): Promise<string | null> => {
    if (authRef.current?.accessToken !== failedToken) return null;
    try {
      const result = await api.refresh();
      if (authRef.current?.accessToken !== failedToken) return null;
      authRef.current = result;
      saveSession(result);
      setAuth(result);
      setAuthNotice(null);
      return result.accessToken;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    return setUnauthorizedHandler(handleUnauthorized);
  }, [handleUnauthorized]);

  useEffect(() => {
    return setTokenRecoveryHandler(recoverSession);
  }, [recoverSession]);

  // No stored session? Try to restore one from the httpOnly refresh cookie.
  useEffect(() => {
    if (auth) return;
    let cancelled = false;
    api
      .refresh()
      .then((result) => {
        if (cancelled) return;
        clearTokenRecoveryState();
        authRef.current = result;
        saveSession(result);
        setAuth(result);
      })
      .catch(() => {
        /* no valid refresh cookie — stay on the auth screen */
      });
    return () => {
      cancelled = true;
    };
  }, [auth]);

  function handleAuth(result: AuthResult) {
    clearTokenRecoveryState();
    setAuthNotice(null);
    authRef.current = result;
    saveSession(result);
    setAuth(result);
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      /* ignore network errors on logout */
    }
    clearTokenRecoveryState();
    setAuthNotice(null);
    authRef.current = null;
    clearSession();
    setOpenList(null);
    setAuth(null);
  }

  if (!auth) {
    return (
      <AuthScreen
        onAuth={handleAuth}
        initialMode={authNotice ? 'login' : undefined}
        initialError={authNotice}
      />
    );
  }
  if (openList) {
    return (
      <ListDetail
        token={auth.accessToken}
        me={auth.user}
        list={openList}
        onBack={() => setOpenList(null)}
      />
    );
  }
  return <ListsScreen token={auth.accessToken} onOpen={setOpenList} onLogout={handleLogout} />;
}
