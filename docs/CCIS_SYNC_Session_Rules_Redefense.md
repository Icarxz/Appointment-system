# CCIS Sync: How to work in any AI session (redefense in about 2 weeks)

Repo: `Icarxz/Appointment-system`. Works for any AI model or tool (Claude, ChatGPT, Gemini, Copilot...). Paste this file as the FIRST message of every new session. It replaces the defense-day rules ("send the link", "owner merges").

Goal: develop fast, safely and accurately, and never lose work.

## 1. Priority order (when rules conflict, the higher one wins)

1. **Never lose work.** Push to GitHub early and often (section 2).
2. **Do not break what already works.** Login, booking, status, analytics, importer.
3. **Ask when unclear or conflicting** (section 3).
4. **Be accurate and honest** about what was and was not tested (section 6).
5. **Be fast.** Small steps, short messages, no recap of history.

## 2. Push first (prevents losing changes)

- Work on a **feature branch** from the latest `origin/main`. One branch per task. Name it by what it does (`auth-direct-google`), not `wip`.
- **Commit after every working step. Push right after every commit** (`git push -u origin BRANCH`). Push before asking the owner anything, before a long task, and before the session ends. An unpushed commit exists only in that session's temporary machine and is lost when it closes.
- Unfinished work is fine to push: start the commit message with `WIP:`. A pushed WIP branch is safe; a local one is not.
- **Never** `git push --force`, `git reset --hard`, `git stash drop`, or delete branches/PRs without the owner saying so. Do not `git stash pop` blindly (a pop with conflicts left a half-merged file once); check `git status` first and save a copy of any conflicted file.
- At the end of every session, run `git status` and `git log origin/BRANCH..BRANCH`. Both must show nothing left unpushed.
- A warning such as "unpushed commits / no remote branch" in a shallow clone is usually a stale tracking ref: run `git config --add remote.origin.fetch '+refs/heads/X:refs/remotes/origin/X'`, `git fetch origin X`, `git config branch.X.remote origin`, `git config branch.X.merge refs/heads/X` (replace X with the branch name).

## 3. Ask before building (always, when unclear or conflicting)

Ask the owner BEFORE coding when:
- the request is ambiguous (two reasonable readings),
- it conflicts with how the system works today (for example: "both buttons open role selection" vs. what is already on `main`),
- it touches login, the database models, roles or permissions, deployment settings, or deletes data,
- two documents or two earlier decisions disagree.

How to ask: first inspect the real code (a 2-minute read), then ask 1 to 3 short multiple-choice questions, each with a recommended default and the one-line consequence. Do not ask what the code or an earlier decision already answers. If the owner is away, take the safest reading, say which one you took, and keep the change reversible.

## 4. Merging (only when necessary)

The owner now tests on ONE laptop, so a merge is not needed just to "see" a change. Default: **push the branch, do not open or merge a PR.**

The owner tests a branch on the laptop with (Windows PowerShell, no `gh`):
```powershell
cd C:\Users\chris\Desktop\Appointment-system
git restore backend/package-lock.json
git fetch origin
git checkout BRANCH-NAME
```
(use the real branch name, never angle brackets). Back to the stable version: `git checkout main`, `git pull origin main`.

Merge into `main` only when one of these is true:
- the change must be live on the deployed site (Render/Vercel deploy from `main`),
- another branch or session depends on it,
- the owner says "merge",
- a release or demo day is near (see section 9).

When merging: PR base must be `main` (a PR based on another feature branch silently never reaches `main`). Wait for the Vercel check on the PR head to be green. Merge commit, not squash. After the merge, give the owner the pull commands above.

Trap: a branch that is never merged and never mentioned is easy to forget. Keep section 8 (the state file) up to date so every branch is listed.

## 5. Making sessions efficient (saves the owner's tokens)

- **One session = one task.** Start a new session when the task changes. Long sessions get slow, expensive and lose detail.
- **First message of a session:** this file + the state file (section 8) + the task in 1 to 3 sentences + the exact files involved if known. Do not paste whole conversations.
- **Read only what you need.** Use `grep` and line ranges, not whole large files (`FacultyDashboard.tsx`, `AdminDashboard.tsx` and `faculty.js` are huge). Do not paste big outputs back into the chat.
- **Short replies.** Say what changed, risk, what was and was not tested, and the next step. No history recap, no long diffs.
- **Screenshots:** the owner may attach them. Crop to the problem. One screenshot plus one sentence beats a long description.
- **Two sessions must not edit the same file at the same time.** If a task needs a file another session owns, say so and wait, or split the task. Different files can run in parallel; keep a table in the state file of "session, branch, files".
- **Before a new feature, check `main` first** (`git fetch`, `git log origin/main -15`): another session may have already built it (this happened with the role-selection screen).
- At about 90% of the context window, stop new work, push, write a handoff (section 8), and tell the owner first thing: "Context is about 90% full." Do not invent exact percentages.

