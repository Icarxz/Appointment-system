# CCIS SYNC — Multiple AI Session Development Rules

**Repository:** `Icarxz/Appointment-system`  
**Purpose:** Prevent multiple AI development sessions from overwriting, conflicting with, or accidentally integrating each other's work.  
**Scope:** Applies to all AI sessions, coding agents, contributors and branches working on CCIS SYNC.

## 0. Owner decisions that override anything below (Nov 20, 2026)

1. **Push first.** Commit, then push, after every working step (`git push -u origin BRANCH`). Unpushed work is lost when a session ends. Work-in-progress commits are allowed (start the message with `WIP:`). Never end a session with unpushed commits.
2. **Merge only when necessary.** The owner now tests on one laptop, so a branch does not need a PR or a merge just to be seen: push it and give the owner `git fetch origin` and `git checkout BRANCH-NAME`. Merge to `main` only when the change must be live on the deployed site, another branch depends on it, a release or demo is near, or the owner says "merge". Where section 7 below says "open a PR", read it as "when a merge is needed".
3. **Ask when unclear or conflicting.** If the request has two readings, or conflicts with how the system works today (inspect `main` first), ask 1 to 3 short multiple-choice questions with a recommended default before building.
4. **Check `main` before building.** Another session may have already built it (for example the role-selection sign-in).

## 1. Core principle

Sessions may investigate and develop in parallel when their work is sufficiently independent. **Integration is sequential and controlled**: merge one PR at a time, verify the integrated state, then proceed.

These rules complement `CCIS_SYNC_BUG_FIXING_ROADMAP.md`. The roadmap defines *what to fix and in what priority*; this document defines *how multiple sessions work safely*.

## 2. Branch and baseline rules

- Each coding task must use its own feature branch. Do not work directly on `main`.
- Before starting, fetch and inspect the current repository state and identify the base commit.
- Unless a task explicitly depends on another unmerged PR, branch from the current `origin/main`.
- If the work depends on another PR, state the dependency and branch from that work only with explicit coordination.
- Do not assume the local `main` is current.
- Do not merge, rebase, force-push, reset, delete branches, or discard changes without the owner's approval where the action is destructive or changes shared history.
- Never let an AI session overwrite another session's uncommitted or committed work to resolve a conflict automatically.

## 3. Session ownership and overlap

Before coding, every session should declare:
- Task and roadmap phase
- Branch name and starting commit
- Files/directories it expects to edit
- Files another session is currently editing (if known)
- Dependencies and tests

Use **file ownership**, not just feature names, to manage overlap. Two features can still conflict if they edit shared models, routes, utilities, authentication middleware, global components, configuration, or schema files.

### Avoid simultaneous editing of:
- Authentication middleware, session/token logic and role definitions
- Shared account/user models and provisioning
- Shared database schemas, migrations and seed data
- Shared appointment/schedule/status models or validation utilities
- Global frontend components, navigation and shared state
- Configuration, package manifests and lockfiles

If overlapping files are unavoidable, agree which session owns the files and pause the other session's edits to those files until the owner finishes or hands them off.

## 4. Parallel-work plan

The phases are dependencies for implementation and integration, not a requirement that every session waits idle. Audit, test design and isolated implementation can often proceed concurrently.

| Workstream | Parallel start? | Conditions / integration notes |
|---|---|---|
| Authentication & User Management (Phase 0) | Start first / underway | Treat auth, user/role, session and provisioning files as owned by this session until handoff |
| Authorization & Data Isolation (Phase 1) | Audit/test planning can run in parallel | Coordinate implementation that touches auth, roles, middleware, shared models or routes with Phase 0 |
| Appointments & Consultation (Phase 2) | Usually yes | Keep ownership of appointment-specific files; coordinate shared auth, models, validation and notification files |
| Schedules, Import & Status (Phase 3) | Usually yes | Keep ownership of schedule/status-specific files; coordinate shared appointment availability, models and OCR utilities |
| Consultation Records & Analytics (Phase 4) | Audit and isolated fixes often yes | Coordinate shared record models, data aggregation, permissions and export utilities |
| UI/UX (Phase 5) | Usually yes | Work on isolated pages; coordinate global components, navigation, shared styles, state and API contracts |

### Recommended parallel arrangement
- **Session A:** Authentication and User Management (current priority)
- **Session B:** Appointment workflow audit/fixes
- **Session C:** Faculty Schedule, PDF import and Status audit/fixes
- **Session D:** Consultation Records and Analytics audit/fixes
- **Session E:** Isolated UI/UX fixes
- **Session F:** Authorization audit and test planning; implementation coordinated with Session A and relevant feature owners

Do not launch all sessions just for the sake of parallelism. Start a workstream only when its task and file scope are clear.

## 5. Dependency rules

