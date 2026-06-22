# README Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the README to match the current collaborator UI and disclose verified production-readiness limitations.

**Architecture:** Keep one concise root README as the project entry point. Correct stale user-flow text in place, add a factual production-considerations section, and validate every command and claim against repository configuration.

**Tech Stack:** Markdown, Docker Compose, pnpm workspace scripts.

---

### Task 1: Refresh README behavior and production guidance

**Files:**
- Modify: `README.md`
- Reference: `docker-compose.yml`
- Reference: `package.json`
- Reference: `api/package.json`
- Reference: `web/package.json`
- Reference: `api/src/auth/auth.controller.ts`

- [ ] **Step 1: Run documentation assertions and verify RED**

Run:

```bash
rg -n "no share form in the UI yet|curl -X POST.*lists/<LIST_ID>/members" README.md
rg -n "Current limitations and production considerations" README.md
```

Expected: the first command finds obsolete collaborator instructions; the second exits 1 because the production-considerations section does not exist.

- [ ] **Step 2: Replace the collaborator walkthrough**

Replace the existing `Try real-time collaboration` steps with this current UI flow:

```markdown
## Try real-time collaboration

1. Register **Alice** in one browser and create a list.
2. Register **Bob** in a second browser or incognito window.
3. As Alice, open the list, enter Bob's registered email in **Collaborator email**, and select **Add editor**.
4. As Bob, open the shared list from **My lists**.
5. Edit a todo as Alice → Bob sees the lock badge, the row goes read-only, and the text updates live. Complete a recurring todo → the next occurrence appears for both.

The collaborator must already have a SleekTodo account before the list owner can add them.
```

Delete the obsolete membership `curl` example and the claim that no share form exists.

- [ ] **Step 3: Add the production-considerations section**

Insert this section after the collaboration walkthrough and before Testing:

```markdown
## Current limitations and production considerations

SleekTodo is configured for local development and demonstration. Before exposing it to real users, account for these current limitations:

- **Email ownership is not verified.** Registration accepts an email address without sending a verification link or proving that the user controls the address.
- **Password recovery is not implemented.** There is no forgot-password or account-recovery flow.
- **Authentication is not rate-limited.** Registration and login endpoints do not yet include brute-force or abuse protection.
- **Compose defaults are development-only.** The checked-in JWT secret and plain HTTP endpoints must not be used for a production deployment.
- **Production operations remain the deployer's responsibility.** Use managed secrets, TLS/HTTPS, a restricted `CORS_ORIGIN`, database backup and restore procedures, and monitoring with alerting.

These are documented gaps, not implemented safeguards or a claim of production readiness.
```

- [ ] **Step 4: Tighten stale or duplicated wording**

Read the full README once. Keep the existing introduction, feature list, prerequisites, Docker quick start, local development commands, testing commands, project structure, and useful commands. Correct only statements contradicted by current code. Do not add badges, screenshots, deployment-provider instructions, security promises, roadmap dates, or new files.

- [ ] **Step 5: Validate accuracy and Markdown**

Run:

```bash
! rg -n "no share form in the UI yet|curl -X POST.*lists/<LIST_ID>/members" README.md
rg -n "Collaborator email|Add editor|Current limitations and production considerations|Email ownership is not verified|Authentication is not rate-limited" README.md
docker compose config --quiet
git diff --check
```

Expected: stale phrases are absent; all new factual headings/phrases are present; Compose config validates; diff check exits 0.

Manually compare commands with scripts in `package.json`, `api/package.json`, and `web/package.json`. Confirm default ports remain API `3000`, web `5173`, Postgres `5432`, and Redis `6379` per `docker-compose.yml`.

- [ ] **Step 6: Commit the README refresh**

```bash
git add README.md
git commit -m "docs: refresh setup and production considerations"
```
