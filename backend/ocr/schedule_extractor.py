#!/usr/bin/env python3
"""
Faculty Schedule PDF Importer, phase 3: OCR prototype.

Reads a scanned "Faculty Individual Load" (University of Antique, VAA-FM-061) and writes a DRAFT as JSON:
document details, teaching classes and official consultation hours as continuous start/end ranges.
It never touches the database and never activates anything. A person reviews the draft first (later phases).

Pipeline: render page -> straighten -> find table lines (OpenCV) -> row/column grid -> merge cells that have no
line between them -> OCR each cell (Tesseract) -> normalise into blocks (dayOfWeek 0-6, "HH:MM" 24 h).

    python3 schedule_extractor.py load.pdf --out draft.json [--debug-dir dir]

Dependencies: see requirements.txt and README.md. The page renderer is replaceable (render_pdf).
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

PARSER_VERSION = 'vaa-fm-061/0.1'

# The form's columns, in order after the TIME column, and the day number CCIS SYNC stores (JS convention: Sunday = 0).
DAY_COLUMNS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
DAY_NUMBER = {'MONDAY': 1, 'TUESDAY': 2, 'WEDNESDAY': 3, 'THURSDAY': 4, 'FRIDAY': 5, 'SATURDAY': 6, 'SUNDAY': 0}

FIRST_MINUTE = 7 * 60          # the grid starts at 07:00
STEP_MINUTES = 30
ROW_COUNT = 24                  # 07:00 to 19:00 in half hours
INK_EMPTY = 0.003               # share of non-line dark pixels under which a cell counts as empty
LOW_CONFIDENCE = 80             # Tesseract word confidence (0-100) under which a cell is flagged for review


# ---------------------------------------------------------------------------------------------------------------
# Small pure helpers (unit tested without any image)
# ---------------------------------------------------------------------------------------------------------------
def minutes_to_hhmm(total: int) -> str:
    return f'{total // 60:02d}:{total % 60:02d}'


def row_start_minutes(row: int) -> int:
    return FIRST_MINUTE + row * STEP_MINUTES


def cells_from_separators(separators: list[bool], row_count: int = ROW_COUNT) -> list[tuple[int, int]]:
    """
    One column of the grid. separators[k] says whether a line is drawn between row k and row k+1 (k = 0..row_count-2).
    Rows with no line between them are one merged cell. Returns (first_row, last_row) pairs, both inclusive.
    """
    if len(separators) != row_count - 1:
        raise ValueError(f'expected {row_count - 1} separators, got {len(separators)}')
    cells, start = [], 0
    for k, has_line in enumerate(separators):
        if has_line:
            cells.append((start, k))
            start = k + 1
    cells.append((start, row_count - 1))
    return cells


def block_times(first_row: int, last_row: int) -> tuple[str, str]:
    """A cell covering rows first_row..last_row is one continuous range, e.g. rows 15-16 -> ('14:30', '15:30')."""
    return minutes_to_hhmm(row_start_minutes(first_row)), minutes_to_hhmm(row_start_minutes(last_row + 1))


_DASHES = re.compile(r'[‐-―−]')


def clean_text(text: str) -> str:
    text = _DASHES.sub('-', text)
    text = text.replace('‘', "'").replace('’', "'").replace('“', '"').replace('”', '"')
    return re.sub(r'[ \t]+', ' ', text).strip()


def parse_cell_text(text: str) -> dict:
    """
    A teaching cell has the subject on the first line(s) and "SECTION | ROOM" on the last line.
    The official consultation cell just says CONSULTATION HOURS.
    """
    lines = [clean_text(l) for l in text.splitlines()]
    lines = [l for l in lines if l]
    joined = ' '.join(lines)
    if re.search(r'consult', joined, re.I):
        return {'kind': 'consultation', 'label': 'CONSULTATION HOURS'}
    if not lines:
        return {'kind': 'empty'}
    subject, section, room = strip_noise(joined), '', ''
    for i in range(len(lines) - 1, -1, -1):
        if '|' in lines[i]:
            left, _, right = lines[i].partition('|')
            section, room = strip_noise(left), strip_noise(right)
            subject = strip_noise(' '.join(lines[:i]))
            break
    return {'kind': 'class', 'subject': subject, 'section': section, 'room': room}


def strip_noise(text: str) -> str:
    """Table borders sometimes leave stray marks ('_', '|', '~') at the ends of a recognised line."""
    return re.sub(r'^[\s_|~.,;:\-]+|[\s_|~.,;:]+$', '', text).strip()


def normalise_rooms(classes: list[dict]) -> None:
    """
    Tesseract confuses capital I, lowercase l and 1 ('lICT 306') and sometimes drops a letter ('ICT 108'). When most rooms in
    the document share one prefix (here 'IICT'), a room that differs only by such a slip is corrected to that prefix.
    Every correction is recorded and the block is flagged for review, so a person confirms it.
    """
    rooms = [re.match(r'^([A-Za-z]+)\s*(\d+)$', c['room']) for c in classes if c['room']]
    prefixes = [m.group(1) for m in rooms if m]
    if len(prefixes) < 3:
        return
    common = max(set(prefixes), key=prefixes.count)
    if prefixes.count(common) < 0.6 * len(prefixes):
        return
    pattern = re.compile(r'^[lI1|!]{0,3}' + re.escape(common.lstrip('Il1')) + r'\s*(\d+)$')
    for c in classes:
        if not c['room'] or re.fullmatch(re.escape(common) + r' \d+', c['room']):
            continue  # nothing to fix
        m = pattern.match(c['room'])
        if m:
            fixed = f'{common} {m.group(1)}'
            if fixed != c['room']:
                c.setdefault('corrections', []).append({'field': 'room', 'from': c['room'], 'to': fixed})
                c['reviewReasons'].append(f'Room corrected from "{c["room"]}" to "{fixed}": please check.')
                c['needsReview'] = True
                c['room'] = fixed


def parse_effectivity_date(text: str):
    """'MARCH 9, 2026' -> '2026-03-09'. None when it cannot be read."""
    m = re.search(r'([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*,?\s*(\d{4})', text)
    if not m:
        return None
    for fmt in ('%B %d %Y', '%b %d %Y'):
        try:
            return datetime.strptime(f'{m.group(1)} {m.group(2)} {m.group(3)}', fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    return None


def parse_header_text(text: str) -> dict:
    out = {'term': None, 'academicYear': None, 'effectivityDate': None, 'effectivityDateText': None}
    t = clean_text(text)
    m = re.search(r'Term\s*:?\s*(.+?)\s+A\.?\s?Y\.?\s*:?\s*(\d{4})\s*-\s*(\d{4})', t, re.I)
    if m:
        out['term'] = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', m.group(1).strip())  # OCR may glue words together
        out['academicYear'] = f'{m.group(2)}-{m.group(3)}'
    m = re.search(r'Effectivity\s*Date\s*:?\s*([A-Za-z]+\.?\s+\d{1,2}\s*,?\s*\d{4})', t, re.I)
    if m:
        out['effectivityDateText'] = m.group(1).strip()
        out['effectivityDate'] = parse_effectivity_date(m.group(1))
    return out


def parse_footer_text(text: str) -> dict:
    out = {'formId': None, 'revision': None, 'lectureHours': None, 'laboratoryHours': None, 'totalHours': None}
    m = re.search(r'VAA-FM-\d+', text)
    out['formId'] = m.group(0) if m else None
    m = re.search(r'Rev\.?\s*[\d/.\-]+', text)
    out['revision'] = m.group(0).strip() if m else None
    for key, label in (('lectureHours', 'Lecture Hours'), ('laboratoryHours', 'Laboratory Hours'), ('totalHours', 'Total Hours')):
        m = re.search(label + r'\s*:?\s*(\d+(?:\.\d+)?)', text, re.I)
        out[key] = float(m.group(1)) if m else None
    return out


_DEGREES = r'(?:MIT|MSIT|MS|MBA|MAED|MPA|DIT|PHD|EDD|MA|MAT)'


def parse_faculty_name(text: str) -> dict:
    """
    The printed names under "Prepared by" and "Acknowledged by" are covered by signatures, so Tesseract usually reads
    only fragments ("CARL SP ... MIT"). Returns {'name': full name or None, 'hint': the fragment or None}. A full name is
    only returned when it was read cleanly (a first name, a surname and a degree, no gaps). The hint is for a human.
    """
    full = re.search(r"\b([A-Z][A-Z.'\-]+(?: [A-Z][A-Z.'\-]*){1,4}), ?" + _DEGREES + r"\b", text)
    if full and not re.search(r'\b[A-Z]{1,3}\b(?: |,)', full.group(1).split(' ', 1)[1] if ' ' in full.group(1) else ''):
        return {'name': full.group(0).strip(), 'hint': full.group(0).strip()}
    for frag in re.finditer(r"\b([A-Z][A-Z.'\-]{2,}(?: [A-Z][A-Z.'\-]*){0,2})\b[^\n]{0,40}?\b(" + _DEGREES + r")\b", text):
        words = frag.group(1).split()
        while words and re.fullmatch(_DEGREES, words[0]):
            words.pop(0)  # a degree left over from the previous name
        if words:
            return {'name': None, 'hint': f"{' '.join(words)} ... {frag.group(2)}"}
    return {'name': None, 'hint': None}


# ---------------------------------------------------------------------------------------------------------------
# Rendering and image steps
# ---------------------------------------------------------------------------------------------------------------
def render_pdf(path: str, dpi: int = 300) -> list[np.ndarray]:
    """Render every page to a BGR image. Uses PyMuPDF when installed, otherwise poppler's pdftoppm."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(path)
        pages = []
        for page in doc:
            pix = page.get_pixmap(dpi=dpi)
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
            pages.append(cv2.cvtColor(img, cv2.COLOR_RGB2BGR if pix.n == 3 else cv2.COLOR_RGBA2BGR))
        return pages
    except ImportError:
        pass
    if not shutil.which('pdftoppm'):
        raise RuntimeError('Install PyMuPDF (pip install pymupdf) or poppler-utils (pdftoppm) to render PDFs.')
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['pdftoppm', '-r', str(dpi), '-png', path, str(Path(tmp) / 'p')], check=True, timeout=120)
        files = sorted(Path(tmp).glob('p-*.png'))
        return [cv2.imread(str(f)) for f in files]


