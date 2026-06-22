# Collaborator Sharing — Design Spec

**Date:** 2026-06-22
**Project:** SleekTodo

## Objective

Let a list owner add an existing SleekTodo user as an editor from the web UI so two users can exercise the existing presence, locking, and live-update collaboration behavior without calling the API manually.

## Scope

### In scope

- An owner-only sharing form on the list-detail screen.
- A visible email label and email input.
- A single action that grants the `EDITOR` role.
- Loading, success, and actionable error feedback.
- Web client membership types and an `addMember` API helper.
- Component coverage for visibility and submission behavior.
- Browser e2e coverage that adds the second user through the UI before exercising collaboration.

### Out of scope

- Inviting an email address that has not registered.
- Choosing `VIEWER` or `OWNER` from the UI.
- Listing members, changing roles, removing members, or transferring ownership.
- Email notifications or invitation links.

## User Flow

1. Bob registers a SleekTodo account.
2. Alice opens a list she owns.
3. Alice enters Bob's email in the sharing form and selects **Add editor**.
4. The client calls `POST /lists/:id/members` with `{ email, role: "EDITOR" }`.
5. On success, the form clears and confirms that Bob now has access.
6. Bob refreshes the lists screen, opens the shared list, and can participate in the existing real-time collaboration flow.

Non-owners do not see the form. The API remains the authorization authority and continues to reject unauthorized direct requests.

## UI Design

The form sits in the list-detail header near the presence display, where sharing and current collaborators are conceptually related. It uses the existing input, button, error, spacing, and typography styles rather than adding a new visual system.

The email field has a persistent label and `type="email"`. The submit button has a minimum 44px target, is disabled for an empty/invalid submission or while the request is pending, and changes its label to indicate progress. Feedback is rendered next to the form and announced with an appropriate live region.

## Data and Components

- `web/src/types.ts` adds a membership role and membership response type.
- `web/src/api.ts` adds `addMember(token, listId, email, role)`.
- `web/src/ListDetail.tsx` owns the small form state because the feature is local to that screen.
- Owner visibility is derived from the existing `me.id === list.ownerId` contract; no additional read endpoint is needed.

No backend schema or endpoint change is required.

## Error Handling

- `404 User not found`: explain that the collaborator must register first.
- `403`: explain that only the list owner can add collaborators.
- Other failures: show the API message and retain the entered email for retry.
- Duplicate membership: the existing API returns the membership; the UI treats this as successful access rather than failing.

## Testing

### Component tests

- The owner sees the sharing form; a non-owner does not.
- Submitting calls the API with a trimmed email and `EDITOR`.
- Pending submission disables the button and shows progress.
- Success clears the input and displays confirmation.
- A missing user displays registration guidance.

### Browser e2e

Update the existing two-browser collaboration test to:

1. Register Alice and Bob.
2. Create Alice's list.
3. Add Bob through Alice's sharing UI instead of a direct membership API call.
4. Confirm Bob sees and opens the list.
5. Continue the existing lock, presence, and live-update assertions.

## Success Criteria

- A registered second user can be added without terminal/API work.
- The second user can open the shared list and edit collaboratively.
- Unauthorized users cannot access the sharing control or bypass backend authorization.
- Existing todo, realtime, and build checks remain green.
