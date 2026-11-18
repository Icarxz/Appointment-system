# Dean consultations: status

Last updated: Step 3 (Dean consultation pages). Read this before touching the Dean dashboard, the booking rules or `FacultyDashboard.tsx`.

## What this is
The Dean can also be requested by students, like a faculty member. It is **opt-in** (a switch in the Dean's own Consultation Settings),
keeps the Dean's oversight pages, and adds his own consultation pages and analytics. His role stays `DEAN`.

## Step map
| Step | What | State |
|---|---|---|
| 1 | Reasons shown to students; `acceptsConsultations` + `weeklyRequestLimit`; `isConsultable`; weekly limit in booking; Dean answers only his own requests; `/analytics/me` for Dean; Faculty Reasons page removed | patch applied by the owner (commit "step1") |
| 2 | Owner-scoped faculty routes opened to Dean; Dean hours rule; Consultation Settings page | in `dean-consultations-step2-3.patch` |
| 3 | Dean pages: Master Schedule, Requests, My Consultation Log, Consultation Hours, Status & Notices, My Analytics (the faculty pages, embedded) | in the same patch, not yet built/tested by the owner |
| 4 | Student UI: "Dean's Office" card, "N of 5 requests left this week" | NOT built |
| 5 | Importer for the Dean's own account; four-hour rule for the Dean in the importer | NOT built, needs adviser |

Steps 2 and 3 are ONE patch (`dean-consultations-step2-3.patch`, made against the repo after step 1). Apply with `git apply --3way`.
(An earlier, separate `DeanRequests.tsx` was dropped: Requests is now the full faculty page, which also has the start-time/length picker and "Cancel several".)

## Rules that are decided (from the owner)
- **Reasons, not appeals.** The system says "reason" wherever users see text. Only the stored field is still called `appeal` (renaming needs a migration; not done).
- **Faculty reasons go to the student.** A rejected or faculty-cancelled consultation shows "Reason from professor" in the student's list. A reason the faculty adds later for a missed or cancelled consultation notifies the student. The Dean no longer receives or reviews faculty reasons.
- **Dean nav:** Reports & Analytics, Faculty Roster, Consultation Records stay. "Faculty Reasons" is removed. New section "My Consultations" (+ "My Analytics").
- **5 requests per student per week for the Dean.** Monday to Sunday, counted by consultation date; PENDING, APPROVED and COMPLETED count. Faculty have no limit (the earlier "no request limit" decision still holds for them).
- **Master calendar for the Dean:** his own schedule, same page as the faculty Master Schedule.

## How it works
- `User.acceptsConsultations` (default false), `User.weeklyRequestLimit` (Dean default 5, 1-20). `GET/PATCH /api/faculty/dean/consultation-settings` (Dean only).
- `utils/consultable.js`: FACULTY, or DEAN with the switch on. Used by `/status`, `POST /appointment`, `/slots/:id`.
- `utils/weeklyLimit.js`; booking answers 429 `WEEKLY_LIMIT` and recounts after saving to undo a request that raced past the limit.
- `PUT /appointment/:id`: a Dean may answer only requests made to him.
- Opened to FACULTY **and** DEAN (each already filters by the id in the login token, never a body/param id): added-hours, status-entry, notice-entry, notices/mine, consultation-hours POST, appointment complete / consultation-log PATCH / cancel / no-show, bulk-cancel (Dean counts as faculty), calendar notes (GET/POST/PUT/DELETE).
- `utils/consultationHoursRule.js`: faculty exactly 240 min/week; Dean 30 min to 240 min (**draft decision**).
- **Frontend:** `FacultyDashboard` takes `embeddedPage`, `role`, `canImportSchedule`. With `embeddedPage` it draws only that page (no menu, header, banner or deep links). `DeanDashboard` renders it for schedule, requests, log, hours, status and analytics, only while the switch is on (`key={page}`, so each page remounts). Dean passes `role="DEAN"` (his hours rule) and `canImportSchedule={false}` (the importer is closed to him).
- The menu "Requests" badge counts the Dean's own PENDING requests from the all-appointments list. The Dean is hidden from his own Faculty Roster table. Notification links for a Dean open `?page=requests`.
- Still FACULTY/ADMIN only: the schedule importer, schedule editing (Admin Class Schedules).

## Known gaps
- Until the Dean has consultation hours, students find no bookable slots with him (he sets them in Consultation Hours).
- The Dean cannot import or edit class schedules, so his Master Schedule shows consultation hours, bookings and notes only.
- The Admin dashboard's faculty lists use `/status`, so a Dean who takes consultations also appears there (and in the student list, as intended).
- Frontend was only desk-checked (no `node_modules` where it was written): run `npm run build`. Nothing was run against a real MongoDB or a browser. Check each embedded page once as a Dean (Master Schedule and Consultation Hours most of all).
- If the switch is turned off while the Dean is on a consultation page, that page shows "Turn on student consultation requests...".

## Open decisions (need a human)
1. **Dean consultation hours total.** Draft: 30 minutes to 4 hours. Confirm with the adviser (same open question as the four-hour rule for part-timers).
2. **Importer for the Dean's own account** (currently Dean gets 403, a decided rule). Needs the adviser.
3. **Shared Admin/Dean report:** should the Dean's own appointments count in faculty figures? Suggested: a separate "Dean's Office" line.
4. **Rename the `appeal` field** to `reason` everywhere? Needs a migration.
5. **Missed-appointment wording** for students could say a reason may follow.

## How to run / test
    cd backend && npm ci && node --test            # 319 tests; notificationModel.test.js needs mongoose installed (it did not run in the sandbox)
    cd frontend && npm ci && npm run build         # type-check + build
    # turn the Dean switch on: Dean dashboard > Consultation Settings, then add hours under Consultation Hours
