# Token Refresh Recovery Design

## Goal

Recover transparently from an expired access token when the rotating refresh cookie is still valid. Redirect to login with a session-expired warning only when recovery cannot establish a new authenticated session.

## Considered Approaches

### Immediate logout on every authenticated 401

This is simple and is already safer than leaving the UI stuck, but it signs users out even when their valid refresh cookie could recover the session.

### Catch and refresh inside every screen

Each component could catch `401`, call refresh, and repeat its action. This duplicates concurrency and retry logic across every API call, risks multiple simultaneous refresh-token rotations, and produces inconsistent behavior.

### Central single-flight recovery and one replay

The request boundary coordinates one refresh for all requests that fail with the same access token. Each failed request waits for that recovery and replays once with the new token. This is the selected approach because it is consistent, testable, and prevents refresh stampedes.

## REST Request Flow

For a request carrying an access token:

1. Send the request normally.
2. If the response is not `401`, preserve existing success or error behavior.
3. On the first `401`, ask the registered recovery handler for a replacement token.
4. Share that recovery promise with every concurrent request that failed using the same token.
5. If recovery returns a new token, replay the original request once with the replacement Authorization header.
6. Never run recovery for the replay. A replayed `401` is terminal.
7. If recovery fails or returns no token, notify the terminal unauthorized handler with the failed token and reject.

Public registration, login, refresh, and logout requests do not enter this recovery path because they do not carry an access token. Network failures, `403`, and other statuses are not retried.

Replaying an authenticated mutation is safe for this case because the API authentication guard rejects an expired token before controller or service mutation logic runs. The client does not replay ambiguous network failures.

## Recovery Ownership

`App` remains the owner of session state and registers the asynchronous recovery handler.

- If the failed token matches the current session, call `api.refresh()` using the httpOnly refresh cookie.
- While refresh is pending, requests for that failed token share the same promise.
- On success, save the returned access token and user, update in-memory auth state synchronously, and return the replacement access token to waiting requests.
- On refresh failure, clear the matching session and show `Your session expired. Please log in again.`
- If the failed token no longer matches the current session because the user logged in again, do not clear or replay under the newer identity.

Registration cleanup remains ownership-safe so an older App lifecycle cannot remove a newer handler.

## Concurrency and Rotation

Refresh tokens rotate on every successful refresh, so parallel refresh requests are invalid. The client must maintain a single in-flight recovery promise per failed access token. All concurrent `401` responses for that token await the same refresh result.

The in-flight entry is removed after settlement. A delayed response from an older token cannot clear a newer login because terminal logout compares the failed token with the current token. It also must not replay an old user action under a different authenticated identity.

## Real-Time Authentication

Socket authentication failures use the same App-owned recovery operation:

- A socket `connect_error` identified as `401` requests recovery for the socket's access token.
- Successful recovery updates App auth state; the token prop change recreates the socket with the replacement token.
- Failed recovery follows the same terminal login redirect and warning.
- Ordinary disconnects continue to show the reconnecting status and do not refresh credentials.

## User Experience

- Successful silent recovery produces no warning or navigation change.
- The original action resolves normally after its one replay.
- While recovery is pending, existing action loading states remain active.
- Failed recovery clears protected screens and opens login mode with the persistent session-expired alert.
- Invalid login credentials remain inline on the login form and never trigger refresh recovery.

## API Boundaries

The client API module exposes two independently owned callbacks:

- An async access-token recovery handler that accepts the failed token and returns a replacement token or `null`.
- A terminal unauthorized handler that accepts the failed token and clears only the matching current session.

Both registrations return ownership-safe cleanup functions. The low-level request function accepts an internal retry flag so refresh and replay cannot recurse.

## Testing

### API tests

- One authenticated `401` calls recovery and replays with the replacement token.
- Two simultaneous `401` responses for the same token call refresh once and both replay successfully.
- A replayed `401` does not refresh again and invokes terminal unauthorized handling once for that request.
- Failed or null recovery invokes terminal handling and rejects.
- Public login and refresh `401` responses never invoke recovery.
- Network and non-401 failures are never replayed.

### App tests

- Successful recovery replaces persisted and in-memory auth without showing an alert.
- Refresh failure clears the matching session and shows the exact warning.
- A delayed old-token failure cannot clear or replay under a newer login.
- Handler cleanup does not clear a newer registration.

### Browser test

- An expired access token with a valid refresh cookie recovers without returning to login.
- An invalid access token without a valid refresh cookie redirects to login with the warning.

## Out of Scope

- Proactive refresh before token expiry.
- Refresh across multiple browser tabs.
- Retrying network failures.
- Persisting or queuing offline mutations.
- Changing server token lifetimes or rotation rules.
