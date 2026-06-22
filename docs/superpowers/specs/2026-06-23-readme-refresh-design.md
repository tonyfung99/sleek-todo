# README Refresh Design

## Goal

Make the project README accurately describe the current application, provide a direct setup and collaboration path, and state the verified limitations that matter before a production deployment.

## Audience

The README serves two audiences:

- A developer evaluating or running SleekTodo locally.
- A maintainer deciding what must be hardened before exposing it to real users.

It is not a complete architecture specification or deployment runbook. Detailed design history remains under `docs/superpowers/`.

## Structure

Retain the existing concise project introduction, feature overview, stack, prerequisites, Docker quick start, local development, testing, project structure, and useful commands. Reorder or tighten wording only where it removes duplication or stale information.

### Current collaboration flow

Replace the obsolete statement that collaborator sharing has no UI and requires a direct API call. The documented flow will be:

1. Alice and Bob register accounts.
2. Alice creates and opens a list.
3. Alice enters Bob's registered email in the Collaborator email field and selects Add editor.
4. Bob opens the shared list from a second browser or incognito window.
5. The two users verify presence, edit locking, and live todo updates.

The README will explain that the invited email must already belong to a registered account. It will not retain the `curl` workaround because that is no longer the primary user workflow.

### Current limitations and production considerations

Add one explicit section separating implemented security controls from missing production safeguards. It will state:

- Registration accepts an email address without proving ownership; email verification is not implemented.
- Password reset and account recovery are not implemented.
- Authentication endpoints do not currently have rate limiting or brute-force protection.
- The Compose JWT secret and HTTP endpoints are development defaults, not production configuration.
- A production deployment must supply strong managed secrets, TLS/HTTPS, a restricted CORS origin, database backup/restore procedures, and monitoring/alerting.

The wording will describe current behavior without implying a vulnerability has been remediated. It will not provide speculative delivery dates or claim production readiness.

## Accuracy Rules

- Commands must match scripts in the current package files.
- Default ports must match `docker-compose.yml`.
- Feature claims must be backed by current UI/API behavior.
- Development secrets must be clearly labeled as local-only.
- The README must not expose real credentials or recommend bypassing the UI for normal collaboration.
- Existing links to design documentation remain relative and valid.

## Validation

- Compare every command with `package.json`, `api/package.json`, `web/package.json`, and `docker-compose.yml`.
- Search the finished README for stale phrases such as `no share form`, collaborator API `curl`, or claims of email verification.
- Check Markdown structure and fenced code blocks manually.
- Run `git diff --check`.

## Out of Scope

- Implementing email verification, password reset, rate limiting, TLS termination, backups, or monitoring.
- Creating a separate security policy or deployment guide.
- Changing application code, Compose behavior, or CI.
- Rewriting historical design documents.
