# Faculty Schedule PDF Importer: status

Last updated: Phase 5 (upload + entry points). Read this before touching the importer.

## What the importer is for
A Faculty member or an Admin uploads a scanned **Faculty Individual Load (VAA-FM-061)** PDF. The system reads it (OCR), shows an
**editable draft**, checks it, and (Phase 6) lets a person confirm it so it replaces the faculty's class schedule and
official consultation hours. OCR output is never trusted as final: a human reviews every draft.

## Phase map

| Phase | What | PR | State |
|---|---|---|---|
| 1 | Seven-day schedule support (Sun=0 ... Sat=6) in classes, grid editor, calendars | #57, revised in #59 | merged |
| 2 | Weekend policy + central day settings (`daySettings`), consultation limits | #59 (replaces the old `importer-phase2-sunday-consultation` branch, now obsolete) | merged |
| 3 | OCR prototype `ocr/schedule_ocr.py`, fixture, schema | #61 | merged |
| 4 | Draft reader, validator, review screen (read-only) | #60 | merged |
| 5 | PDF upload, OCR runner, three entry points | this PR | in review |
| 6 | Confirm / activate: `ScheduleImport` model, history, effectivity date, rollback-safe replacement, undo | draft PR | built, waiting for the owner's test and "merge" |

Closed without merging: #58 (older OCR attempt, schema superseded by #61) and #62 (parallel-session validator: wrongly blocked the
real Percy sheet even after confirmation, and accepted weekend consultations).

## Rules that are already decided (do not re-litigate without the adviser)
- **Days:** JS/DB convention, Sunday = 0 ... Saturday = 6. Always go through `parseDay()` (null / '' / false never become Sunday).
- **Weekend policy:** Mon-Fri is the default view. Saturday/Sunday are class-only: classes can be imported, but there are no weekend
  consultation hours, slots or requests. Students never see weekend columns. Faculty/Dean/Admin see a weekend column only when a class
  exists that day (or with the "Show weekend" toggle, which cannot hide a column that has classes).
- **Grid:** 7 AM-7 PM, 30-minute steps, last consultation start 6:30 PM.
- **Weekend consultation rows in a draft** are dropped with a warning (`WEEKEND_CONSULTATION_EXCLUDED`); if they reach the validator
  they are blocking errors.
- **Four-hour rule:** official consultation hours must total exactly 240 min/week. Blocking, but switchable with `requireFourHours`
  (open question below).
- **Identity:** only the printed name above "Faculty Member" is read; signatures are never used. A trusted read (>= 90 % confidence,
  not flagged) must match the target account: a mismatch is a hard block that no checkbox can override. A garbled / low-confidence read
  is "unreadable": the reviewer must tick "this document belongs to <name>".
- **Access:** Faculty import only for their own account; Admin for any FACULTY account; Dean and Student get 403. The target of a
  request must be a FACULTY user (404 otherwise).
- **Nothing is saved before the final Confirm (Phase 6).** Parse, preview and validate are read-only.

## OCR contract (draft JSON)
`parserVersion, template, status ('OK' | 'FAILED'), source, metadata{formId, term, academicYear, effectivityDate, facultyName,
facultyNameConfidence, facultyNameSource, facultyNameNeedsReview}, workload{lectureHours, laboratoryHours, totalHours},
classes[]{dayOfWeek, startTime, endTime, confidence, flags, courseTitle, section, room, subject, needsReview, rawText},
consultationHours[]{dayOfWeek, startTime, endTime, label, ...}, warnings[]`.
`fromOcrDraft()` normalizes it (stable row ids `c1..`/`h1..`, `reviewReasons`, 200-row cap). `validateDraft()` returns blocking errors
and warnings. Real fixture: `ocr/fixtures/percy.extracted.json` (the scanned PDF is deliberately not committed: it has signatures).

## Phase 5 (merged, #63)
- `POST /api/schedule-import/preview?facultyId=<id>`: body is the raw PDF (`Content-Type: application/pdf`, <= 10 MB). Checks access,
  verifies it really is a PDF, runs the OCR program, returns the same rows as `/parse` plus `fileHash` (SHA-256). Rate limited; one OCR at a time (others get 429 "busy").