def binarise(gray: np.ndarray) -> np.ndarray:
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return bw


def estimate_skew(bw: np.ndarray) -> float:
    """Median angle (degrees) of the long horizontal table lines."""
    h, w = bw.shape
    mask = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (w // 12, 1)))
    lines = cv2.HoughLinesP(mask, 1, np.pi / 1800, threshold=200, minLineLength=w // 5, maxLineGap=20)
    if lines is None:
        return 0.0
    angles = [np.degrees(np.arctan2(y2 - y1, x2 - x1)) for x1, y1, x2, y2 in lines.reshape(-1, 4)]
    angles = [a for a in angles if abs(a) < 5]
    return float(np.median(angles)) if angles else 0.0


def rotate(img: np.ndarray, angle: float) -> np.ndarray:
    if abs(angle) < 0.02:
        return img
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def line_masks(bw: np.ndarray):
    h, w = bw.shape
    horiz = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (max(30, w // 60), 1)))
    vert = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(30, h // 60))))
    return horiz, vert


def group_positions(values: np.ndarray, gap: int = 8) -> list[int]:
    """Centres of runs of adjacent positions (a drawn line is several pixels thick)."""
    out, run = [], []
    for v in values:
        if run and v - run[-1] > gap:
            out.append(int(round(sum(run) / len(run))))
            run = []
        run.append(int(v))
    if run:
        out.append(int(round(sum(run) / len(run))))
    return out


# ---------------------------------------------------------------------------------------------------------------
# OCR
# ---------------------------------------------------------------------------------------------------------------
def ocr(image: np.ndarray, psm: int = 6, scale: float = 2.0) -> tuple[str, float, list[dict]]:
    """Returns (text with line breaks, mean word confidence 0-100, words). Confidence is 0 when nothing was read."""
    import pytesseract
    if image.size == 0:
        return '', 0.0, []
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    if scale != 1.0:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    gray = cv2.copyMakeBorder(gray, 12, 12, 12, 12, cv2.BORDER_CONSTANT, value=255)
    data = pytesseract.image_to_data(gray, config=f'--psm {psm}', output_type=pytesseract.Output.DICT)
    words, lines = [], {}
    for i, txt in enumerate(data['text']):
        txt = txt.strip()
        conf = float(data['conf'][i])
        if not txt or conf < 0:
            continue
        key = (data['block_num'][i], data['par_num'][i], data['line_num'][i])
        lines.setdefault(key, []).append(txt)
        words.append({'text': txt, 'conf': conf,
                      'x': data['left'][i] / scale, 'y': data['top'][i] / scale,
                      'w': data['width'][i] / scale, 'h': data['height'][i] / scale})
    text = '\n'.join(' '.join(v) for _, v in sorted(lines.items()))
    conf = float(np.mean([w['conf'] for w in words])) if words else 0.0
    return text, conf, words


# ---------------------------------------------------------------------------------------------------------------
# Grid detection
# ---------------------------------------------------------------------------------------------------------------
@dataclass
class Grid:
    col_x: list[int]            # 9 vertical line positions: TIME | MON ... SUN
    row_y: list[int]            # 25 horizontal line positions: top of 07:00 row ... bottom of the last row
    header_top: int = 0         # the line above the day headings (0 when not found)
    notes: list[str] = field(default_factory=list)


class ExtractionError(Exception):
    pass


def detect_grid(bw: np.ndarray, gray: np.ndarray) -> Grid:
    h, w = bw.shape
    horiz, vert = line_masks(bw)
    notes: list[str] = []

    # Vertical lines: long runs that cross most of the table. First find the table's busy band.
    col_sum = (vert > 0).sum(axis=0)
    cand = np.where(col_sum > h * 0.25)[0]
    col_x = group_positions(cand, gap=10)
    if len(col_x) < 9:
        raise ExtractionError(f'Found {len(col_x)} vertical table lines; expected 9 (TIME plus 7 days). Is this a VAA-FM-061 form?')
    # Keep the 9 that bound the TIME and day columns: they span the widest range with the strongest lines.
    if len(col_x) > 9:
        strengths = {x: col_sum[max(0, x - 4):x + 5].max() for x in col_x}
        col_x = sorted(sorted(col_x, key=lambda x: -strengths[x])[:9])
        notes.append('More than 9 vertical lines found; kept the 9 strongest.')

    # Horizontal lines inside the TIME column (every row of the grid has one there).
    x0, x1 = col_x[0], col_x[1]
    strip = (horiz[:, x0 + 3:x1 - 3] > 0).sum(axis=1)
    ys = group_positions(np.where(strip > (x1 - x0) * 0.6)[0], gap=6)

    # Anchor on the OCR'd time labels: the line just above the "07:00-07:30" label is the top of the grid.
    time_crop = gray[:, x0 + 3:x1 - 3]
    _, _, words = ocr(cv2.cvtColor(time_crop, cv2.COLOR_GRAY2BGR), psm=6, scale=1.0)
    centres = [w_['y'] + w_['h'] / 2 for w_ in words if re.match(r'^\d{2}:\d{2}-\d{2}:\d{2}$', w_['text'])]
    first_label = next((w_ for w_ in words if w_['text'].startswith('07:00')), None)
    if first_label is not None:
        cy = first_label['y'] + first_label['h'] / 2
        above = [y for y in ys if y < cy]
        if not above:
            raise ExtractionError('Could not find the line above the 07:00 row.')
        start = ys.index(max(above))
    else:
        # Fallback: the first 25 evenly spaced lines. Flagged for review.
        notes.append('Could not read the "07:00-07:30" label; the row grid was found by spacing only.')
        start = 0
        for i in range(0, max(0, len(ys) - ROW_COUNT)):
            gaps = np.diff(ys[i:i + ROW_COUNT + 1])
            if gaps.size and gaps.max() - gaps.min() <= max(6, 0.3 * np.median(gaps)):
                start = i
                break
    row_y = ys[start:start + ROW_COUNT + 1]
    if len(row_y) != ROW_COUNT + 1:
        raise ExtractionError(f'Found {len(row_y)} row lines from 07:00; expected {ROW_COUNT + 1} (07:00 to 19:00).')
    if len(centres) < ROW_COUNT - 4:
        notes.append(f'Only {len(centres)} of {ROW_COUNT} time labels were readable.')
    else:
        # Each readable label must lie inside its own row.
        bad = 0
        for c in centres:
            r = next((i for i in range(ROW_COUNT) if row_y[i] <= c <= row_y[i + 1]), None)
            if r is None:
                bad += 1
        if bad:
            notes.append(f'{bad} time label(s) fell outside the detected rows.')
    return Grid(col_x=col_x, row_y=row_y, header_top=(ys[start - 1] if start > 0 else 0), notes=notes)


def separator_present(horiz: np.ndarray, x0: int, x1: int, y: int, band: int = 5, coverage: float = 0.55) -> bool:
    """Is a horizontal line drawn across (most of) the column at height y?"""
    strip = horiz[max(0, y - band):y + band + 1, x0 + 4:x1 - 3] > 0
    if strip.size == 0:
        return False
    return float(strip.any(axis=0).mean()) >= coverage


# ---------------------------------------------------------------------------------------------------------------
# The extractor
# ---------------------------------------------------------------------------------------------------------------
def extract_page(img: np.ndarray, debug_dir: str | None = None) -> dict:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    angle = estimate_skew(binarise(gray))
    img = rotate(img, angle)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    bw = binarise(gray)
    horiz, vert = line_masks(bw)
    # Ink = dark pixels that are not part of a table line. An empty cell has none, so it is never sent to OCR.
    text_ink = cv2.bitwise_and(bw, cv2.bitwise_not(cv2.dilate(horiz | vert, np.ones((3, 3), np.uint8), iterations=2)))
    grid = detect_grid(bw, gray)
    warnings: list[dict] = [{'code': 'GRID', 'message': n} for n in grid.notes]
    if abs(angle) >= 0.02:
        warnings.append({'code': 'SKEW_CORRECTED', 'message': f'The scan was rotated by {angle:.2f} degrees.'})

    # Check the day headings in the row above the grid.
    top = grid.row_y[0]
    header_ok = True
    for d, name in enumerate(DAY_COLUMNS):
        cx0, cx1 = grid.col_x[d + 1], grid.col_x[d + 2]
        crop = img[(grid.header_top or top - 60) + 6:top - 5, cx0 + 8:cx1 - 8]
        text, _, _ = ocr(crop, psm=7, scale=3.0)
        if name[:3] not in re.sub(r'[^A-Z]', '', text.upper()):
            header_ok = False
            warnings.append({'code': 'DAY_HEADING', 'message': f'Column {d + 1} was expected to be {name} but reads "{clean_text(text)}".'})
    day_labels_ok = header_ok

    classes, hours = [], []
    for d, name in enumerate(DAY_COLUMNS):
        cx0, cx1 = grid.col_x[d + 1], grid.col_x[d + 2]
        seps = [separator_present(horiz, cx0, cx1, grid.row_y[k + 1]) for k in range(ROW_COUNT - 1)]
        for first, last in cells_from_separators(seps):
            y0, y1 = grid.row_y[first], grid.row_y[last + 1]
            if INK_EMPTY > (text_ink[y0 + 6:y1 - 5, cx0 + 8:cx1 - 7] > 0).mean():
                continue  # nothing is written in this cell
            crop = img[y0 + 5:y1 - 4, cx0 + 6:cx1 - 5]
            text, conf, _ = ocr(crop, psm=6, scale=2.0)
            parsed = parse_cell_text(text)
            if parsed['kind'] == 'empty' or (parsed['kind'] == 'class' and len(re.findall(r'[A-Za-z]', text)) < 4):
                # Something is drawn here but it could not be read. Never drop it silently.
                parsed = {'kind': 'class', 'subject': '', 'section': '', 'room': ''}
                conf = min(conf, 1.0)
            start, end = block_times(first, last)
            base = {'dayOfWeek': DAY_NUMBER[name], 'startTime': start, 'endTime': end,
                    'confidence': round(conf, 1), 'rawText': clean_text(text).replace('\n', ' / '),
                    'cell': {'x': cx0, 'y': y0, 'w': cx1 - cx0, 'h': y1 - y0}}
            review = []
            if conf < LOW_CONFIDENCE:
                review.append(f'Low OCR confidence ({conf:.0f}).')
            if parsed['kind'] == 'consultation':
                hours.append({**base, 'label': parsed['label'], 'needsReview': bool(review), 'reviewReasons': review})
            else:
                if not parsed['section'] or not parsed['room']:
                    review.append('Section or room not found in the cell.')
                if (last - first + 1) > 8:
                    review.append('Unusually long block (4 hours or more): check that two classes were not merged.')
                classes.append({**base, 'subject': parsed['subject'], 'section': parsed['section'], 'room': parsed['room'],
                                'needsReview': bool(review), 'reviewReasons': review})

    # Document details (header above the table, footer below it).
    head_text, head_conf, _ = ocr(img[max(0, top - 140):top - 3, :], psm=6, scale=1.0)
    meta = parse_header_text(head_text)
    bottom = grid.row_y[-1]
    foot_text, _, _ = ocr(img[bottom:, :], psm=4, scale=1.0)
    meta.update(parse_footer_text(foot_text))
    sig_text, _, _ = ocr(img[bottom + 60:bottom + 330, :], psm=6, scale=1.0)
    who = parse_faculty_name(sig_text)
    meta['facultyName'] = who['name']
    meta['facultyNameHint'] = who['hint']
    for key, label in (('term', 'Term'), ('academicYear', 'Academic year'), ('effectivityDate', 'Effectivity date')):
        if not meta.get(key):
            warnings.append({'code': 'META_MISSING', 'message': f'{label} could not be read. Enter it during review.'})
    # The faculty identity is never trusted from OCR: signatures cover the printed name. A person must confirm it.
    warnings.append({'code': 'FACULTY_IDENTITY',
                     'message': 'The faculty name is covered by a signature and cannot be trusted from OCR'
                                + (f' (fragment read: "{meta["facultyNameHint"]}")' if meta.get('facultyNameHint') else ' (nothing readable)')
                                + '. Confirm it matches the selected account before activating.'})

    normalise_rooms(classes)
    total_hours = sum(_hours_between(c['startTime'], c['endTime']) for c in classes)
    result = {
        'parserVersion': PARSER_VERSION,
        'document': meta,
        'classes': classes,
        'consultationHours': hours,
        'summary': {'classBlocks': len(classes), 'consultationBlocks': len(hours),
                    'teachingHoursInGrid': round(total_hours, 2),
                    'consultationHoursInGrid': round(sum(_hours_between(h_['startTime'], h_['endTime']) for h_ in hours), 2)},
        'warnings': warnings,
        'status': 'NEEDS_REVIEW',  # the OCR never activates anything
        'dayHeadingsRead': day_labels_ok,
    }
    if debug_dir:
        write_debug(img, grid, classes, hours, debug_dir)
    return result


def _hours_between(start: str, end: str) -> float:
    sh, sm = map(int, start.split(':'))
    eh, em = map(int, end.split(':'))
    return ((eh * 60 + em) - (sh * 60 + sm)) / 60


def write_debug(img: np.ndarray, grid: Grid, classes: list, hours: list, out_dir: str) -> None:
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    vis = img.copy()
    for x in grid.col_x:
        cv2.line(vis, (x, grid.row_y[0]), (x, grid.row_y[-1]), (255, 0, 0), 2)
    for y in grid.row_y:
        cv2.line(vis, (grid.col_x[0], y), (grid.col_x[-1], y), (255, 0, 0), 1)
    for b, color in [(c, (0, 140, 0)) for c in classes] + [(h_, (0, 0, 220)) for h_ in hours]:
        c = b['cell']
        cv2.rectangle(vis, (c['x'] + 3, c['y'] + 3), (c['x'] + c['w'] - 3, c['y'] + c['h'] - 3), color, 3)
        cv2.putText(vis, f"{b['startTime']}-{b['endTime']}", (c['x'] + 8, c['y'] + 36), cv2.FONT_HERSHEY_SIMPLEX, 1.0, color, 2)
    cv2.imwrite(str(Path(out_dir) / 'grid_overlay.png'), cv2.resize(vis, None, fx=0.5, fy=0.5))


def extract_pdf(path: str, debug_dir: str | None = None) -> dict:
    if not Path(path).is_file():
        raise ExtractionError(f'File not found: {path}')
    with open(path, 'rb') as f:
        if f.read(5) != b'%PDF-':
            raise ExtractionError('Not a PDF file (missing the %PDF- signature).')
    pages = render_pdf(path)
    if not pages:
        raise ExtractionError('The PDF has no pages.')
    result = extract_page(pages[0], debug_dir)
    if len(pages) > 1:
        result['warnings'].append({'code': 'EXTRA_PAGES', 'message': f'The PDF has {len(pages)} pages; only page 1 was read.'})
    return result


def compare_with_expected(draft: dict, expected: dict) -> dict:
    """
    Compare a draft with known-good data shaped like backend/utils/demoSchedules.js:
    {classes: [{dayOfWeek, startTime, endTime, room, subject}], hours: [{dayOfWeek, startTime, endTime}]}.
    Matching is on day, start and end (the part that decides conflicts and bookings); room and subject are compared on top.
    """
    def key(b): return (b['dayOfWeek'], b['startTime'], b['endTime'])
    got = {key(c): c for c in draft['classes']}
    want = {key(c): c for c in expected['classes']}
    got_h = {key(h) for h in draft['consultationHours']}
    want_h = {key(h) for h in expected['hours']}
    norm = lambda t: re.sub(r'[^a-z0-9]', '', t.lower())
    room_diff, subject_diff = [], []
    for k in want.keys() & got.keys():
        if norm(got[k]['room']) != norm(want[k]['room']):
            room_diff.append({'at': k, 'read': got[k]['room'], 'expected': want[k]['room']})
        # the expected subject carries the section in brackets: "Subject (BSIT 3-D)"
        exp_subject = norm(re.sub(r'\s*\([^()]*\)\s*$', '', want[k]['subject']))
        if norm(got[k]['subject']) != exp_subject or norm(got[k]['section']) not in norm(want[k]['subject']):
            subject_diff.append({'at': k, 'read': f"{got[k]['subject']} ({got[k]['section']})", 'expected': want[k]['subject']})
    return {'classesMissing': sorted(want.keys() - got.keys()), 'classesExtra': sorted(got.keys() - want.keys()),
            'hoursMissing': sorted(want_h - got_h), 'hoursExtra': sorted(got_h - want_h),
            'roomDifferences': room_diff, 'subjectDifferences': subject_diff,
            'matched': len(want.keys() & got.keys()), 'expectedClasses': len(want)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='Extract a draft schedule from a scanned Faculty Individual Load PDF.')
    ap.add_argument('pdf')
    ap.add_argument('--out', help='write the draft JSON here (default: print)')
    ap.add_argument('--debug-dir', help='also write grid_overlay.png here')
    ap.add_argument('--expected', help='JSON file of known-good blocks ({classes, hours}); prints a comparison')
    args = ap.parse_args(argv)
    try:
        result = extract_pdf(args.pdf, args.debug_dir)
    except ExtractionError as e:
        print(f'ERROR: {e}', file=sys.stderr)
        return 2
    if args.expected:
        result['comparison'] = compare_with_expected(result, json.loads(Path(args.expected).read_text(encoding='utf-8')))
    text = json.dumps(result, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(text, encoding='utf-8')
        print(f'Wrote {args.out}: {result["summary"]["classBlocks"]} class blocks, {result["summary"]["consultationBlocks"]} consultation blocks, {len(result["warnings"])} warning(s).')
    else:
        print(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
