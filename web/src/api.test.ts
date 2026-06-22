import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, setUnauthorizedHandler } from './api';

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
  });

  afterEach(() => {
    setUnauthorizedHandler(null);
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

  it('notifies once for an authenticated 401 and rejects with the same ApiError', async () => {
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    vi.mocked(fetch).mockResolvedValue(response(401, { message: 'Session expired' }));

    await expect(api.lists('expired')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      kind: 'auth',
      message: 'Session expired',
    });
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('keeps a public login 401 local and preserves its domain message', async () => {
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    vi.mocked(fetch).mockResolvedValue(response(401, { message: 'Invalid credentials' }));

    await expect(api.login('person@example.com', 'wrong')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      kind: 'auth',
      message: 'Invalid credentials',
    });
    expect(unauthorized).not.toHaveBeenCalled();
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
