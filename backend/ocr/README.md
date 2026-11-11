# Faculty schedule OCR prototype (importer plan, phase 3)

Reads a scanned **VAA-FM-061** faculty schedule PDF and writes a **draft** JSON. It is a prototype:
it does not touch MongoDB, does not call the API, and never activates a schedule. Every draft has
`status: "NEEDS_REVIEW"` and a person must confirm it.

## Needs
- Python 3.10+, `pip install -r requirements.txt`
- System programs: **Tesseract** (`tesseract`) and **poppler** (`pdftoppm`) unless PyMuPDF is installed.
  Windows: install Tesseract (UB-Mannheim build) and poppler, then add both to PATH.

## Run
```powershell
cd backend\ocr
python schedule_extractor.py C:\path\load.pdf --out draft.json --debug-dir debug
# optional: compare with the repo's demo fixture JSON
python schedule_extractor.py load.pdf --out draft.json --expected expected.json
```
`debug\grid_overlay.png` shows the detected grid so you can see what the program saw.

## Output rules (from the plan)
- `dayOfWeek` is JS style: Sunday 0, Monday 1 ... Saturday 6.
- Grid is 07:00-19:00 in 30-minute rows; a merged cell is ONE block with continuous `startTime`/`endTime`.
- Teaching classes (`classes`) and consultation hours (`consultationHours`) are separate lists.
- Low OCR confidence, odd-length blocks, unreadable cells and auto-corrected room text set `needsReview` with reasons.
- Sunday / Saturday cells are read, never dropped.
- Faculty name sits under the signature and is **not trusted**: only a `facultyNameHint`, plus an always-present `FACULTY_IDENTITY` warning.

## Tests
```
python3 -m unittest -v test_schedule_extractor
PERCY_PDF=/path/PERCY-CARL-SPENCE.pdf python3 -m unittest -v test_schedule_extractor   # needs Node
```
The scan itself is not committed (signatures, personal data).

## Known limits
- Validated on ONE real scan (Percy: 14 classes + Tue/Thu 09:00-11:00, all matching `utils/demoSchedules.js`). Other layouts, rotations or photo quality are untested.
- Saturday/Sunday and 7 PM edge are covered only by a synthetic test image.
- Room fixes (e.g. `lICT` -> `IICT`) apply only when the document's rooms share a prefix, and are flagged.
