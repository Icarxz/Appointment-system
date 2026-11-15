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

**General reader (not one template per print).** Nothing assumes where the sheet starts or how long it is: the row lines come from the picture, the time of each row
from the printed labels (each readable label votes for where the first row starts; a garbled label just loses its vote), the time rows end where the footer words
("Lecture Hours", "Additional ETU") begin, and section / room are found by what they look like (room = IICT/ICT + number, or TBA; section = a whole line that looks
like a section) on whichever line they are, not by a fixed line order. The three known printed layouts are tried first. Sheets that start at 7:00 or 7:30 AM and stop at
5:30, 6:30, 7:00 or 8:30 PM all read. Anything that cannot be matched is left empty and flagged, never guessed. `python ocr/check_sheets.py a.pdf b.pdf ...` reads PDFs and
compares each one with its saved fixture (PASS / DIFF): run it on the real scans after any change to the reader.

Layouts seen so far (all VAA-FM-061 prints; Saylo, Niego and Egualan are the 4th-6th sheets: room printed before the section, a single "<section> <room>" line, 27 rows to 8:30 PM, first row 7:30): Percy (24 rows, 2 printed lines per cell with a "|"), Fortaleza (25 rows incl. 7:00-7:30 PM,
uneven row heights, page-edge shadow, 3 printed lines per cell, handwritten hour counts) and Silva (21 rows, the sheet stops at 5:30 PM; titles wrap and
the last line is "<section> - <room>"; a left-edge shadow that is SHORTER than the table; a stray border digit can spoil a time label).
Scan-edge lines are told apart from table lines by length AND by where they start (table lines all start at the table top). The grid is read from the printed time labels, a page-edge
shadow is ignored, handwritten numbers are left out and listed in an `ignored-marks` warning, and rows after 7 PM are flagged.

Measured: day/start/end 14/14 (Percy), 19/19 (Fortaleza) and 15/15 (Silva, plus both consultation blocks) exact; Silva sections 15/15 and rooms 14/15 (the wrong one is flagged), titles mostly garbled but flagged. Subject+room: Percy 14/14, Fortaleza only about 7/19 (tiny blurry print), but
every wrong cell is flagged (`needsReview`), which is the guarantee the review screen relies on. `OCR_CELL_SCALE` (default 3.5) tunes the enlargement.

Measured on three more sheets by eye (Saylo, Niego, Egualan; expected values in `backend/utils/ocrGroundTruth.js`): day/start/end 20/20, 19/19, 21/21 exact and all consultation blocks exact with both renderers; text is often garbled (sections 17-19/20, rooms 9-11/20 on Saylo) but no wrong cell is unflagged, and the extracted hours equal the printed totals on every sheet.

Known limits (measured on SIX samples): on Percy's sheet the signature covers the name, so the read is garbled (~64% confidence) and flagged;
`IICT` vs `ICT` rooms can be misread, so `ICT` rooms get `room-prefix-check`; only page 1 and only this form is supported;
Saturday/Sunday columns and 6:30 PM blocks are handled by the grid but untested with real data.
Deployment (Python worker vs Node alternative) is still an open decision in the plan.
