# CCIS Sync: Provisioning Plan (pre-made accounts only)

Status: **PLAN ONLY. Nothing here is built.** Written Sun Nov 22, 2026 for the redefense in about 2 weeks. Repo: `Icarxz/Appointment-system`. Read `CCIS_SYNC_BUG_FIXING_ROADMAP.md` and `CCIS_SYNC_AI_SESSION_DEVELOPMENT_RULES.md` first; update both when work on this plan starts and finishes.

## 1. What the owner wants (decisions made Nov 22)

1. **Every account is created by the Admin first** ("pre-active" account with the person's details). A person who signs in with Google and has **no account record is blocked**. Nobody creates their own account any more, students included.
2. **Remove the Sign up button.** One **Log in** button for everyone.
3. In the Admin **Provision Account** page:
   - an **Excel reader** to add many accounts from a file (.xlsx and .csv, using a maintained library: ExcelJS, **not** SheetJS from npm, which has unpatched security advisories);
   - a **tab for disabled accounts**;
   - **provision students** (today only faculty and Dean);
   - a **Faculty ID / School ID for every provisioned account** (required).
4. Build it in **three stages**, each on its own branch, tested before the next one starts.

## 2. How it works today (checked in code, Nov 22)

- **Sign-in** (`backend/routes/auth.js`, `backend/utils/signInPolicy.js`): Google verifies the person; `decideSignIn` looks for an existing `User`. If none exists and the email is on `ADMIN_EMAILS` or in the `RosterEntry` list, the account is created with that role; **otherwise a STUDENT account is created automatically** (this is what must stop). Archived and restricted accounts are denied. `audience` `LOGIN` (Log in) already refuses to create a student; Sign up > Student creates one.
- **Student first sign-in:** the account is created with `onboardingComplete: false`. The onboarding form then asks for Privacy Policy acceptance, optional gender, program / year / section and the School ID (format `2025-S00001` or `2025-1234-A`). Faculty and Dean give position, program and Employee ID (format `2025S-00001`).
- **Provision Account** (`POST /api/faculty/add`, Admin page "Provision Account"): creates a Faculty or Dean account one at a time (name, email, position, role, optional program). It does not collect an ID (the person gives it at first sign-in) and cannot create students.
- **Disable / Enable:** `PATCH /api/faculty/users/:id/status` (Admin) switches `accountStatus` between `ACTIVE` and `RESTRICTED`, from the Faculty and Students tabs. There is no list of only the disabled accounts. Other statuses: `ARCHIVED`, `PENDING_APPROVAL` (old; denied at sign-in).
- **IDs:** validators in `backend/utils/idValidator.js`; unique sparse fields `schoolId` and `facultyId`; `noIdYet` marks older accounts without an ID.
- **No spreadsheet library** in `backend/package.json` or `frontend/package.json`.
- **`RosterEntry`** (email + role FACULTY / DEAN / ADMIN) is read at sign-in but has **no Admin screen**. This plan makes the `User` record the single source of truth and leaves `RosterEntry` working but unused (do not delete it in these stages).

## 3. Target behavior

| Situation | Result |
|---|---|
| Admin provisions a student or faculty member (form or Excel) | An ACTIVE account exists with name, school email, role, ID and (student) program / year / section or (faculty) position. |
| That person logs in with Google (school domain) | The server finds the record, links the Google identity on first sign-in, and signs them in by the stored role. |
| A school Google account with no record | **Blocked.** Message: "No account was found for this email. Please contact the System Administrator to create your account." Nothing is created. |
| A disabled account | Blocked (as today), shown in the new Disabled tab with an Enable button. |
| Email on `ADMIN_EMAILS` | Still creates / promotes the Admin (this is how the first Admin gets in). |
| First sign-in of a pre-made account | Still asks to accept the Privacy Policy (see open question 1). |
| Existing accounts (already in the database) | Unchanged. |

## 4. Rollout trap (read before Stage 1)

If "block unknown emails" goes live **before the real students are provisioned**, every student who has not signed in yet is locked out. So Stage 1 adds an **environment flag** `REQUIRE_PROVISIONED_ACCOUNTS`:

- not set or `false` = today's behavior (auto-create students),
- `true` = unknown emails are blocked.

Merge and deploy Stage 1 with the flag **off**; switch it on in Render only after the students have been provisioned (Stage 3 makes this fast) and tested. The flag is a Render environment variable (never a secret in the repo). Rolling back = set it to `false`, no redeploy of code needed.

## 5. Stages

### Stage 1: Block unknown emails, provision students, ID required (branch `provisioning-stage1`)

Backend
- `signInPolicy.js` / `auth.js`: when `REQUIRE_PROVISIONED_ACCOUNTS=true` and there is no existing user, no roster role and no `ADMIN_EMAILS` match, return DENY with the message above. Pure-function change with unit tests (flag on/off, existing user, roster, admin email, wrong domain).
- `POST /api/faculty/add`: accept `role: STUDENT`. For a student require name, school email (`ALLOWED_EMAIL_DOMAIN`), School ID (validator + uniqueness), program, year, section (`isValidCohort`), optional gender. For faculty and Dean require the Employee ID (validator + uniqueness). Reject a duplicate email with a clear message. Set `isVerified` / `accountStatus: ACTIVE` as today.
- Decide the first-sign-in profile step (open question 1) and adjust `POST /api/auth/onboarding` accordingly.

Frontend
- Provision Account page: add a Student option (role selector Student / Faculty / Dean), show ID fields (reuse `IdTray`) and the student cohort selects (reuse the Admin edit form pieces). Show the same success card as today.
- Landing page (`LandingPage.tsx`): remove the Sign up button, the role-choice screens and the Student / Faculty sign-up screens; keep one Log in screen; keep the "Faculty Account Assistance" text on it; reword the line "First time here as a student? Signing in creates your account" and the FAQ answer "Who can use CCIS Sync?" so they say accounts are created by the administrator.
- Log in keeps audience `LOGIN`; the Faculty / Student audiences are no longer sent (keep the server code for older clients).

Acceptance (Stage 1)
- [ ] Flag off: existing behavior unchanged.
- [ ] Flag on: unknown school email is blocked and **no `User` is created** (check the database).
- [ ] Provision a student with an ID, log in with Google, land on the Student dashboard; same for faculty and Dean.
- [ ] Duplicate email and duplicate ID are rejected.
- [ ] Backend tests pass; Vercel build passes.

### Stage 2: Disabled accounts tab (branch `provisioning-stage2`)

- New **Disabled (n)** item in Admin > People (next to Faculty and Students), or a tab inside Provision Account if the owner prefers; list accounts with `accountStatus` `RESTRICTED` or `ARCHIVED`: name, role, email, ID, program / position, status, date disabled if known; search and role filter; **Enable** button (reuses `PATCH /users/:id/status`, which currently handles RESTRICTED only; decide whether ARCHIVED accounts can be restored or are view-only).
- Disabled accounts disappear from the Faculty and Students lists, or stay there with the red badge (existing behavior): keep existing behavior unless the owner asks otherwise.
- Acceptance: disable an account, it appears in the tab; Enable returns it; a disabled person cannot log in (message "not active, contact the administrator"); counts in the sidebar are right.

### Stage 3: Excel / CSV reader (branch `provisioning-stage3`)

- **Library:** ExcelJS (maintained; **not** the npm copy of SheetJS). New dependency, so say so in the PR and run `npm install` once. Decide at the start of the stage whether to parse in the browser and send JSON rows (no upload library needed) or upload the file; the server must **re-validate every row either way**.
- **Two templates** (download buttons on the page): Students and Faculty.
  - Students: `Full name`, `School email`, `School ID`, `Program`, `Year`, `Section`, `Gender (optional)`.
  - Faculty: `Full name`, `School email`, `Employee ID`, `Position`, `Program (optional)`, `Role (Faculty or Dean)`, `Employment type (optional)`.
- **Flow:** choose file, show a **preview table** with each row marked OK or with its error (bad email domain, bad ID format, duplicate email or ID in the file or in the database, unknown program / year / section / position), nothing is saved yet. The Admin confirms; valid rows are created, invalid rows are skipped and listed in a downloadable error report. Never overwrite an existing account.
- **Limits:** file size (for example 2 MB), row count (for example 500), `.xlsx` and `.csv` only; treat cell text as plain data (trim, no formulas evaluated); keep email lower-case.
- Tests: pure row-validation function with many bad-row cases (no library needed to test it).
- Acceptance: a sample file with good rows, bad IDs, duplicate emails and a wrong domain gives the right preview and report; created accounts can log in; nothing is created from the invalid rows.

## 6. Open questions (answer before or at the start of Stage 1)

1. **First-sign-in step for pre-made accounts.** They already have an ID and cohort / position from the Admin. Options: (a) **privacy-only** (recommended): the person accepts the Privacy Policy and may add a gender, and nothing else is asked; (b) keep the full onboarding form (they re-enter or confirm the ID and cohort). Option (a) is simpler for users but changes `POST /api/auth/onboarding`.
2. **Existing students who signed themselves up** with no ID (`noIdYet`): leave as they are (default), or force the Admin to fix them before the flag is switched on?
3. **ARCHIVED accounts** in the Disabled tab: can the Admin restore them, or view only?
4. **Dean and Admin accounts:** keep provisioning Dean one at a time (default); Admin stays `ADMIN_EMAILS` only.

## 7. Security and quality rules for this work

- The browser never sends a role to be trusted; the server decides from its own records. Never guess a role from the email pattern.
- Only the Admin can provision; every route re-checks the role on the server. Bulk and single provisioning share one validation function.
- Do not log email lists, IDs or file contents; never commit a real student file. Use fake sample data in tests.
- Keep the school-domain check (`ALLOWED_EMAIL_DOMAIN`).
- Push after every commit; do not merge to `main` until the owner says so (single laptop testing: `git fetch origin`, `git checkout provisioning-stage1`).
- Run `node --check`, `node --test backend/utils/*.test.js` (only `notificationModel.test.js` fails today); the Vercel preview is the frontend build check. State what was not tested (browser, real database).

## 8. What this replaces

This plan supersedes the earlier agreement in `CCIS_SYNC_AI_SESSION_DEVELOPMENT_RULES.md` / the roadmap to "preserve first-time Student onboarding". The Sign up > Student / Faculty screens built in PR #104 become unnecessary once Stage 1 lands; Log in stays.
