#!/usr/bin/env python3
"""
CCIS SYNC - Faculty Schedule PDF Importer, Phase 3: OCR / table-extraction PROTOTYPE.

Reads a scanned "Faculty Individual Load" (VAA-FM-061) PDF and prints a structured DRAFT as JSON.
It never touches the database and never activates a schedule; the output is only meant to be reviewed
(Phase 4) and confirmed by a signed-in user (Phase 6).

Pipeline: render (pdftoppm, or PyMuPDF if installed) -> deskew -> detect grid lines (OpenCV) ->
          merge rows without a separating line into ONE cell -> OCR each filled cell (Tesseract) ->
          parse to continuous blocks -> flag anything uncertain.

Day convention is the repository's: Sunday = 0 ... Saturday = 6 (the sheet is Monday-first).
Usage: python3 ocr/schedule_ocr.py <file.pdf> [--dpi 300] [--debug-dir DIR] > draft.json
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tempfile
from datetime import datetime

import cv2
import numpy as np
import pytesseract

PARSER_VERSION = 'vaa-fm-061/0.1.0'
SHEET_DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
SHEET_DAY_TO_DB = [1, 2, 3, 4, 5, 6, 0]       # sheet column -> stored dayOfWeek
DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
FIRST_ROW_MIN = 7 * 60                          # 07:00
ROWS = 24                                       # 07:00 .. 19:00 in 30-minute rows (the most a class may use)
MIN_ROWS = 12                                   # a sheet may stop earlier (Silva's ends 5:30 PM = 21 rows); fewer than this is not the form
WORD_CONF = 50.0                                # any printed word below this inside a cell => that cell is flagged
CELL_SCALE = float(os.environ.get('OCR_CELL_SCALE', 3.5))                                # small print: enlarge cells before OCR (measured: 1.5x read 6/19 of the Fortaleza cells exactly, 3.5x about twice as many)
LOW_CONF = 75.0                                 # Tesseract word confidence below this => review


def hhmm(minutes):
    return f'{minutes // 60:02d}:{minutes % 60:02d}'


# ---------- 1. render ----------
def render_pdf(pdf, dpi, outdir):
    try:
        import fitz  # PyMuPDF, the plan's preferred renderer
        doc = fitz.open(pdf)
        pix = doc[0].get_pixmap(dpi=dpi)
        path = os.path.join(outdir, 'page-1.png')
        pix.save(path)
        return path, doc.page_count, 'pymupdf'
    except ImportError:
        pass
    if not shutil.which('pdftoppm'):
        raise RuntimeError('Need PyMuPDF or poppler (pdftoppm) to render the PDF')
    subprocess.run(['pdftoppm', '-r', str(dpi), '-png', '-f', '1', '-l', '1', pdf, os.path.join(outdir, 'page')], check=True)
    png = sorted(f for f in os.listdir(outdir) if f.startswith('page') and f.endswith('.png'))[0]
    pages = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout).group(1))
    return os.path.join(outdir, png), pages, 'pdftoppm'


# ---------- 2. preprocess ----------
def binarize(gray):
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 15)


def line_mask(binary, horizontal, length):
    k = (length, 1) if horizontal else (1, length)
    return cv2.morphologyEx(binary, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, k))


def deskew(gray):
    b = binarize(gray)
    h = line_mask(b, True, 300)
    lines = cv2.HoughLinesP(h, 1, np.pi / 1800, 200, minLineLength=1500, maxLineGap=20)
    if lines is None:
        return gray, 0.0
    ang = np.median([np.degrees(np.arctan2(y2 - y1, x2 - x1)) for x1, y1, x2, y2 in lines.reshape(-1, 4)])
    if abs(ang) < 0.02 or abs(ang) > 3:
        return gray, float(ang)
    hh, ww = gray.shape
    m = cv2.getRotationMatrix2D((ww / 2, hh / 2), ang, 1.0)
    return cv2.warpAffine(gray, m, (ww, hh), flags=cv2.INTER_CUBIC, borderValue=255), float(ang)


def cluster(idx, gap=5):
    groups = []
    for i in idx:
        if groups and i - groups[-1][-1] <= gap:
            groups[-1].append(i)
        else:
            groups.append([i])
    return [int(round(np.mean(g))) for g in groups]


# ---------- 3. grid ----------
TIME_LABEL_RE = re.compile(r'^\s*(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})')
TIME_LABEL_SEARCH_RE = re.compile(r'(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})')


def vertical_extent(vmask, x):
    ys = np.where(vmask[:, max(0, x - 2):x + 3].max(axis=1) > 0)[0]
    return (int(ys.min()), int(ys.max())) if len(ys) else (0, 0)


def read_time_label(gray, xs, y0, y1):
    crop = gray[y0 + 6:y1 - 6, xs[0] + 8:xs[1] - 8]
    if crop.size == 0:
        return None
    crop = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    txt = pytesseract.image_to_string(crop, config='--psm 7 -c tessedit_char_whitelist=0123456789:-')
    # A cell border can leak a stray digit in front ("410:30-11:00"): search for the label instead of requiring it at the start.
    m = TIME_LABEL_SEARCH_RE.search(txt)
    return m.group(0) if m else None


def find_grid(binary, gray, dpi):
    """Returns (xs, ys, hmask, header_top, labels).
    xs: 9 vertical edges (time + 7 days). ys: the row edges read from the TIME column (rows may differ in height, and the
    number of rows is read from the printed time labels: 24 rows 07:00-19:00, or 25 when the sheet prints 7:00-7:30 PM too)."""
    s = dpi / 300.0
    v = line_mask(binary, False, int(100 * s))
    h = line_mask(binary, True, int(150 * s))
    cand = cluster(np.where(v.sum(axis=0) / 255 > 600 * s)[0])
    # A page-edge shadow or a fold is also a long vertical line; table lines all start and end where the table does.
    ext = {x: vertical_extent(v, x) for x in cand}
    spans = sorted(e[1] - e[0] for e in ext.values())
    typical = spans[len(spans) // 2] if spans else 0
    starts = sorted(e[0] for e in ext.values())
    top = starts[len(starts) // 2] if starts else 0
    # Table lines all begin where the table begins and are not much longer than the typical one. A scan-edge line (page border, fold, shadow)
    # fails one of the two: it can be longer (right edge) or start far from the table top (left edge of a scan, seen on the Silva sheet).
    vx = [x for x in cand if ext[x][1] - ext[x][0] <= typical * 1.25 and abs(ext[x][0] - top) <= 60 * s]
    if len(vx) != 9:
        raise ValueError(f'expected 9 vertical grid lines (time + 7 days), found {len(vx)}: template not recognised')
    band = h[:, vx[0] + 10:vx[1] - 10]                      # the TIME column: every row has its own line
    ys_all = [y for y in cluster(np.where(band.sum(axis=1) / 255 > 0.8 * (vx[1] - vx[0] - 20))[0]) if y > 20 * s]
    if len(ys_all) < 4:
        raise ValueError('could not find the row lines of the time column: template not recognised')
    header_top, edges = ys_all[0], ys_all[1:]                 # edges[0] is the bottom of the header row
    labels, n = [], 0
    for k in range(len(edges) - 1):                           # rows are the intervals that carry a time label; the footer rows do not
        lab = read_time_label(gray, vx, edges[k], edges[k + 1])
        if not lab:
            break
        labels.append(lab); n += 1
    if n < MIN_ROWS:
        raise ValueError(f'expected at least {MIN_ROWS} time-labelled rows, read {n}: template not recognised')
    return vx, edges[:n + 1], h, header_top, labels


def boundary_present(hmask, x0, x1, y, inset=0.12, tol=6):
    w = x1 - x0
    a, b = int(x0 + w * inset), int(x1 - w * inset)
    strip = hmask[max(0, y - tol):y + tol + 1, a:b]
    return (strip.max(axis=0) > 0).mean() > 0.6


def day_cells(hmask, x0, x1, ys):
    """Group the rows of one day column into cells: rows with NO line between them are one merged cell."""
    n = len(ys) - 1
    cells, start = [], 0
    for r in range(1, n):
        if boundary_present(hmask, x0, x1, ys[r]):
            cells.append((start, r))
            start = r
    cells.append((start, n))
    return cells


# ---------- 4. OCR ----------
def ocr_cell(gray, x0, x1, y0, y1, pad=8):
    """OCR one cell. Returns (text, mean confidence, word count, handwriting) where handwriting lists short numeric
    scribbles (hours written next to a class by hand) that were left out of the text instead of being read as part of it."""
    crop = gray[y0 + pad:y1 - pad, x0 + pad:x1 - pad]
    if crop.size == 0:
        return '', 0.0, 0, [], 0.0
    crop = cv2.resize(crop, None, fx=CELL_SCALE, fy=CELL_SCALE, interpolation=cv2.INTER_CUBIC)
    crop = cv2.copyMakeBorder(crop, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)
    d = pytesseract.image_to_data(crop, config='--psm 6', output_type=pytesseract.Output.DICT)
    lines = {}
    for t, c, b, p, l, x, w, h in zip(d['text'], d['conf'], d['block_num'], d['par_num'], d['line_num'], d['left'], d['width'], d['height']):
        if t.strip() and float(c) >= 0:
            lines.setdefault((b, p, l), []).append((x, w, h, t, float(c)))
    handwriting, kept, confs, solid = [], [], [], []
    for words in lines.values():
        words.sort()
        # a short number set well apart from the printed words of its line is handwriting ("2", "1.5"), not part of the room
        if len(words) >= 2:
            x, w, h, t, c = words[-1]
            px, pw = words[-2][0], words[-2][1]
            if re.fullmatch(r'[\d.,]{1,4}', t) and x - (px + pw) > 1.2 * h:
                handwriting.append(t)
                words = words[:-1]
        kept.append(' '.join(wd[3] for wd in words))
        confs += [wd[4] for wd in words]
        solid += [wd[4] for wd in words if len(re.findall(r'[A-Za-z0-9]', wd[3])) >= 2 and not re.fullmatch(r'[lLiI1|!]{1,3}CT', wd[3])]   # one-character tokens (a bar, a speck) and the I/l-confusable room prefix (handled by clean_room) do not decide the minimum
    return '\n'.join(kept), (float(np.mean(confs)) if confs else 0.0), len(confs), handwriting, (float(min(solid)) if solid else 0.0)


def has_ink(binary, hmask, x0, x1, y0, y1, pad=8):
    region = binary[y0 + pad:y1 - pad, x0 + pad:x1 - pad]
    return region.size > 0 and (region > 0).sum() > 150


def clean(s):
    return re.sub(r'\s+', ' ', s.replace('–', '-').replace('—', '-')).strip()


ROOM_RE = re.compile(r'((?:I{1,2}CT|ICT|LAB|NEW|OLD)\s*[A-Za-z]*\s*\d{0,3}\s*[A-Z]?(?:\s*\(LAB\))?)\s*$', re.I)
SECTION_RE = re.compile(r'\b((?:[A-Z]{1,3}\s+)?[A-Z]{2,6}\s*\d-[A-Z])\b')   # BSIT 3-D, SC BSCD 1-C


# Third layout (Silva sheet): the title wraps over one or two lines and the LAST line is "<section> - <room>", e.g. "BSCS 3B-SE - IICT 106".
# The room must start like a real room (I/II/lII + CT, TBA, ...Library) so the section-only and "|" layouts can never be taken for it.
SECTION_DASH_RE = re.compile(r'((?:[A-Z]{2,6}\s+)?[A-Z]{2,6}\s*\d[A-Z]?(?:-[A-Z]{1,4})?)\s*[-\u2013\u2014]\s*((?:[lLiI1|!]{1,3}CT\b|TBA\b|[A-Za-z ]*Library\b).*)$')


def tidy(t):
    """Drop stray symbols (a speck or border piece read as a character) from the ends of a printed line."""
    return re.sub(r"^[^A-Za-z0-9(]+|[^A-Za-z0-9)]+$", '', re.sub(r'\s[^A-Za-z0-9(]{1,3}(?=\s|$)', '', t)).strip()


ROOM_SHAPE = re.compile(r'^(?:I{1,2}CT \d{3}(?: [A-Z])?(?: \(LAB\)?)?|TBA(?: \(LAB\)?)?|[A-Za-z ]*Library)$')


def clean_room(raw):
    """Normalise spacing only; never invent characters. Anything that is not a known room shape is flagged for review."""
    room = re.sub(r'^[lLiI1|!]{1,3}(?=CT\b)', lambda m: 'II' if len(m.group(0)) >= 2 else 'I', tidy(raw))   # every room prefix on the sheet is I or II
    room = re.sub(r'(?<=\d)(?=[A-Z]\b)', ' ', room)                 # 101A -> 101 A
    room = re.sub(r'\s+', ' ', room).strip()
    flags = []
    m = re.match(r'^((?:I{1,2}CT \d{3}(?: [A-Z])?(?: \(LAB\)?)?|TBA(?: \(LAB\)?)?))\s+\S{1,3}$', room)
    if m:                                                            # a handwritten scribble right after a complete room
        room = m.group(1)
        flags.append('trailing-marks-removed')
    if re.match(r'^ICT\b', room):
        flags.append('room-prefix-check')                            # OCR often drops one glyph of "IICT"; real "ICT" rooms exist too
    elif not ROOM_SHAPE.match(room):
        flags.append('room-check')
    return (room or None), flags


def parse_teaching(text):
    """'INFOT 8 - Platform Technologies / BSIT 3-D | IICT 306' -> dict. Returns flags for unparsed parts."""
    lines = [clean(l) for l in text.split('\n') if clean(l)]
    flags = []
    if len(lines) < 2:
        return {'courseTitle': clean(text), 'section': None, 'room': None}, ['unrecognised-cell-layout']
    title = lines[0]
    m3 = SECTION_DASH_RE.search(lines[-1])        # a stray "|" from a cell border may be in the text: the strict room prefix is the guard
    if m3:
        room, rflags = clean_room(m3.group(2))
        title = tidy(' '.join(lines[:-1]))
        title = re.sub(r'(?<=[A-Za-z])(?=\d+$)', ' ', title)          # "ENGINEERING2" -> "ENGINEERING 2" (spacing only)
        return {'courseTitle': title, 'section': re.sub(r'\s+', ' ', m3.group(1)), 'room': room}, rflags
    if len(lines) >= 3 and '|' not in ' '.join(lines):
        # second layout: title / section / room on three separate lines (no "|"). Stray marks around the printed words are dropped.
        m = SECTION_RE.search(lines[1])
        if not m:
            return {'courseTitle': tidy(title), 'section': None, 'room': None}, ['unrecognised-cell-layout']
        room, rflags = clean_room(' '.join(lines[2:]))
        return {'courseTitle': tidy(title), 'section': re.sub(r'\s+', ' ', m.group(1)), 'room': room}, rflags
    rest = ' '.join(lines[1:])
    rest = re.sub(r'\s*[|\[!lI]\s+(?=\S)', ' | ', rest, count=1) if '|' not in rest else rest
    section = room = None
    if '|' in rest:
        left, right = [p.strip() for p in rest.split('|', 1)]
        section, room = left or None, right or None
    else:
        m = SECTION_RE.search(rest)
        if m:
            section = m.group(1)
            room = rest[m.end():].strip(' |') or None
    if room:
        room = re.sub(r'^[lLiI1|!]{1,3}(?=CT\b)', lambda m: 'II' if len(m.group(0)) >= 2 else 'I', room)
        if re.match(r'^ICT\b', room):
            # OCR often drops one glyph of "IICT"; real "ICT" rooms exist too, so ask a human instead of guessing
            flags.append('room-prefix-check')
    if not section:
        flags.append('section-not-read')
    if not room:
        flags.append('room-not-read')
    return {'courseTitle': title, 'section': section, 'room': room}, flags


# ---------- 5. header / footer ----------
MONTHS = {m: i for i, m in enumerate(['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'], 1)}


def read_region(gray, y0, y1, psm=6):
    crop = gray[max(0, y0):y1]
    d = pytesseract.image_to_data(crop, config=f'--psm {psm}', output_type=pytesseract.Output.DICT)
    confs = [float(c) for t, c in zip(d['text'], d['conf']) if t.strip() and float(c) >= 0]
    return pytesseract.image_to_string(crop, config=f'--psm {psm}'), (float(np.mean(confs)) if confs else 0.0)


NAME_RE = re.compile(r"^[A-Z]{3,}[A-Za-z .'\-]{3,}[, ]\s*(?:MIT|MSIT|MS|MBA|MAEd|DIT|LPT|PhD|DBA|EdD)\.?$", re.I)   # printed-name shape; garbled reads still qualify but stay flagged
NAME_CONF_OK = 90.0


def term_name(raw):
    """'SecondSemester' -> 'Second Semester'; '2nd Semester' printed with a superscript (read as 2\" or 2nd) -> 'Second Semester'."""
    t = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', raw.strip())
    m = re.match(r'^([123])\W{0,2}(?:st|nd|rd|d)?\s*(Semester|Term)$', t, re.I)
    if m:
        return f"{ {'1': 'First', '2': 'Second', '3': 'Third'}[m.group(1)] } {m.group(2).title()}"
    return t


def read_faculty_name(gray, y_from, x_left, x_right):
    """Printed-name extraction (never signature recognition). The VAA-FM-061 footer has four signature blocks; the faculty
    member's printed name is the line above "Faculty Member" in block 2 ("Acknowledged by"). That block is cropped on its own,
    OCR'd under three preprocessings and EVERY candidate is kept. The name is only trusted when >=2 independent reads agree
    exactly with high word confidence; otherwise the best read is kept as-is (never "corrected") and stays flagged."""
    w = x_right - x_left
    bx0, bx1 = int(x_left + w * 0.235), int(x_left + w * 0.475)
    block = gray[y_from:, bx0:bx1]
    variants = {'raw': block,
                'otsu': cv2.threshold(block, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1],
                'dark': np.where(block < 110, 0, 255).astype('uint8')}
    cands = []
    for vname, img in variants.items():
        d = pytesseract.image_to_data(img, config='--psm 6', output_type=pytesseract.Output.DICT)
        lines = {}
        for t, c, b, p, l, x, y in zip(d['text'], d['conf'], d['block_num'], d['par_num'], d['line_num'], d['left'], d['top']):
            if t.strip() and float(c) >= 0:
                lines.setdefault((b, p, l), []).append((x, y, t, float(c)))
        for words in lines.values():
            words.sort()
            text = clean(' '.join(wd[2] for wd in words))
            if NAME_RE.match(text):
                cands.append({'text': text, 'confidence': round(float(np.mean([wd[3] for wd in words])), 1),
                              'variant': vname, 'bbox': [int(bx0 + words[0][0]), int(y_from + words[0][1])]})
    out = {'facultyName': None, 'facultyNameConfidence': None, 'facultyNameSource': 'printed_text',
           'facultyNameNeedsReview': True, 'facultyNameCandidates': cands}
    if cands:
        best = max(cands, key=lambda c: c['confidence'])
        out['facultyName'], out['facultyNameConfidence'] = best['text'], best['confidence']
        agree = sum(1 for c in cands if c['text'] == best['text'])
        out['facultyNameNeedsReview'] = not (agree >= 2 and best['confidence'] >= NAME_CONF_OK)
    return out


def parse_metadata(gray, grid_top, grid_bottom, x_left, x_right):
    warnings = []
    head, hc = read_region(gray, grid_top - 150, grid_top - 4, 6)
    foot, fc = read_region(gray, grid_bottom - 30, gray.shape[0], 4)
    flat = clean(head + ' ' + foot)
    md = {'formId': None, 'term': None, 'academicYear': None, 'effectivityDate': None}
    m = re.search(r'VAA-FM-\d+', flat)
    md['formId'] = m.group(0) if m else None
    m = re.search(r'Term:?\s*(.+?)\s+A\.?\s?Y\.?:?\s*(\d{4})\s*-\s*(\d{4})', flat, re.I)
    if m:
        md['term'], md['academicYear'] = term_name(m.group(1)), f'{m.group(2)}-{m.group(3)}'
    m = re.search(r'Effectivity Date:?\s*([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})', flat, re.I)
    if m and m.group(1).upper() in MONTHS:
        md['effectivityDate'] = f'{int(m.group(3)):04d}-{MONTHS[m.group(1).upper()]:02d}-{int(m.group(2)):02d}'
    # the faculty name is the bold underlined line directly above "Faculty Member"
    md.update(read_faculty_name(gray, grid_bottom + 20, x_left, x_right))
    for k in ('formId', 'term', 'academicYear', 'effectivityDate', 'facultyName'):
        if not md.get(k):
            warnings.append({'code': 'metadata-missing', 'field': k, 'message': f'{k} was not read from the document; enter or confirm it manually'})
    if hc < LOW_CONF:
        warnings.append({'code': 'low-confidence', 'field': 'header', 'message': f'header OCR confidence {hc:.0f}%'})
    if md['facultyNameNeedsReview']:
        warnings.append({'code': 'faculty-name-needs-review', 'message': 'printed faculty name missing, low-confidence or covered by a signature; identity must be verified by a person before confirmation'})
    md['headerConfidence'] = round(hc, 1)
    workload = {}
    for key, pat in (('lectureHours', r'Lecture Hours:?\s*(\d+(?:\.\d+)?)'), ('laboratoryHours', r'Laboratory Hours:?\s*(\d+(?:\.\d+)?)'),
                     ('totalHours', r'Total Hours:?\s*(\d+(?:\.\d+)?)'), ('preparations', r'No\. of Preparations:?\s*(\d+)'),
                     ('overload', r'Overload:?\s*(\d+(?:\.\d+)?)')):
        m = re.search(pat, flat, re.I)
        workload[key] = float(m.group(1)) if m else None
    return md, workload, warnings


# ---------- 6. main extraction ----------
def extract(pdf_path, dpi=300, debug_dir=None):
    with open(pdf_path, 'rb') as f:
        raw = f.read()
    if raw[:5] != b'%PDF-':
        raise ValueError('not a PDF (bad file signature)')
    with tempfile.TemporaryDirectory() as tmp:
        png, pages, renderer = render_pdf(pdf_path, dpi, tmp)
        gray = cv2.imread(png, cv2.IMREAD_GRAYSCALE)
    gray, angle = deskew(gray)
    binary = binarize(gray)
    xs, ys, hmask, header_top, labels = find_grid(binary, gray, dpi)
    warnings = []
    if pages > 1:
        warnings.append({'code': 'extra-pages', 'message': f'{pages} pages; only page 1 was read'})

    for r, lab in enumerate(labels):                        # the printed labels carry no AM/PM: 1:00-6:30 are afternoon
        m = TIME_LABEL_RE.match(lab)
        hh = int(m.group(1)) % 12
        hh = hh + 12 if hh < 7 else hh
        if hh == 7 and r >= 12:
            hh = 19                                          # the second "7:00" of the sheet is 7 PM
        eh = int(m.group(3)) % 12
        eh = eh + 12 if eh < 7 else eh
        if eh == 7 and r >= 12:
            eh = 19
        expected = FIRST_ROW_MIN + r * 30
        # a stray border digit can ruin the start ("41:30-12:00"); the label is still corroborated when its END is the expected one
        if hh * 60 + int(m.group(2)) != expected and eh * 60 + int(m.group(4)) != expected + 30:
            warnings.append({'code': 'time-axis-unverified', 'row': r, 'message': f'time label of row {r} read as {lab!r}; row-to-time mapping assumed from position'})
    if len(ys) - 1 > ROWS:
        warnings.append({'code': 'rows-after-7pm', 'message': f'the sheet has {len(ys) - 1 - ROWS} row(s) after 7:00 PM; anything written there is flagged because classes must end by 7:00 PM'})
    ignored = []
    classes, consults = [], []
    for col in range(1, 8):
        x0, x1 = xs[col], xs[col + 1]
        db_day = SHEET_DAY_TO_DB[col - 1]
        for r0, r1 in day_cells(hmask, x0, x1, ys):
            y0, y1 = ys[r0], ys[r1]
            if not has_ink(binary, hmask, x0, x1, y0, y1):
                continue                                   # empty rows stay as gaps
            text, conf, nwords, hand, minconf = ocr_cell(gray, x0, x1, y0, y1)
            start, end = FIRST_ROW_MIN + r0 * 30, FIRST_ROW_MIN + r1 * 30
            if not re.search(r'[A-Za-z]{3,}', text):
                # only digits or marks: a handwritten hour count or a smudge, not a class. Reported, never silently dropped.
                ignored.append(f'{DAY_LABELS[db_day]} {hhmm(start)}-{hhmm(end)}: {clean(text) or "marks"}')
                continue
            base = {'dayOfWeek': db_day, 'startTime': hhmm(start), 'endTime': hhmm(end),
                    'confidence': round(conf, 1), 'bbox': [int(x0), int(y0), int(x1), int(y1)], 'flags': []}
            if re.search(r'consult', text, re.I):
                base['label'] = 'CONSULTATION HOURS'
                consults.append(base)
                continue
            parsed, flags = parse_teaching(text)
            base.update(parsed)
            base['flags'] += flags
            base['rawText'] = clean(text)
            if hand:
                base['handwrittenIgnored'] = hand
            if end > 19 * 60:
                base['flags'].append('after-7pm')
            if conf < LOW_CONF:
                base['flags'].append('low-confidence')
            base['minWordConfidence'] = round(minconf, 1)
            if minconf < WORD_CONF:
                base['flags'].append('uncertain-characters')
            if r1 - r0 == 1 and nwords == 0:
                base['flags'].append('no-text')
            classes.append(base)

    for c in classes:
        sec = f" ({c['section']})" if c.get('section') else ''
        c['subject'] = f"{c['courseTitle']}{sec}"
        c['needsReview'] = bool(c['flags'])
    for c in classes:                                       # same-day overlap would be a hard error in classBlock.js
        for o in classes:
            if o is not c and o['dayOfWeek'] == c['dayOfWeek'] and o['startTime'] < c['endTime'] and c['startTime'] < o['endTime']:
                c['flags'].append('overlap'); c['needsReview'] = True

    md, workload, w = parse_metadata(gray, header_top, ys[-1], xs[0], xs[-1])
    warnings += w
    if ignored:
        warnings.append({'code': 'ignored-marks', 'message': 'Left out because they are not classes (handwritten numbers or marks): ' + '; '.join(ignored)})
    hours = sum((int(c['endTime'][:2]) * 60 + int(c['endTime'][3:]) - int(c['startTime'][:2]) * 60 - int(c['startTime'][3:])) for c in classes) / 60
    workload['extractedTeachingHours'] = hours
    if workload.get('lectureHours') is not None and workload.get('laboratoryHours') is not None:
        workload['reconciles'] = abs(hours - (workload['lectureHours'] + workload['laboratoryHours'])) < 0.01
        if not workload['reconciles']:
            warnings.append({'code': 'workload-mismatch', 'message': f"extracted teaching hours {hours:g} != lecture+laboratory {workload['lectureHours'] + workload['laboratoryHours']:g}"})
    result = {
        'parserVersion': PARSER_VERSION, 'template': 'VAA-FM-061', 'status': 'DRAFT_NEEDS_REVIEW',
        'source': {'sha256': hashlib.sha256(raw).hexdigest(), 'pages': pages, 'dpi': dpi, 'renderer': renderer, 'deskewDegrees': round(angle, 3)},
        'metadata': md, 'workload': workload,
        'classes': sorted(classes, key=lambda c: (c['dayOfWeek'] or 7, c['startTime'])),
        'consultationHours': sorted(consults, key=lambda c: (c['dayOfWeek'] or 7, c['startTime'])),
        'warnings': warnings,
    }
    if debug_dir:
        os.makedirs(debug_dir, exist_ok=True)
        vis = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
        for c in classes + consults:
            x0, y0, x1, y1 = c['bbox']
            cv2.rectangle(vis, (x0 + 3, y0 + 3), (x1 - 3, y1 - 3), (0, 0, 255) if c.get('needsReview') else (0, 160, 0), 4)
        cv2.imwrite(os.path.join(debug_dir, 'detected-cells.png'), cv2.resize(vis, None, fx=0.5, fy=0.5))
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdf')
    ap.add_argument('--dpi', type=int, default=300)
    ap.add_argument('--debug-dir')
    a = ap.parse_args()
    try:
        json.dump(extract(a.pdf, a.dpi, a.debug_dir), sys.stdout, indent=2, ensure_ascii=False)
        print()
    except Exception as e:                                  # unsupported layout => explicit failure, never a guess
        json.dump({'parserVersion': PARSER_VERSION, 'status': 'FAILED', 'error': str(e)}, sys.stdout, indent=2)
        print()
        sys.exit(2)


if __name__ == '__main__':
    main()
