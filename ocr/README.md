# Faculty Schedule PDF Importer - Phase 3 OCR prototype

`schedule_ocr.py` turns a scanned **Faculty Individual Load (VAA-FM-061)** PDF into a JSON **draft**
(metadata, teaching blocks, consultation hours, workload cross-check, per-block confidence/flags).
It does not touch MongoDB and never activates a schedule.

    python3 ocr/schedule_ocr.py sheet.pdf --debug-dir out/ > draft.json   # out/detected-cells.png shows what was read

Needs: Python 3, `opencv-python`, `numpy`, `pytesseract`, the `tesseract` binary, and `pdftoppm` (poppler) or PyMuPDF.
`ocr/fixtures/percy.extracted.json` is the real output for the Percy sheet; `backend/utils/scheduleOcr.test.js` compares it with
`demoSchedules.js` (`node --test backend/utils/scheduleOcr.test.js`). The scanned PDF itself is not committed (it carries signatures).

How it works: render 300 DPI -> deskew -> OpenCV line detection -> rows with no line between them are ONE merged cell
(Tue 14:30-16:00 = one record) -> Tesseract per filled cell -> parse subject / section / room. Day uses the repo convention (Sun=0).

Known limits (measured on ONE sample): faculty name is blocked by signatures, so it is always flagged for review;
`IICT` vs `ICT` rooms can be misread, so `ICT` rooms get `room-prefix-check`; only page 1 and only this template are supported;
Saturday/Sunday columns and 6:30 PM blocks are handled by the grid but untested with real data.
Deployment (Python worker vs Node alternative) is still an open decision in the plan.
