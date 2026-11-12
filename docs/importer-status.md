# Faculty Schedule PDF Importer: status

Last updated: 2026-11-12 (afternoon), after Phase 5 (PR #63, open, not merged) and the first local try-out. Read this before touching the importer.

## What the importer is for
A Faculty member or an Admin uploads a scanned **Faculty Individual Load (VAA-FM-061)** PDF. The system reads it (OCR), shows an
**editable draft**, checks it, and (Phase 6, not built) lets a person confirm it so it replaces the faculty's class schedule and
official consultation hours. OCR output is never trusted as final: a human reviews every draft.

## Phase map

| Phase | What | PR | State |
|---|---|---|---|
| 1 | Seven-day schedule support (Sun=0 ... Sat=6) in classes, grid editor, calendars | #57, revised in #59 | merged |
| 2 | Weekend policy + central day settings (`daySettings`), consultation limits | #59 (replaces the old `importer-phase2-sunday-consultation` branch, now obsolete) | merged |
| 3 | OCR prototype `ocr/schedule_ocr.py`, fixture, schema | #61 | merged |
| 4 | Draft reader, validator, review screen (read-only) | #60 | merged |
| 5 | PDF upload, OCR runner, three entry points | #63 | open, waiting for "merge" |
| 6 | Confirm / activate: `ScheduleImport` model, history, effectivity date, atomic replacement | none | NOT built |

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
- **Nothing is saved before Phase 6.** Parse, preview and validate are read-only.

## OCR contract (draft JSON)
`parserVersion, template, status ('OK' | 'FAILED'), source, metadata{formId, term, academicYear, effectivityDate, facultyName,
facultyNameConfidence, facultyNameSource, facultyNameNeedsReview}, workload{lectureHours, laboratoryHours, totalHours},
classes[]{dayOfWeek, startTime, endTime, confidence, flags, courseTitle, section, room, subject, needsReview, rawText},
consultationHours[]{dayOfWeek, startTime, endTime, label, ...}, warnings[]`.
`fromOcrDraft()` normalizes it (stable row ids `c1..`/`h1..`, `reviewReasons`, 200-row cap). `validateDraft()` returns blocking errors
and warnings. Real fixture: `ocr/fixtures/percy.extracted.json` (the scanned PDF is deliberately not committed: it has signatures).

## Phase 5 (PR #63)
- `POST /api/schedule-import/preview?facultyId=<id>`: body is the raw PDF (`Content-Type: application/pdf`, <= 10 MB). Checks access,
  verifies it really is a PDF, runs the OCR program, returns the same rows as `/parse` plus `fileHash` (SHA-256). Rate limited; one OCR at a time (others get 429 "busy").
- `backend/utils/pdfUpload.js` (validation, hash), `backend/utils/ocrRunner.js` (runs Python without a shell, temp folder deleted
  afterwards, timeout, typed errors `OCR_UNAVAILABLE | OCR_TIMEOUT | OCR_FAILED | OCR_BAD_OUTPUT`).
- Frontend: `SchedulePdfImporter.tsx` (renamed from `ScheduleImportReview.tsx`): upload step, then the Phase 4 review screen.
  Entry points: Admin > Class Schedules ("Import Schedule PDF"), Admin > Provision Account (only after a FACULTY account is created),
  Faculty > Master Schedule (button under the calendar, own account only).
- Admin-only fallback "load a draft JSON instead" stays, because OCR hosting is undecided (below).

### Phase 5 test results
- 222 backend tests pass (new: `pdfUpload.test.js`, `ocrRunner.test.js`, a FAILED-read test in `scheduleDraft.test.js`); frontend build clean.
- HTTP check of `/preview`: Admin and own-Faculty 200; other Faculty 403; Dean 403; unknown faculty 404; missing id 400; non-PDF 400;
  real Python OCR on a non-form PDF 422 ("could not be read as a Faculty Individual Load form"); missing Python 503 `OCR_UNAVAILABLE`.
- Browser check of the upload step: wrong file type, 422 and 503 messages, rows loaded from a PDF response, JSON fallback shown to Admin only.
- NOT tested: a real scan uploaded end-to-end (the Percy PDF is not in the repo). Do this once after merge, on a machine with the OCR tools.
- First local try-out (user's Windows machine, Percy PDF): the upload reached the OCR, which failed because **Tesseract is not installed** there.
  Found and fixed (commit a612ac3): a missing OCR tool was reported as "this PDF could not be read"; it is now a 503 "schedule reader is not
  fully installed on this server". Also, choosing a PDF in the admin JSON-draft box now points to the PDF upload box.
- Fixed on the way: a failed OCR read used to report "not a schedule draft"; it now says the PDF was not recognised.

## Next: Phase 6 (confirm and activate), not started
First change to real data, so the riskiest phase. To settle in a design note before coding: `ScheduleImport` record (who, when, file hash,
the confirmed rows, previous schedule snapshot), effectivity date, atomic replacement of classes + official consultation hours (all or
nothing), what happens to already-APPROVED/PENDING appointments that the new schedule conflicts with, undo/rollback, and an audit
history screen. Re-validate on the server at confirm time (never trust the browser's "ready" state).

## Next step for a real end-to-end test (Windows)
1. Install Tesseract (UB Mannheim build) and add `C:\Program Files\Tesseract-OCR` to PATH; check `tesseract --version` in a NEW PowerShell.
2. `pip install pymupdf` (or install poppler) for PDF rendering; keep `opencv-python numpy pytesseract` installed.
3. Restart the backend; upload the Percy PDF in the top box. Expected: name needs confirmation (signature covers it), 14 classes, 2 consultation
   blocks (4 h), one warning for the `ICT 108` room. Not yet verified on Windows.

## Open decisions (need a human)
1. **Where does OCR run?** It needs Python, OpenCV, Tesseract and poppler. Most free Node hosts do not have them. Options: a small
   Docker worker (Render / Railway / a VM), or run OCR on a school machine. Until decided, `/preview` answers `OCR_UNAVAILABLE`
   and the UI says so plainly. Set `OCR_PYTHON` (default `python3`) and optionally `OCR_SCRIPT`, `OCR_TIMEOUT_MS`.
2. **Four-hour rule vs faculty with no consultation hours** (part-timers, deans). Ask the adviser.
3. **Old weekend consultation rows** may exist in the database from earlier testing. Check:
   `db.consultationhours.find({ dayOfWeek: { $in: [0, 6] } })` and the same for `addedconsultationhours`.

## Known gaps
- Only ONE real scan has been tested (page 1, this template). Weekend columns and 6:30 PM blocks are untested with real data.
- Drafts live in the browser only until Phase 6; closing the window loses edits.
- `IICT` vs `ICT` rooms can be misread: `ICT` rooms are flagged for review.

## How to run / test
    cd backend && npm ci && node --test            # all backend tests
    cd frontend && npm ci && npm run build         # type-check + build
    python3 ocr/schedule_ocr.py sheet.pdf > draft.json
