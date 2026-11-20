# CCIS SYNC — Bug-Fixing and Stabilization Roadmap

**Repository:** `Icarxz/Appointment-system`  
**Current scope:** Stabilize the single-department (CCIS) system before considering multi-department expansion.  
**Purpose:** Shared repair order, severity definitions, dependencies, and test gates for development sessions.  
**Priority principle:** Fix risk and dependencies first—not simply the hardest or easiest issues.  
**Last updated:** Sat Nov 21, 2026 (by the session that built the Nov 14-21 fixes). `main` was at `9d8efe7` (PR #103). Every session must update sections 13 and 15 before it finishes (see `CCIS_SYNC_AI_SESSION_DEVELOPMENT_RULES.md`, section 11).

## 1. Overall strategy

1. Finish the ongoing **Authentication and User Management** work.
2. Verify **authorization and data isolation** after authentication changes settle.
3. Stabilize **Appointments and Consultation** workflows.
4. Stabilize **Faculty Schedules, Schedule Import, and Status**.
5. Verify **Consultation Records and Analytics**.
6. Address usability, responsiveness, and cosmetic issues.
7. Run end-to-end regression testing, freeze the redefense build, and back it up.
8. Only after the single-department version is stable, plan multi-department expansion.

Do not expand to multiple departments during this roadmap unless the owner explicitly changes the scope.

## 2. Severity levels

| Severity | Meaning | Response |
|---|---|---|
| **Critical (P0)** | Authentication bypass, unauthorized access/data exposure, data loss/corruption, or core workflow unusable | Stop lower-priority work; investigate and fix first |
| **High (P1)** | Core workflow broken or incorrect (booking, schedule, status, consultation logging) | Fix before release/redefense |
| **Medium (P2)** | Important functionality unreliable, confusing, or partially broken, but workaround exists | Fix after P0/P1 |
| **Low (P3)** | Cosmetic, wording, minor layout or convenience issue | Fix during polish if time permits |

Severity is based on impact, not difficulty.

## 3. Phase 0 — Authentication and User Management

**Priority:** Critical / foundational  
**Status:** Already being worked on in a separate session. Continue there and avoid parallel edits to the same authentication/account files.

### Review and test
- [ ] Student login and logout
- [ ] Faculty login and logout
- [ ] Dean login and logout
- [ ] Admin login and logout
- [ ] Google authentication flow (where enabled)
- [ ] Authentication errors and recovery behavior
- [ ] Account provisioning and account status
- [ ] Role assignment and role verification
- [ ] Prevent users from gaining a role through client-side input or email assumptions
- [ ] Restricted, inactive, or unapproved account handling, as applicable
- [ ] Session/token handling and logout behavior
- [ ] Provisioned accounts can sign in as intended
- [ ] Role selection in the UI cannot assign a role by itself

### Status as of Nov 21, 2026: NOT complete (honest assessment)

**What is true today (checked in code):**
- The backend already decides the role from its own records: an existing `User` (stored role and `accountStatus`), the `RosterEntry` list, and `ADMIN_EMAILS`. The browser's choice never assigns a role. A new school email with no record becomes a STUDENT. No role is guessed from the email pattern. (`backend/routes/auth.js`, `backend/utils/signInPolicy.js`)
- The audience mismatch check exists on the server (`audienceMismatch`, audiences `STUDENT` / `STAFF`).
- ARCHIVED and RESTRICTED accounts are denied at sign-in and on every protected route (`BLOCKED_STATUSES` in `backend/middleware/auth.js`).

**Done on `main` by other sessions (not re-verified by this session):** PR #96 (choose Student or Faculty first, then Google) and PR #99 (Log in goes straight to Google; role choice only on Sign up). On `main` the Faculty screen under Sign up shows only the administrator message and has no Google button.

**Done on branch `auth-direct-google` (pushed, NOT merged, NOT browser-tested):** Log in and Sign up both go straight to Google with no role choice (owner decision, Nov 20), the "Faculty Account Assistance" message shows on both, and `PENDING_APPROVAL` accounts are now denied at Google sign-in (new unit test; 341 backend tests pass, only the known `notificationModel` failure). This replaces the #96/#99 role-selection screens, so it needs the owner's merge decision.

**Not done / still open:**
- [ ] Browser test of login and logout for all four roles, including a real Google sign-in.
- [ ] Review of session/token handling and logout behavior.
- [ ] Decision: with no role choice, an unprovisioned faculty member who signs in with a school Google account silently becomes a Student account. Options: accept it (the assistance message is the only guard), or add an Admin-visible "unprovisioned staff" list.
- [ ] Merge `auth-direct-google` (or drop it) and tag the result once tested.
- [ ] "Automatic role detection from the database" is described by the owner as coming later; the current detection (roster / existing record / ADMIN_EMAILS) is what exists today.

Do not mark the Phase 0 gate complete until the browser test and the merge decision are done.

### Gate
- [ ] Authentication tests pass
- [ ] Frontend build/preview verified where available
- [ ] Login/account behavior tested in the browser for all four roles
- [ ] Changes committed and pushed
- [ ] Handoff identifies files changed and remaining issues

**Dependency:** Phase 1 authorization tests should be performed against the settled authentication/role implementation.

## 4. Phase 1 — Authorization, Permissions, and Data Isolation

**Priority:** Critical  
**Dependency:** Phase 0

Authentication answers who the user is. Authorization determines what they can do.

### Review and test
- [ ] Backend is the authority for role and permission decisions
- [ ] Student accesses only permitted appointments and records
- [ ] Faculty accesses and modifies only their permitted data
- [ ] Faculty schedule edit routes enforce ownership, including direct API requests
- [ ] Dean access is restricted to the intended scope and operations
- [ ] Admin access follows intended administrator permissions
- [ ] Protected endpoints reject unauthorized requests
- [ ] Changing IDs in requests cannot bypass permissions
- [ ] Program/department restrictions, where applicable, are enforced server-side
- [ ] Sensitive information does not leak through API responses, errors, or exports
- [ ] Review access control on status, schedules, appointments, consultation records and account management

### Status note (Nov 21)
- PR #103 lets FACULTY call `POST /api/faculty/schedule/add`, `PUT` and `DELETE /api/faculty/schedule/:id`; a Faculty member is limited to their own classes (403 otherwise; add ignores any `facultyId` in the body). Implemented and unit-checked only; **never tested against a real database or with direct API requests**. This is the first item to verify in this phase.
- The audit of other routes has not been done.

### Gate
- [ ] Permission tests pass for all four roles
- [ ] Direct API access tests performed for representative forbidden actions
- [ ] No known Critical permission/data-isolation issue remains

## 5. Phase 2 — Appointments and Consultation Workflows

**Priority:** High  
**Dependency:** Phases 0 and 1

### Booking
- [ ] Students see and book only valid appointment slots
- [ ] Slot validation occurs on the backend
- [ ] Duplicate bookings and conflicts are prevented
- [ ] Faculty schedule and consultation hours correctly constrain slots
- [ ] Meeting and leave notices block applicable new booking slots
- [ ] Existing appointments follow the agreed policy
- [ ] Cancellation and rescheduling behavior is correct
- [ ] Appointment state transitions are validated server-side

### Approval and states
- [ ] Faculty approval/rejection works
- [ ] Student and faculty see consistent appointment state
- [ ] Pending, Approved, Rejected, Completed and other existing states are consistent
- [ ] Invalid state changes are rejected
- [ ] Notifications, if applicable, do not incorrectly alter state

### Missed consultations and consultation logging
- [ ] Missed consultations cannot be saved to the Consultation Log (per merged PR #102)
- [ ] Missed items are removed from the applicable Pending consultations list
- [ ] Upcoming consultations display the expected disabled/greyed control
- [ ] Previously saved consultation entries remain intact
- [ ] Consultation-log validation and save behavior are correct
- [ ] Duplicate or invalid consultation-log entries are prevented

### Status note (Nov 21)
Implemented and merged, not browser-verified by the building session: PR #101 (30-minute grace before Missed, reason required, Missed by Faculty reported by a student, 24-hour correction, atomic status changes, "Did this take place?" reminder) and PR #102 (Pending consultations show the time and an Upcoming badge, Complete & Save is blocked before the start time on the server too, missed consultations cannot be saved).
**Conflict to resolve:** PR #101 still allowed a missed consultation to be corrected by signing it off within 24 hours; PR #102 (owner request, Nov 19) removed that, so the 24-hour correction no longer works and the "Did this take place?" / "you can correct it" wording may be stale. Check the notification texts and the student-facing wording.

### Gate
- [ ] Student booking tested from slot selection through confirmation
- [ ] Faculty appointment workflow tested
- [ ] Missed consultation and consultation-log cases tested
- [ ] No known Critical/High appointment issue remains

## 6. Phase 3 — Faculty Schedules, Schedule Import, and Status

**Priority:** High  
**Dependency:** Phases 0 and 1; coordinate with ongoing schedule/status work.

### Master Schedule and editing
- [ ] Faculty Master Schedule loads
- [ ] Weekly View and Edit Schedule tabs behave correctly, where implemented
- [ ] Faculty add, edit and delete only their own classes
- [ ] Backend ownership enforcement verified
- [ ] Admin schedule management remains functional
- [ ] Dean access remains as intended
- [ ] Schedule changes persist and are reflected in weekly view
- [ ] Class time conflicts and validation work

### Schedule PDF import
- [ ] PDF upload validation
- [ ] OCR/extraction behavior
- [ ] Extracted class details reviewed before applying, where applicable
- [ ] Import errors handled without corrupting existing data
- [ ] Temporary OCR folders are cleaned up
- [ ] Windows cleanup behavior tested on the owner's machine if tests depend on Windows temp-directory cleanup
- [ ] Import behavior tested on the intended local machine (document hosted OCR limitations, if applicable)

### Faculty Status and Notices
- [ ] Automatic status uses class schedule, consultation hours and running accepted consultations as intended
- [ ] Manual status precedence and expiry are correct
- [ ] Faculty can clear manual status early as intended
- [ ] Meeting and leave notices behave correctly
- [ ] Meeting/leave booking blocks are enforced
- [ ] Notice cancellation works
- [ ] Vacant and outside-schedule (`--`) behavior is correct
- [ ] Day boundaries consider both classes and consultation-hours blocks
- [ ] Status is consistent across Faculty, Student, Dean and Admin views
- [ ] Prohibited or removed status terminology is not reintroduced

### Status note (Nov 21)
- Faculty Status was rebuilt as a computed status (PRs #81, #84-#87, #89): precedence manual > In Consultation > In Class > Consultation Hours > Vacant; `OFF_SCHEDULE` shows `--`.
- Faculty Master Schedule has the Weekly view and Edit Schedule tabs, with Import Schedule PDF in the Edit Schedule tab (PR #103). Merged; not tested with a real database.
- Schedule PDF import: single and bulk importers merged (#60-#65, #68, #70, #80); the Windows temp-folder cleanup fix is in PR #88. OCR runs only on the owner's laptop; the hosted site returns 503 `OCR_UNAVAILABLE`.

### Gate
- [ ] Schedule editing verified
- [ ] PDF import verified on intended demo machine
- [ ] Status edge cases verified
- [ ] Student, Faculty, Dean and Admin displays agree
- [ ] No known Critical/High schedule or status issue remains

## 7. Phase 4 — Consultation Records and Analytics

**Priority:** Medium to High (raise to High if data or core reporting is incorrect)  
**Dependency:** Phases 0–3

### Consultation records
- [ ] Saved records load correctly
- [ ] Records accessible only to authorized roles
- [ ] Editable-table behavior is correct, where applicable
- [ ] Print/PDF layout works
- [ ] Form validation is correct
- [ ] Fields and dropdowns match approved form design
- [ ] Records are not duplicated or lost during save/update

### Analytics
- [ ] Analytics use correct underlying data
- [ ] Filters work
- [ ] Date ranges and counts are accurate
- [ ] Role-specific analytics access is correct
- [ ] Charts and tables agree with source records
- [ ] Empty states and incomplete data are handled correctly
- [ ] Export/print behavior works, if applicable

### Gate
- [ ] Sample analytics reconciled against source records
- [ ] Consultation record creation, edit and retrieval verified
- [ ] No known High data-accuracy issue remains

## 8. Phase 5 — UI/UX, Accessibility, and Minor Issues

**Priority:** Medium / Low

- [ ] Consistent terminology and labels
- [ ] Consistent visual styles and colors
- [ ] Responsive layouts on desktop and mobile
- [ ] Tables, filters, dropdowns and navigation are usable
- [ ] Loading, empty, success and error states
- [ ] Buttons and links are not misleading or inert without explanation
- [ ] Form validation messages are understandable
- [ ] Print layouts are readable
- [ ] Accessibility basics: keyboard use, contrast, labels and focus

Do not delay a critical workflow fix for cosmetic work. UI problems that block core tasks should be raised to High severity.

## 9. Multiple AI sessions and parallel work

Detailed collaboration, file-ownership, branch, Git, PR integration, and handoff rules are maintained in the companion document:

**`CCIS_SYNC_AI_SESSION_DEVELOPMENT_RULES.md`**

Use both documents together:
- This roadmap defines **what to fix, severity, phase priority, and test gates**.
- The AI Session Development Rules document defines **how sessions work in parallel, protect files, use Git branches, hand off work, and integrate PRs**.

### Suggested workstreams

| Session | Work | Concurrency |
|---|---|---|
| A | Authentication and User Management (Phase 0) | Current priority; protect auth/account files |
| B | Appointment and consultation workflow (Phase 2) | Can investigate/fix isolated work in parallel; coordinate shared models/routes |
| C | Faculty schedules, PDF import and status (Phase 3) | Can work in parallel; coordinate shared availability, status and schedule files |
| D | Consultation records and analytics (Phase 4) | Audit and isolated work can proceed in parallel; verify against integrated data |
| E | UI/UX and polish (Phase 5) | Can work on isolated pages; avoid shared components another session owns |
| F | Authorization audit and test planning (Phase 1) | Audit can begin early; implementation overlapping with auth/role files must coordinate with A |

The phases are dependencies for safe implementation and integration—not a requirement that every session waits idle. Merge one PR at a time, verify the integrated `main`, then proceed.

## 10. Regression testing before redefense

Rehearse end-to-end on the exact laptop and environment intended for the redefense.

### Student
- [ ] Login
- [ ] View faculty and statuses
- [ ] View available slots
- [ ] Book consultation
- [ ] Verify appointment state
- [ ] View notices
- [ ] Complete relevant consultation workflow

### Faculty
- [ ] Login
- [ ] Master Schedule / Weekly View
- [ ] Edit Schedule
- [ ] Add/edit/delete class
- [ ] Import schedule PDF (on intended local machine)
- [ ] My Status and manual statuses
- [ ] Post and cancel meeting/leave notice
- [ ] Approve/reject appointment
- [ ] Consultation log
- [ ] Review records and relevant analytics

### Dean
- [ ] Login
- [ ] View permitted faculty, appointments, records and analytics
- [ ] Confirm intended restrictions
- [ ] Verify no unintended schedule-edit controls

### Admin
- [ ] Login
- [ ] Provision/manage accounts
- [ ] Class Schedules
- [ ] Faculty/student management
- [ ] Appointments and consultation records
- [ ] Analytics
- [ ] Verify permissions and data behavior

### System-wide
- [ ] Backend tests
- [ ] Frontend build / Vercel preview
- [ ] API permission checks
- [ ] Database behavior
- [ ] Browser testing
- [ ] Mobile-width testing of critical screens
- [ ] Confirm no secrets or unintended files in Git
- [ ] Check Git status and unpushed commits

## 11. Redefense freeze, backup and fallback

1. Set a freeze date approximately three days before the redefense. After freeze, allow only critical bug fixes and wording changes.
2. Tag a known-good, fully tested `main` commit (for example, `redefense-ok`) and record its hash.
3. Keep a separate repository backup (ZIP or Git bundle) on USB or other safe storage.
4. Store environment values securely outside the repository.
5. Decide whether the demonstration will use the laptop or deployed site.
6. Rehearse all four roles on the actual demonstration machine.
7. Prepare demo accounts and seed data.

### Example tag commands (only after approval and full verification)

```powershell
git fetch origin
git checkout main
git pull origin main
git tag redefense-ok
git push origin redefense-ok
```

Do not tag an unverified commit as the fallback.

## 12. Multi-department expansion is later

Do not expand to multiple departments as part of stabilization unless the owner explicitly changes scope.

After the single-department CCIS version is stable, assess and plan:
- Department identity and management
- Faculty/student department associations
- Dean and Program Head scopes
- Department-level data isolation
- Appointment and schedule filtering
- Consultation records and analytics scope
- Account provisioning
- Data migration and legacy CCIS assumptions
- Pilot onboarding of one additional department

Avoid introducing unnecessary hardcoded department assumptions during current fixes, but do not implement multi-department functionality prematurely.

## 13. Progress tracker

Update this section as work is completed. Only mark tasks complete after verification.

| Phase | Status | Notes / branch / verification |
|---|---|---|
| Phase 0 — Authentication and User Management | **In progress, NOT complete** (Nov 21) | Backend role-from-database logic already existed. Branch `auth-direct-google` (pushed, unmerged) = direct Google for both buttons + PENDING_APPROVAL block. Open: four-role browser test, token/logout review, unprovisioned-faculty decision, merge decision. See the Phase 0 status note. |
| Phase 1 — Authorization and Data Isolation | In progress, early (Nov 21) | Faculty-own-schedule rule added in PR #103, not tested by direct API request. Full route audit not started. |
| Phase 2 — Appointments and Consultation | Partly implemented, unverified | PRs #101, #102 merged. Needs the booking-to-log walkthrough and the stale "correct a missed one" wording check. |
| Phase 3 — Schedules, Import and Status | Largely implemented, unverified | Status rebuild (#81-#89), schedule tabs (#103), importers (#60-#65, #68, #70, #80, #88). Needs the demo-machine test. |
| Phase 4 — Records and Analytics | Partly implemented, unverified | Analytics redesign (#78), Consultation Log tabs (#94). Reconciliation against source records not done. |
| Phase 5 — UI/UX and Minor Issues | Ongoing, small items | Wording (#97, #98, #100), dropdowns (#73, #76, #77, #79), student default Program (#95), loading/offline states (#72). |
| Regression rehearsal | Pending | |
| Freeze and backup | Pending | Tag `redefense-ok` only after a full tested run. |

## 14. Session handoff template

Copy into a new session along with this roadmap and the project state file, when available.

```text
Use CCIS_SYNC_BUG_FIXING_ROADMAP.md for priority/testing and CCIS_SYNC_AI_SESSION_DEVELOPMENT_RULES.md for parallel work and Git coordination.

Current phase/task:
Branch:
Starting commit:
Files in scope:
Files another session is currently editing:

Goal (specific and bounded):

Do not:
- edit files owned by another session,
- merge without approval,
- change scope or database/role behavior without clarifying,
- claim tests passed unless actually run.

At completion report:
- files changed,
- commit(s) and pushed branch,
- tests actually run and results,
- tests not run,
- remaining issues,
- next step.
```

**Release principle:** The redefense version should be reliable, secure and demonstrable. Stabilize the current CCIS scope before expanding it.

## 15. Fix log (what has been built and merged; update after every merge)

Evidence level: **Vercel** = the Vercel preview build of the PR passed; **tests** = `node --test backend/utils/*.test.js` passed (the known `notificationModel.test.js` failure excluded); **not browser-tested** = nobody has clicked it through yet unless the row says so. Items marked *(other session)* were merged by other sessions and were not re-verified by the session that wrote this log.

| PR | Area | What changed | Evidence |
|---|---|---|---|
| #66 | Deployment | `docs/DEPLOYMENT.md`, `frontend/vercel.json` SPA rewrite | Vercel |
| #69 | Email | Brevo HTTP email API (SMTP ports are blocked on Render); `npm run check-email` | tests; a real test mail reached an inbox from the laptop |
| #68, #70 | Schedule import | OCR reader for more PDF layouts (Silva, then a general layout-adaptive reader) | tests; owner's laptop |
| #71 | Admin | Provision Account: Room / Office removed | Vercel |
| #72 | UI | Loading spinner, in-app offline page, offline fallback | Vercel |
| #73, #76, #77 | UI | Dropdown fixes (overlap, searchable selects, dark-mode colours), gender and program filters, analytics Program / Year filters; #76 re-did the stacked #74 | Vercel |
| #78 | Analytics | Pending / submitted / other buckets, created-by-week series, KPI tiles, single Missed and Cancelled slices | tests, Vercel |
| #79 | Accounts | Gender optional (Male / Female), faculty Program field and filter | tests, Vercel |
| #80 | Admin | Bulk faculty schedule PDF importer | Vercel; laptop only (OCR) |
| #88 | Tests / OCR | Fix: OCR runner tests failed on Windows because of a shared temp folder | tests; reproduced and fixed |
| #93 | Backend | **Fix:** committed merge-conflict markers in `backend/routes/faculty.js` crashed the backend on `main` | `node --check`, tests |
| #94 | Faculty | Consultation Log tabs: Pending consultations / Saved consultations; wording "Late" | Vercel |
| #95 | Student | Faculty Status and Consultation start on the student's own Program (typing a name searches all programs) | Vercel |
| #102 | Faculty | Consultation Log: time shown, Upcoming badge, no save before start (also enforced on the server), missed consultations cannot be saved | tests (new `hasStarted` test), Vercel |
| #103 | Faculty | Master Schedule tabs Weekly view / Edit Schedule; Import Schedule PDF moved there; FACULTY may edit only their own classes (server-enforced) | tests, Vercel; **not tested with a database** |
| #81, #83-#87, #89 | Status *(other session)* | Computed Faculty Status, Program and Employment type on profile, My Status card, Post a Notice, status views for Student / Dean / Admin, status cleanup | merged |
| #90-#92 | Dean *(other session)* | Dean consultations: reasons to students, consultable Dean, hours rule, settings | merged |
| #96, #99 | Sign-in *(other session)* | Student / Faculty screens first, then Log in direct to Google | merged |
| #97, #98, #100 | Wording *(other session)* | "appointment" / "Consultation" wording; Missed by Student / Missed by Faculty | merged |
| #101 | Appointments *(other session)* | Missed grace period and reasons, Missed by Faculty report, atomic status changes, outcome reminder | merged |

**Not merged:** branch `auth-direct-google` (see Phase 0). Branches without a PR are not on `main`; list them in the project state file.

**Known problems still open:** hosted OCR unavailable by design; Vercel `VITE_API_URL` and a live Render email test were never re-verified by a session; `docs/importer-status.md` (second OCR template) and `docs/DEPLOYMENT.md` (Brevo live, `VITE_API_URL`) are not updated; faculty "1 to 3 programs" is planned but not approved or built (`User.program` is one string).
