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

Faculty name: only the PRINTED name above "Faculty Member" is read (block 2 of the footer is cropped and OCR'd three ways; all candidates are kept
with `facultyNameSource`, a measured `facultyNameConfidence`, and `facultyNameNeedsReview`). It is trusted only when >=2 reads agree at >=90% confidence;
signatures are never recognised or used as identity. Matching it to the selected account is a Phase 4/5 backend rule.

Layouts seen so far (both are VAA-FM-061 prints): Percy (24 rows, 2 printed lines per cell with a "|") and Fortaleza (25 rows incl. 7:00-7:30 PM,
uneven row heights, page-edge shadow, 3 printed lines per cell, handwritten hour counts). The grid is read from the printed time labels, a page-edge
shadow is ignored, handwritten numbers are left out and listed in an `ignored-marks` warning, and rows after 7 PM are flagged.

Measured: day/start/end 14/14 (Percy) and 19/19 (Fortaleza) exact. Subject+room: Percy 14/14, Fortaleza only about 7/19 (tiny blurry print), but
every wrong cell is flagged (`needsReview`), which is the guarantee the review screen relies on. `OCR_CELL_SCALE` (default 3.5) tunes the enlargement.

Known limits (measured on TWO samples): on Percy's sheet the signature covers the name, so the read is garbled (~64% confidence) and flagged;
`IICT` vs `ICT` rooms can be misread, so `ICT` rooms get `room-prefix-check`; only page 1 and only this form is supported;
Saturday/Sunday columns and 6:30 PM blocks are handled by the grid but untested with real data.
Deployment (Python worker vs Node alternative) is still an open decision in the plan.
