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
  const authGenerationRef = useRef(0);
  const bootstrapAttemptedRef = useRef(false);
  const bootstrapPromiseRef = useRef<Promise<AuthResult> | null>(null);
  const recoveryInFlightRef = useRef<Promise<string | null> | null>(null);
  const [openList, setOpenList] = useState<TodoList | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const handleUnauthorized = useCallback((failedToken: string) => {
    if (authRef.current?.accessToken !== failedToken) return;
    authGenerationRef.current += 1;
    clearTokenRecoveryState();
    authRef.current = null;
    clearSession();
    setOpenList(null);
    setAuth(null);
    setAuthNotice('Your session expired. Please log in again.');
  }, []);

  const recoverSession = useCallback((failedToken: string): Promise<string | null> => {
    if (authRef.current?.accessToken !== failedToken) return Promise.resolve(null);
    const generation = authGenerationRef.current;
    let recovery: Promise<string | null>;
    recovery = (async () => {
      try {
        const result = await api.refresh();
        if (
          authGenerationRef.current !== generation ||
          authRef.current?.accessToken !== failedToken
        ) {
          return null;
        }
        authRef.current = result;
        saveSession(result);
        setAuth(result);
        setAuthNotice(null);
        return result.accessToken;
      } catch {
        return null;
      }
    })().finally(() => {
      if (recoveryInFlightRef.current === recovery) recoveryInFlightRef.current = null;
    });
    recoveryInFlightRef.current = recovery;
    return recovery;
  }, []);

  useEffect(() => {
    return setUnauthorizedHandler(handleUnauthorized);
  }, [handleUnauthorized]);

  useEffect(() => {
    return setTokenRecoveryHandler(recoverSession);
  }, [recoverSession]);

  // No stored session? Try to restore one from the httpOnly refresh cookie.
  useEffect(() => {
    if (authRef.current) return;
    const generation = authGenerationRef.current;
    if (!bootstrapAttemptedRef.current) {
      bootstrapAttemptedRef.current = true;
      bootstrapPromiseRef.current = api.refresh();
    }
    const bootstrap = bootstrapPromiseRef.current;
    if (!bootstrap) return;
    let active = true;
    bootstrap
      .then((result) => {
        if (!active || authGenerationRef.current !== generation || authRef.current !== null) {
          return;
        }
        authGenerationRef.current += 1;
        clearTokenRecoveryState();
        authRef.current = result;
        saveSession(result);
        setAuth(result);
      })
      .catch(() => {
        /* no valid refresh cookie — stay on the auth screen */
      });
    return () => {
      active = false;
    };
  }, []);

  function handleAuth(result: AuthResult) {
    authGenerationRef.current += 1;
    clearTokenRecoveryState();
    setAuthNotice(null);
    authRef.current = result;
    saveSession(result);
    setAuth(result);
  }

  async function handleLogout() {
    const recovery = recoveryInFlightRef.current;
    authGenerationRef.current += 1;
    clearTokenRecoveryState();
    setAuthNotice(null);
    authRef.current = null;
    clearSession();
    setOpenList(null);
    setAuth(null);
    await recovery;
    try {
      await api.logout();
    } catch {
      /* ignore network errors on logout */
    }
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