- `backend/utils/pdfUpload.js` (validation, hash), `backend/utils/ocrRunner.js` (runs Python without a shell, temp folder deleted
  afterwards, timeout, typed errors `OCR_UNAVAILABLE | OCR_TIMEOUT | OCR_FAILED | OCR_BAD_OUTPUT`).
- Frontend: `SchedulePdfImporter.tsx` (renamed from `ScheduleImportReview.tsx`): upload step, then the Phase 4 review screen.
  Entry points: Admin > Class Schedules ("Import Schedule PDF"), Admin > Provision Account (only after a FACULTY account is created),
  Faculty > Master Schedule (button under the calendar, own account only).
- Admin-only fallback "load a draft JSON instead" stays, because OCR hosting is undecided (below).

## Phase 6 (confirm and activate): first change to real data
- `POST /api/schedule-import/confirm`: re-cleans and re-validates the rows on the server (against appointments as they are NOW), checks the
  effectivity date (real date, within a year of today), refuses a stale preview (the `scheduleFingerprint` returned by `/validate` must still equal the
  faculty's current schedule), then applies it. Date today or past: applied now (ACTIVE). Future date: stored as SCHEDULED and applied by
  `jobs/scheduleImportActivation.js` (hourly + at startup), which validates AGAIN that day; if it no longer passes it becomes FAILED, the faculty
  and uploader are notified, and the current schedule is left alone.
- Replacement (`utils/scheduleSwap.js`): insert the new rows first (own ids), then delete the old rows by id; a failed delete removes the new rows again,
  a failed insert changes nothing. Works without MongoDB transactions (topology unconfirmed). Only `Schedule` and `ConsultationHours` are touched;
  added consultation hours, notes, appointments, statuses and accounts are never changed. Approved appointments that conflict BLOCK (same rules as the
  manual editor); pending ones only warn and are never moved or cancelled.
- History and undo: `ScheduleImport` keeps who/when, the file SHA-256 (not the PDF), the applied rows and a snapshot of what it replaced.
  `GET /history/:facultyId`; `POST /:id/cancel` (SCHEDULED only); `POST /:id/rollback` (latest ACTIVE import only, only if the schedule is still exactly
  what the import applied, and the old classes must not now cover an approved appointment).
- One change per faculty at a time (in-memory lock per server process: fine for one server, not for several).
- UI: after "Check schedule" passes: effectivity date + "Confirm schedule" (with an "Are you sure?" dialog), an outcome screen, and an import history
  list (Undo / Cancel) on the upload screen. Admin grid and Faculty Master Schedule refresh after applying.
- Tests: `scheduleSwap.test.js`, `scheduleImportService.test.js`. The real route file was also exercised once against an in-memory fake database
  (confirm, stale, future date, undo, cancel, 403/400/422 cases).
- NOT verified: a real MongoDB, a browser run of the confirm UI, `npm run build`, the hourly job with a real clock. Do these on the first local test.

## Open decisions (need a human)
1. **Where does OCR run?** It needs Python, OpenCV, Tesseract and poppler. Most free Node hosts do not have them. Options: a small
   Docker worker (Render / Railway / a VM), or run OCR on a school machine. Until decided, `/preview` answers `OCR_UNAVAILABLE`
   and the UI says so plainly. Set `OCR_PYTHON` (default `python3`) and optionally `OCR_SCRIPT`, `OCR_TIMEOUT_MS`.
2. **Four-hour rule vs faculty with no consultation hours** (part-timers, deans). Ask the adviser.
3. **Old weekend consultation rows** may exist in the database from earlier testing. Check:
   `db.consultationhours.find({ dayOfWeek: { $in: [0, 6] } })` and the same for `addedconsultationhours`.

## Known gaps
- Only ONE real scan has been tested (page 1, this template). Weekend columns and 6:30 PM blocks are untested with real data.
- Drafts live in the browser only; closing the window loses unsent edits (only confirmed imports are stored).
- `IICT` vs `ICT` rooms can be misread: `ICT` rooms are flagged for review.

## How to run / test
    cd backend && npm ci && node --test            # all backend tests
    cd frontend && npm ci && npm run build         # type-check + build
    python3 ocr/schedule_ocr.py sheet.pdf > draft.json
