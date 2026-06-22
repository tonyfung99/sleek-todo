import { FormEvent, useState } from 'react';
import { api } from './api';
import { AuthResult } from './types';

export function AuthScreen({ onAuth }: { onAuth: (r: AuthResult) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result =
        mode === 'register'
          ? await api.register(email, password, displayName)
          : await api.login(email, password);
      onAuth(result);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 320, margin: '64px auto', display: 'grid', gap: 8 }}>
      <h2>SleekTodo — {mode === 'register' ? 'Register' : 'Login'}</h2>
      {mode === 'register' && (
        <input
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      )}
      <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit">{mode === 'register' ? 'Create account' : 'Log in'}</button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <button
        type="button"
        onClick={() => setMode(mode === 'register' ? 'login' : 'register')}
        style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer' }}
      >
        {mode === 'register' ? 'Have an account? Log in' : 'Need an account? Register'}
      </button>
    </form>
  );
}