- Authentication changes are foundational to permission testing. Authorization audits can start early, but overlapping implementation may need to wait for authentication handoff.
- Appointment and schedule work may proceed in parallel, but availability calculations, shared models, status/notice rules and appointment validation are potential overlap areas.
- Records and analytics may proceed in parallel for isolated work; verify correctness against integrated source data after core workflows are merged.
- UI work can proceed in parallel when it does not change shared components or API contracts another session is editing.
- A session must not silently change the scope, role model, database schema, API contract or business rules. Document the proposed change and obtain approval if it exceeds the assigned task.

## 6. Safe Git workflow (PowerShell)

### Start a task
```powershell
cd C:\Users\chris\Desktop\Appointment-system
git status
git fetch origin
git switch main
git pull origin main
git switch -c fix/<short-task-name>
```

If `main` is not the correct base or the work depends on a PR, stop and follow the agreed dependency instead. If the working tree is not clean, preserve the work before switching branches; do not use destructive commands to clean it.

### Check and preserve work
```powershell
git status
git diff
git diff --stat
```

Stage specific intended files when possible:
```powershell
git add <file-or-folder>
git diff --cached
git status
git commit -m "fix: <describe the change>"
git push -u origin fix/<short-task-name>
```

Do not blindly stage everything (`git add .`) without reviewing the files. Check for accidental changes to lockfiles, generated files, secrets, environment files and unrelated features.

### Testing
Run relevant tests and builds for the change. Record exact commands, pass/fail results and tests not run. A session must not claim tests passed based on another environment or another session's results.

## 7. Pull request and merge sequence

1. Each session finishes its task and opens a PR (or hands off its branch for owner review).
2. Review the changed-file list, diff and task scope.
3. Confirm relevant tests and builds were run.
4. Merge **one PR at a time**, only with owner approval.
5. After each merge, fetch and update `main`, then run integration/regression checks appropriate to the changed area.
6. Update remaining branches with the newly integrated `main` using a safe, agreed method. Resolve conflicts deliberately; do not blindly accept one side.
7. If a PR becomes outdated or conflicts with integrated changes, pause and reconcile before merging.
8. If the integration breaks `main`, stop merging further PRs until it is repaired or reverted.

Do not assume PRs that passed independently will pass together.

## 8. Handoff format

Every session should finish with:

```text
Task / roadmap phase:
Branch:
Starting commit:
Files changed:
Files intentionally not changed:
Dependencies / potential overlap:
Commit(s) and PR:
Tests run (commands and results):
Tests not run:
Known issues / limitations:
Recommended next action:
```

## 9. Coordination message to start a new AI session

```text
Use CCIS_SYNC_BUG_FIXING_ROADMAP.md for task priority and
CCIS_SYNC_AI_SESSION_DEVELOPMENT_RULES.md for collaboration and Git rules.

Assigned task / phase:
Branch:
Base commit:
Files in scope:
Files another session is editing (if known):
Dependencies:

Work only within the assigned scope. Before editing shared files, check
whether another session owns them. Do not merge, overwrite, discard,
or resolve conflicts destructively without approval.

At completion, report the changed files, branch/PR, exact tests and
results, tests not run, risks/overlaps, and next action.
```

## 10. Final safeguard

Parallel sessions are for producing independent work—not for merging changes simultaneously. Protect `main`, review every integration, and keep a tested fallback version.

## 11. Keep the roadmap and these rules current (mandatory for every session)

The two documents are only useful if they match reality. Every session, at the start and the end:

**At the start (before coding)**
1. Read `CCIS_SYNC_BUG_FIXING_ROADMAP.md` (especially sections 13 and 15) and this file.
2. Run `git fetch` and `git log origin/main -15`; list the open branches (`git branch -r --no-merged origin/main`). Compare with section 15 of the roadmap and note anything missing.
3. In the roadmap's **section 13 (progress tracker)**, set your phase to "In progress" with your branch name and one line on the task. If a phase is already marked in progress by another session, do not edit the same files; coordinate first (section 3).

**At the end (before the final push)**
4. Add every fix you made to **section 15 (fix log)** of the roadmap: PR or branch, area, what changed in plain words, and the evidence level (build or tests actually run, browser-tested or not).
5. Update **section 13**: what is done, what is open, what was NOT verified. Do not tick a checklist box or call a phase complete unless the work was actually tested; write "implemented, not tested" instead. Be honest in both directions: do not hide gaps and do not claim a phase is finished because code exists.
6. Record decisions the owner made, and conflicts you found between documents, branches or the code.
7. Fill in the handoff template (section 8) and, if the roadmap or these rules changed, commit them (`docs/` folder) and push, in the same push as your code.

**Where the files live:** keep both documents in the repo under `docs/` (`docs/CCIS_SYNC_BUG_FIXING_ROADMAP.md` and `docs/CCIS_SYNC_AI_SESSION_DEVELOPMENT_RULES.md`) so every session sees the same copy. Edit them only on your own branch, in small commits, and merge `origin/main` into your branch before editing them again, to avoid two sessions overwriting each other's updates. The owner's second file, `CCIS_SYNC_Session_Rules_Redefense.md`, holds the shorter day-to-day rules; if the two ever disagree, section 0 of this file wins.
