import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  api,
  clearTokenRecoveryState,
  recoverAccessToken,
  setTokenRecoveryHandler,
  setUnauthorizedHandler,
} from './api';

function response(status: number, body: unknown, statusText = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('api errors', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    setUnauthorizedHandler(null);
    setTokenRecoveryHandler(null);
  });

  afterEach(() => {
    setUnauthorizedHandler(null);
    setTokenRecoveryHandler(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('normalizes a version conflict from updateTodo', async () => {
    vi.mocked(fetch).mockResolvedValue(response(409, { message: 'Version mismatch' }));

    const request = api.updateTodo('token', 'todo-1', 2, { name: 'Updated' });

    await expect(request).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      kind: 'conflict',
      message: 'Version mismatch',
    });
    await expect(request).rejects.toBeInstanceOf(ApiError);
  });

  it('normalizes fetch TypeError failures as safe network errors', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch internal detail'));

    await expect(api.lists('token')).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'network',
      message: "Couldn't connect. Check your connection and try again.",
    });
  });

  it('recovers an authenticated 401 and replays the original request once', async () => {
    const recovery = vi.fn().mockResolvedValue('new-token');
    setTokenRecoveryHandler(recovery);
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(401, { message: 'Session expired' }))
      .mockResolvedValueOnce(response(200, { id: 'todo-1', name: 'Updated' }));

    await expect(api.updateTodo('old-token', 'todo-1', 2, { name: 'Updated' })).resolves
      .toMatchObject({ id: 'todo-1', name: 'Updated' });

    expect(recovery).toHaveBeenCalledTimes(1);
    expect(recovery).toHaveBeenCalledWith('old-token');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[1]).toEqual([
      'http://localhost:3000/todos/todo-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated' }),
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': '2',
          Authorization: 'Bearer new-token',
        },
      }),
    ]);
  });

  it('shares recovery for concurrent 401 responses with the same failed token', async () => {
    let resolveRecovery!: (token: string | null) => void;
    const recoveryPromise = new Promise<string | null>((resolve) => {
      resolveRecovery = resolve;
    });
    const recovery = vi.fn().mockReturnValue(recoveryPromise);
    setTokenRecoveryHandler(recovery);
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(401, { message: 'Session expired' }))
      .mockResolvedValueOnce(response(401, { message: 'Session expired' }))
      .mockResolvedValueOnce(response(200, [{ id: 'list-1' }]))
      .mockResolvedValueOnce(response(200, [{ id: 'list-2' }]));

    const first = api.lists('old-token');
    const second = api.lists('old-token');
    await vi.waitFor(() => expect(recovery).toHaveBeenCalledTimes(1));

    resolveRecovery('new-token');

    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ id: 'list-1' }],
      [{ id: 'list-2' }],
    ]);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(vi.mocked(fetch).mock.calls.slice(2).map((call) => call[1])).toEqual([
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer new-token' }),
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer new-token' }),
      }),
    ]);
  });

  it('reuses a settled recovery when a concurrent old-token 401 arrives late', async () => {
    let resolveLateResponse!: (response: Response) => void;
    const lateResponse = new Promise<Response>((resolve) => {
      resolveLateResponse = resolve;
    });
    const recovery = vi.fn().mockResolvedValue('new-token');
    setTokenRecoveryHandler(recovery);
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(401, { message: 'Session expired' }))
      .mockReturnValueOnce(lateResponse)
      .mockResolvedValueOnce(response(200, [{ id: 'list-a' }]))
      .mockResolvedValueOnce(response(200, [{ id: 'list-b' }]));

    const first = api.lists('old-token');
    const second = api.lists('old-token');

    await expect(first).resolves.toEqual([{ id: 'list-a' }]);
    resolveLateResponse(response(401, { message: 'Session expired' }));
    await expect(second).resolves.toEqual([{ id: 'list-b' }]);

    expect(recovery).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(vi.mocked(fetch).mock.calls[3]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: 'Bearer new-token' }),
    });
  });

  it('does not recover a replayed 401 and terminal-notifies its replacement token once', async () => {
    const recovery = vi.fn().mockResolvedValue('new-token');
    const unauthorized = vi.fn();
    setTokenRecoveryHandler(recovery);
    setUnauthorizedHandler(unauthorized);
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(401, { message: 'Session expired' }))
      .mockResolvedValueOnce(response(401, { message: 'Replacement expired' }));

    await expect(api.lists('expired')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      kind: 'auth',
      message: 'Replacement expired',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(recovery).toHaveBeenCalledTimes(1);
    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect(unauthorized).toHaveBeenCalledWith('new-token');
  });

  it.each([
    [
      'null result',
      vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('later-token'),
    ],
    [
      'rejection',
      vi.fn()
        .mockRejectedValueOnce(new Error('refresh detail'))
        .mockResolvedValueOnce('later-token'),
    ],
  ])('terminal-notifies the original token safely when recovery returns a %s', async (_, recovery) => {
    const unauthorized = vi.fn();
    setTokenRecoveryHandler(recovery);
    setUnauthorizedHandler(unauthorized);
    vi.mocked(fetch).mockResolvedValue(response(401, { message: 'Session expired' }));

    await expect(api.lists('old-token')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      kind: 'auth',
      message: 'Session expired',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect(unauthorized).toHaveBeenCalledWith('old-token');
    await expect(recoverAccessToken('old-token')).resolves.toBe('later-token');
    expect(recovery).toHaveBeenCalledTimes(2);
  });

  it('does not notify for a 401 when an empty token sent no authorization header', async () => {
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    vi.mocked(fetch).mockResolvedValue(response(401, { message: 'Unauthorized' }));

    await expect(api.lists('')).rejects.toMatchObject({ status: 401, kind: 'auth' });

    expect(unauthorized).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('does not let an old unsubscribe clear a newer unauthorized handler', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = setUnauthorizedHandler(first);
    setUnauthorizedHandler(second);
    vi.mocked(fetch).mockResolvedValue(response(401, { message: 'Session expired' }));

    unsubscribeFirst();
    await expect(api.lists('current-token')).rejects.toMatchObject({ status: 401 });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('current-token');
  });

  it('does not let old recovery cleanup clear a newer recovery handler', async () => {
    const first = vi.fn().mockResolvedValue('first-token');
    const second = vi.fn().mockResolvedValue('second-token');
    const unsubscribeFirst = setTokenRecoveryHandler(first);
    setTokenRecoveryHandler(second);

    await expect(recoverAccessToken('new-owner-token')).resolves.toBe('second-token');

    unsubscribeFirst();

    await expect(recoverAccessToken('new-owner-token')).resolves.toBe('second-token');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith('new-owner-token');
  });

  it('expires a settled successful recovery after the bounded grace window', async () => {
    vi.useFakeTimers();
    const recovery = vi.fn()
      .mockResolvedValueOnce('new-token')
      .mockResolvedValueOnce('newer-token');
    setTokenRecoveryHandler(recovery);

    await expect(recoverAccessToken('old-token')).resolves.toBe('new-token');
    await expect(recoverAccessToken('old-token')).resolves.toBe('new-token');
    expect(recovery).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    await expect(recoverAccessToken('old-token')).resolves.toBe('newer-token');

    expect(recovery).toHaveBeenCalledTimes(2);
  });

  it('explicitly clears settled recovery state for a session replacement', async () => {
    const recovery = vi.fn()
      .mockResolvedValueOnce('new-token')
      .mockResolvedValueOnce('replacement-session-token');
    setTokenRecoveryHandler(recovery);

    await expect(recoverAccessToken('old-token')).resolves.toBe('new-token');
    clearTokenRecoveryState();
    await expect(recoverAccessToken('old-token')).resolves.toBe('replacement-session-token');

    expect(recovery).toHaveBeenCalledTimes(2);
  });

  it('clears recovery state owned by a removed handler registration', async () => {
    const first = vi.fn().mockResolvedValue('first-token');
    const unsubscribeFirst = setTokenRecoveryHandler(first);
    await expect(recoverAccessToken('old-token')).resolves.toBe('first-token');

    unsubscribeFirst();
    const second = vi.fn().mockResolvedValue('second-token');
    setTokenRecoveryHandler(second);

    await expect(recoverAccessToken('old-token')).resolves.toBe('second-token');
    expect(second).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['login', () => api.login('person@example.com', 'wrong')],
    ['refresh', () => api.refresh()],
  ])('keeps a public %s 401 local without recovery or terminal notification', async (_, request) => {
    const recovery = vi.fn().mockResolvedValue('new-token');
    const unauthorized = vi.fn();
    setTokenRecoveryHandler(recovery);
    setUnauthorizedHandler(unauthorized);
    vi.mocked(fetch).mockResolvedValue(response(401, { message: 'Invalid credentials' }));

    await expect(request()).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      kind: 'auth',
      message: 'Invalid credentials',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(recovery).not.toHaveBeenCalled();
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('does not recover or replay a 403', async () => {
    const recovery = vi.fn().mockResolvedValue('new-token');
    setTokenRecoveryHandler(recovery);
    vi.mocked(fetch).mockResolvedValue(response(403, { message: 'Forbidden' }));

    await expect(api.lists('old-token')).rejects.toMatchObject({
      status: 403,
      kind: 'permission',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(recovery).not.toHaveBeenCalled();
  });

  it('does not recover or replay a fetch network failure', async () => {
    const recovery = vi.fn().mockResolvedValue('new-token');
    setTokenRecoveryHandler(recovery);
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch internal detail'));

    await expect(api.lists('old-token')).rejects.toMatchObject({ kind: 'network' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(recovery).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'permission', "You don't have permission to do that."],
    [404, 'not-found', 'That item is no longer available.'],
  ] as const)('uses the safe fallback for a malformed %i response', async (status, kind, message) => {
    vi.mocked(fetch).mockResolvedValue(response(status, { message: { internal: 'detail' } }));

    await expect(api.lists('token')).rejects.toMatchObject({ status, kind, message });
  });

  it('does not expose messages from unexpected server failures', async () => {
    vi.mocked(fetch).mockResolvedValue(response(500, { message: 'database host db-1 failed' }));

    await expect(api.lists('token')).rejects.toMatchObject({
      status: 500,
      kind: 'unexpected',
      message: 'Something went wrong. Please try again.',
    });
  });
});
