import { useState } from 'react';
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

export function App() {
  const [auth, setAuth] = useState<AuthResult | null>(loadSession);
  const [openList, setOpenList] = useState<TodoList | null>(null);

  function handleAuth(result: AuthResult) {
    saveSession(result);
    setAuth(result);
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
  return <ListsScreen token={auth.accessToken} onOpen={setOpenList} />;
}