## 6. Quality gates (before saying "done")

- Backend: `node --check` on every changed file, and `node --test backend/utils/*.test.js`. The only known failure is `notificationModel.test.js` (needs mongoose and a database).
- Frontend: `tsconfig` has `noUnusedLocals`, `noUnusedParameters` and `verbatimModuleSyntax`. Unused imports or variables fail the build; use `import type` for types. Many sessions cannot run `npm run build`, so the **Vercel preview check on the branch/PR is the real build test**. Say so.
- Search changed files for leftover conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`). One committed marker in `backend/routes/faculty.js` crashed the backend.
- New logic gets a test when it can be tested without a database (pure functions in `backend/utils`).
- **Be honest.** Never claim "tested", "passed" or "works" unless it was actually run. Write "Not checked: browser, real database, frontend build" when that is the case.
- Never `npm audit fix --force`.

## 7. Security and project rules (always)

- Never put keys, passwords or tokens in chat, files or the repo. Secrets live only in Render/Vercel environment variables and the local `backend/.env` / `frontend/.env`.
- Role decisions are made ONLY by the backend, from database records (roster, `ADMIN_EMAILS`, the user's stored role and `accountStatus`). The browser's choice never assigns a role. Never guess a role from the email pattern.
- Wording rule: never write "live status". Use Status, My Status, Scheduled, Set by me.
- Faculty program: `User.program` is a single string today; changing it to 1 to 3 programs is a planned, not yet approved, change.
- Commit messages end with the attribution the tool requires (for Claude: `Co-Authored-By: ...` and `Claude-Session: ...`).
- PowerShell: explain git steps for a student; never send commands containing `<placeholder>` in angle brackets (PowerShell reads them as a syntax error).
- When pointing at code: give the file path, the quoted lines, and a corrected version.

## 8. The state file and handoffs (so a new session starts fast)

Keep ONE file in the repo, `docs/PROJECT_STATE.md` (created by the first session that has time), with:
- where `main` is (short hash) and which branches exist, with one line each (task, done / in progress, safe to delete?),
- decisions the owner made (so nobody asks twice),
- known problems and what was NOT verified,
- the next step, as commands or one clear instruction.

Every session updates it as its last commit and pushes it. At 90% context, write `HANDOFF_<topic>_<time>.md` with the same sections plus "traps hit", send it to the owner, and push it.

## 9. Redefense plan (about 2 weeks)

- **Freeze:** pick a date (about 3 days before) after which only bug fixes and wording are allowed.
- **Tag a known-good version:** `git tag redefense-ok` on a `main` commit that was tested end to end, and note its hash. If something breaks, `git checkout redefense-ok` is the fallback.
- **Backup:** keep a second copy of the repo (zip of the folder, or a `git bundle`) on a USB drive or cloud storage, plus the real `.env` values stored privately (never in the repo).
- **Demo environment:** decide now whether the redefense runs on the laptop or on the deployed site. If deployed, merges to `main` and the Render/Vercel settings matter; if laptop only, section 4 applies fully. Note that hosted OCR (PDF import) does not work; demo it on the laptop.
- **Rehearse:** one full run-through per role (Student, Faculty, Dean, Admin) on the exact machine used for the defense, including a fresh `git pull`, `npm install`, and starting both servers.
- **Seed data:** keep demo accounts and sample data ready, and write down who they are.

## 10. Quick session checklist

1. `git fetch`, check `git status`, branch from `origin/main`.
2. Read this file and the state file. Look at `git log origin/main -15`.
3. Ask the owner if anything is unclear or conflicting (section 3).
4. Build in small steps: commit, then push.
5. Run the gates (section 6). Search for conflict markers.
6. Report: what changed, risk, tested / not tested, how to try it (branch name + commands), next step.
7. Update the state file, push, confirm nothing is unpushed.
