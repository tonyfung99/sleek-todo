import { FormEvent, useState } from 'react';
import { api } from './api';
import { AuthResult } from './types';
import { CheckIcon } from './icons';

export function AuthScreen({ onAuth }: { onAuth: (r: AuthResult) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result =
        mode === 'register'
          ? await api.register(email, password, displayName)
          : await api.login(email, password);
      onAuth(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="center-narrow">
        <div className="brand">
          <span className="brand-mark">
            <CheckIcon size={18} />
          </span>
          SleekTodo
        </div>
        <h1 className="title" style={{ marginTop: 28 }}>
          {mode === 'register' ? 'Create your account' : 'Welcome back'}
        </h1>
        <p className="subtitle">
          {mode === 'register'
            ? 'Collaborate on shared lists in real time.'
            : 'Sign in to your shared lists.'}
        </p>

        <form onSubmit={submit} className="auth-form" noValidate>
          {mode === 'register' && (
            <div className="field">
              <label className="label" htmlFor="displayName">
                Display name
              </label>
              <input
                id="displayName"
                className="input"
                placeholder="Ada Lovelace"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          )}
          <div className="field">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              placeholder="At least 8 characters"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Log in'}
          </button>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </form>

        <p className="muted-row" style={{ marginTop: 18 }}>
          {mode === 'register' ? 'Already have an account?' : 'Need an account?'}{' '}
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              setError(null);
              setMode(mode === 'register' ? 'login' : 'register');
            }}
          >
            {mode === 'register' ? 'Log in' : 'Register'}
          </button>
        </p>
      </div>
    </main>
  );
}
