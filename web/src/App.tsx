import { useEffect, useState } from 'react';
import { api } from './api';
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
  const [openList, setOpenList] = useState<TodoList | null>(null);

  // No stored session? Try to restore one from the httpOnly refresh cookie.
  useEffect(() => {
    if (auth) return;
    let cancelled = false;
    api
      .refresh()
      .then((result) => {
        if (cancelled) return;
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
    saveSession(result);
    setAuth(result);
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      /* ignore network errors on logout */
    }
    clearSession();
    setOpenList(null);
    setAuth(null);
  }

  if (!auth) {
    return <AuthScreen onAuth={handleAuth} />;
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
