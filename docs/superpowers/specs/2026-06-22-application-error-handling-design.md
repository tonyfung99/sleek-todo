# Application Error Handling Design

## Goal

Ensure every failed API or real-time operation produces clear, accessible, recoverable feedback instead of an unhandled promise rejection, a console-only message, or a misleading empty state.

## Current Problem

The API client throws errors with an HTTP status, but most authenticated UI flows do not catch them. Authentication and collaborator sharing display errors, while list loading, todo loading, create/update/delete operations, dependency operations, background refreshes, and socket connection failures are silent or unhandled. An invalid access token leaves the application on an authenticated screen with no recovery path.

## UX Principles

The design follows the `ui-ux-pro-max` guidance for forms and feedback:

- Place errors near the operation that failed.
- Use `role="alert"` or an appropriate live region so errors are announced.
- State what happened and provide a recovery action when one is useful.
- Never communicate severity through color alone; pair semantic color with an icon and text.
- Preserve user input after failed submissions.
- Reserve transient notifications for non-critical information. Errors remain visible until the user retries, dismisses them, or performs the action successfully.
- Avoid layout shifts by reserving or naturally allocating space within the affected region.

The existing visual language remains unchanged. Error UI uses the current semantic danger tokens, border radius, typography, spacing scale, and SVG icon style.

## Architecture

### Structured API errors

The request layer will expose an `ApiError` with:

- `status`: HTTP status when a response exists.
- `message`: a safe, normalized user-facing message.
- `kind`: `auth`, `validation`, `permission`, `not-found`, `conflict`, `network`, or `unexpected`.

Known API messages remain available when they explain a validation or domain rule. Network failures and malformed/unexpected responses use stable fallback copy rather than browser exception text.

The API layer will notify one registered unauthorized handler whenever an authenticated request returns `401`. Public authentication endpoints remain local to the authentication form so invalid credentials do not trigger a session-expired flow.

### Session expiration

`App` owns the unauthorized handler because it owns session state. When notified, it will:

1. Clear access-token and user data from local storage.
2. Close the active list and reset authenticated state.
3. Render the login screen in login mode.
4. Display `Your session expired. Please log in again.` as a persistent alert.

Repeated `401` responses during the same transition must be idempotent. The background refresh-cookie probe must not replace or clear the session-expired message when it also receives `401`.

### Reusable feedback component

A small `ErrorAlert` component will provide consistent markup and styling. It accepts a message plus optional Retry and Dismiss actions. It uses an SVG warning icon, `role="alert"`, readable text, and touch-friendly buttons. It does not steal keyboard focus.

This component standardizes presentation without centralizing page-specific state. Each screen remains responsible for where an error belongs and when it clears.

## Screen Behavior

### Authentication

- Login and registration errors remain below the form.
- Invalid credentials and validation messages remain specific.
- Session expiration opens login mode and displays the session-expired alert.
- Form input remains intact after submission failure.
- A successful login clears all authentication feedback.

### List screen

- Initial load shows a loading state rather than an empty list.
- A failed initial load shows a page-level error with Retry; it must not show `No lists yet`.
- Failed list creation shows an inline error beside the composer and preserves the entered name.
- Successful retry or successful creation clears the relevant error.

### List detail

- A failed initial todo load shows a page-level error with Retry; it must not show `Nothing here yet`.
- Failed todo creation shows an inline composer error and preserves the todo name and priority.
- Failed todo update or autosave shows an alert within that todo row and reloads confirmed server data. The alert remains after the reload so the user understands why their edit reverted.
- Failed deletion leaves the todo visible and shows a row-level error.
- Failed dependency loading, adding, or removal shows an error in that todo's dependency panel. Dependency errors are keyed by todo so one row cannot display another row's failure.
- Collaborator sharing keeps its current specific messages but uses the shared alert presentation.
- Successful repetition of an operation clears that operation's error.

### Real-time connection

- Socket `connect_error` or disconnect events show `Live updates disconnected. Reconnecting…` near the list header using a polite status region.
- Reconnection clears the status.
- A socket authentication error is routed through the same session-expiration path as an API `401`.
- REST functionality remains available while the socket reconnects.

## Message Rules

- `401` authenticated request: `Your session expired. Please log in again.`
- Network failure: `Couldn't connect. Check your connection and try again.`
- `403`: preserve a specific API permission message when present; otherwise `You don't have permission to do that.`
- `404`: preserve a specific domain message when present; otherwise `That item is no longer available.`
- `409`/`422`: preserve domain conflict or validation messages, such as version mismatch or blocked completion.
- Unexpected failure: `Something went wrong. Please try again.`

Messages must not expose stack traces, response bodies, internal route names, or raw JavaScript exceptions.

## State and Concurrency

- Page-load state is explicit: `loading`, `ready`, or `error`.
- Action errors are scoped to the smallest affected region: authentication form, list composer, todo composer, todo row, dependency panel, or collaborator form.
- Async handlers disable their initiating control while pending when repeated submission could duplicate work.
- State updates after unmount are prevented in initial-load effects.
- Error cleanup is deterministic: start of retry clears the prior error; success leaves it cleared; failure replaces it with the latest normalized error.

## Accessibility and Responsive Requirements

- Critical failures use `role="alert"`; connection status uses `role="status"` with `aria-live="polite"`.
- Retry and dismiss controls have visible text or an accessible name, keyboard focus styles, and at least a 44px interaction target.
- Error foreground and background combinations meet WCAG AA contrast.
- Icons are decorative when the adjacent text carries the same meaning and are hidden from assistive technology.
- Alerts wrap without horizontal scrolling at 375px width and do not obscure content at larger text sizes.
- No error animation is required; any added transition must respect `prefers-reduced-motion`.

## Testing Strategy

### API unit tests

- Classify HTTP statuses and preserve safe known messages.
- Normalize network and unexpected failures.
- Invoke the unauthorized handler only for authenticated `401` responses.

### Component tests

- `App`: authenticated `401` clears storage and shows the login session-expired alert.
- `AuthScreen`: local authentication errors remain inline and session-expired mode defaults to login.
- `ListsScreen`: loading, failed load with Retry, successful retry, and failed create with preserved input.
- `ListDetail`: failed load, create, update/autosave rollback, delete, dependency operations, collaborator failure, and reconnect status.
- Assertions use accessible roles and names, not visual class names alone.

### End-to-end coverage

- Start with an invalid stored token, verify automatic sign-out and visible session-expired feedback.
- Force or simulate one authenticated request failure and confirm the relevant contextual alert and recovery action.

## Out of Scope

- Automatic access-token refresh and request replay.
- Offline mutation queues.
- A global toast framework.
- Server-side logging or monitoring changes.
- Redesigning unrelated loading, confirmation, or success interactions.
