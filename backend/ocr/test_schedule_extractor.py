"""
Tests for schedule_extractor.py. Run from backend/ocr:  python3 -m unittest -v test_schedule_extractor

- Pure-logic tests need nothing.
- The synthetic-form test draws a fake VAA-FM-061 table with Pillow and needs Tesseract + OpenCV (skipped if missing).
- The real-scan test needs PERCY_PDF=<path to the scanned PDF> and Node (it compares with backend/utils/demoSchedules.js).
  The real scan is not stored in the repository (it carries signatures).
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import schedule_extractor as S

HAVE_TESSERACT = shutil.which('tesseract') is not None


class PureLogic(unittest.TestCase):
    def test_cells_from_separators_merges_rows_without_a_line(self):
        seps = [True] * 23
        seps[4] = False          # no line between row 4 and row 5 -> one cell
        seps[6] = seps[7] = seps[8] = False   # rows 6-9 -> one cell
        cells = S.cells_from_separators(seps)
        self.assertIn((4, 5), cells)
        self.assertIn((6, 9), cells)
        self.assertEqual(cells[0], (0, 0))
        self.assertEqual(cells[-1], (23, 23))
        self.assertEqual(sum(b - a + 1 for a, b in cells), 24)

    def test_cells_from_separators_no_lines_is_one_cell(self):
        self.assertEqual(S.cells_from_separators([False] * 23), [(0, 23)])

    def test_cells_from_separators_checks_length(self):
        with self.assertRaises(ValueError):
            S.cells_from_separators([True] * 5)

    def test_block_times_are_continuous_half_hour_ranges(self):
        self.assertEqual(S.block_times(0, 0), ('07:00', '07:30'))
        self.assertEqual(S.block_times(15, 16), ('14:30', '15:30'))
        self.assertEqual(S.block_times(14, 16), ('14:00', '15:30'))   # 90 minutes in one block
        self.assertEqual(S.block_times(23, 23), ('18:30', '19:00'))   # the 7 PM boundary
        self.assertEqual(S.block_times(0, 23), ('07:00', '19:00'))

    def test_day_numbers_use_the_javascript_convention(self):
        self.assertEqual(S.DAY_NUMBER['SUNDAY'], 0)
        self.assertEqual(S.DAY_NUMBER['MONDAY'], 1)
        self.assertEqual(S.DAY_NUMBER['SATURDAY'], 6)

    def test_parse_cell_text_class(self):
        got = S.parse_cell_text('INFOT 8 – Platform Technologies\nBSIT 3-D | IICT 306')
        self.assertEqual(got, {'kind': 'class', 'subject': 'INFOT 8 - Platform Technologies', 'section': 'BSIT 3-D', 'room': 'IICT 306'})

    def test_parse_cell_text_strips_border_noise(self):
        got = S.parse_cell_text('_ INFOT 8 - Platform Technologies _\nBSIT 3-B | IICT 307')
        self.assertEqual(got['subject'], 'INFOT 8 - Platform Technologies')

    def test_parse_cell_text_consultation_and_empty(self):
        self.assertEqual(S.parse_cell_text('CONSULTATION HOURS')['kind'], 'consultation')
        self.assertEqual(S.parse_cell_text('  \n ')['kind'], 'empty')

    def test_parse_cell_text_without_a_section_room_line(self):
        got = S.parse_cell_text('Some subject')
        self.assertEqual((got['kind'], got['section'], got['room']), ('class', '', ''))

    def test_parse_header_and_dates(self):
        got = S.parse_header_text('Term: SecondSemester A.Y. 2025-2026 Effectivity Date: MARCH 9, 2026')
        self.assertEqual(got['term'], 'Second Semester')
        self.assertEqual(got['academicYear'], '2025-2026')
        self.assertEqual(got['effectivityDate'], '2026-03-09')
        self.assertIsNone(S.parse_effectivity_date('no date here'))
        self.assertEqual(S.parse_effectivity_date('Feb 2, 2026'), '2026-02-02')

    def test_parse_footer(self):
        got = S.parse_footer_text('Lecture Hours: 6 Laboratory Hours: 9 Total Hours: 28 VAA-FM-061 Rev.2/03-08-22')
        self.assertEqual((got['lectureHours'], got['laboratoryHours'], got['totalHours']), (6.0, 9.0, 28.0))
        self.assertEqual(got['formId'], 'VAA-FM-061')

    def test_faculty_name_is_a_hint_when_covered_by_a_signature(self):
        got = S.parse_faculty_name('CARL SP ARO MIT CARL SP bl rena MIT\nFaculty Member')
        self.assertIsNone(got['name'])
        self.assertTrue(got['hint'].startswith('CARL SP'))

    def test_faculty_name_read_cleanly(self):
        got = S.parse_faculty_name('CARL SPENCE D. PERCY, MIT\nFaculty Member')
        self.assertEqual(got['name'], 'CARL SPENCE D. PERCY, MIT')

    def _rooms(self, rooms):
        return [{'room': r, 'reviewReasons': [], 'needsReview': False} for r in rooms]

    def test_normalise_rooms_fixes_letter_confusion_and_flags_it(self):
        cls = self._rooms(['IICT 306', 'IICT 307', 'IICT 304', 'lICT 108', 'ICT 205'])
        S.normalise_rooms(cls)
        self.assertEqual([c['room'] for c in cls], ['IICT 306', 'IICT 307', 'IICT 304', 'IICT 108', 'IICT 205'])
        self.assertFalse(cls[0]['needsReview'])
        self.assertTrue(cls[3]['needsReview'])
        self.assertEqual(cls[3]['corrections'][0], {'field': 'room', 'from': 'lICT 108', 'to': 'IICT 108'})

    def test_normalise_rooms_leaves_a_real_different_prefix_alone(self):
        cls = self._rooms(['IICT 306', 'IICT 307', 'IICT 304', 'LAB 2'])
        S.normalise_rooms(cls)
        self.assertEqual(cls[3]['room'], 'LAB 2')

    def test_normalise_rooms_needs_enough_evidence(self):
        cls = self._rooms(['IICT 306', 'lICT 307'])
        S.normalise_rooms(cls)
        self.assertEqual(cls[1]['room'], 'lICT 307')

    def test_compare_with_expected(self):
        draft = {'classes': [{'dayOfWeek': 1, 'startTime': '09:00', 'endTime': '10:00', 'room': 'IICT 1', 'subject': 'Math', 'section': 'BSIT 1-A'}],
                 'consultationHours': [{'dayOfWeek': 2, 'startTime': '10:00', 'endTime': '12:00'}]}
        expected = {'classes': [{'dayOfWeek': 1, 'startTime': '09:00', 'endTime': '10:00', 'room': 'IICT 1', 'subject': 'Math (BSIT 1-A)'},
                                {'dayOfWeek': 3, 'startTime': '09:00', 'endTime': '10:00', 'room': 'X', 'subject': 'Y (Z)'}],
                    'hours': [{'dayOfWeek': 2, 'startTime': '10:00', 'endTime': '12:00'}]}
        got = S.compare_with_expected(draft, expected)
        self.assertEqual(got['classesMissing'], [(3, '09:00', '10:00')])
        self.assertEqual(got['subjectDifferences'], [])
        self.assertEqual(got['hoursMissing'], [])

    def test_rejects_non_pdf_and_missing_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp) / 'x.pdf'
            fake.write_bytes(b'not a pdf')
            with self.assertRaises(S.ExtractionError):
                S.extract_pdf(str(fake))
            with self.assertRaises(S.ExtractionError):
                S.extract_pdf(str(Path(tmp) / 'missing.pdf'))


def draw_form():
    """A fake VAA-FM-061 page with known content, drawn at the same scale as a 300 dpi scan."""
    from PIL import Image, ImageDraw, ImageFont
    import numpy as np
    W, H = 3888, 2550
    img = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(img)
    f = ImageFont.load_default(size=34)
    fs = ImageFont.load_default(size=30)
    xs = [150, 450, 950, 1450, 1950, 2450, 2950, 3350, 3750]   # TIME | MON..FRI | SAT | SUN
    top, step = 800, 48
    ys = [top + step * i for i in range(25)]
    d.text((150, 700), 'Term: Second Semester   A.Y. 2025-2026', fill='black', font=f)
    d.text((2800, 700), 'Effectivity Date: MARCH 9, 2026', fill='black', font=f)
    for x in xs:
        d.line([(x, top - 60), (x, ys[-1])], fill='black', width=3)
    d.line([(xs[0], top - 60), (xs[-1], top - 60)], fill='black', width=3)
    d.line([(xs[0], top), (xs[-1], top)], fill='black', width=3)
    for i, name in enumerate(['TIME', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']):
        d.text(((xs[i] + xs[i + 1]) // 2 - 70, top - 48), name, fill='black', font=fs)
    merged = {(1, 4, 5), (2, 6, 9), (3, 10, 11), (7, 20, 21)}   # (day column, first row, last row)
    inside = set()
    for col, a, b in merged:
        inside |= {(col, k) for k in range(a, b)}            # lines between rows a..b are not drawn
    for k in range(1, 25):
        d.line([(xs[0], ys[k]), (xs[1], ys[k])], fill='black', width=3)
        for col in range(1, 8):
            if (col, k - 1) not in inside:
                d.line([(xs[col], ys[k]), (xs[col + 1], ys[k])], fill='black', width=3)
    for r in range(24):
        a = 7 * 60 + 30 * r
        b = a + 30
        lab = lambda m: f'{((m // 60 - 1) % 12) + 1:02d}:{m % 60:02d}'
        d.text((xs[0] + 20, ys[r] + 8), f'{lab(a)}-{lab(b)}', fill='black', font=fs)
    def write(col, a, b, lines):
        cx, cy = (xs[col] + xs[col + 1]) // 2, (ys[a] + ys[b + 1]) // 2
        for j, t in enumerate(lines):
            w = d.textlength(t, font=fs)
            d.text((cx - w / 2, cy - 18 * len(lines) + 36 * j), t, fill='black', font=fs)
    write(1, 4, 5, ['MATH 101 - Algebra', 'BSIT 1-A | IICT 101'])
    write(2, 6, 9, ['CONSULTATION HOURS'])
    write(3, 10, 11, ['ART 5 - Drawing', 'BSIT 2-B | IICT 202'])
    write(7, 20, 21, ['PHYS 3 - Optics', 'BSIT 4-C | IICT 303'])
    d.text((150, ys[-1] + 90), 'Lecture Hours: 6   Laboratory Hours: 9   Total Hours: 28', fill='black', font=f)
    d.text((150, 2400), 'VAA-FM-061', fill='black', font=f)
    return cv2_from_pil(img)


def cv2_from_pil(img):
    import cv2
    import numpy as np
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


@unittest.skipUnless(HAVE_TESSERACT, 'Tesseract is not installed')
class SyntheticForm(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = S.extract_page(draw_form())

    def test_blocks_are_continuous_ranges_with_the_right_days(self):
        got = {(c['dayOfWeek'], c['startTime'], c['endTime']) for c in self.result['classes']}
        self.assertEqual(got, {(1, '09:00', '10:00'), (3, '12:00', '13:00'), (0, '17:00', '18:00')})  # Sunday = 0

    def test_consultation_hours_are_separate_from_classes(self):
        hours = [(h['dayOfWeek'], h['startTime'], h['endTime']) for h in self.result['consultationHours']]
        self.assertEqual(hours, [(2, '10:00', '12:00')])

    def test_class_text(self):
        by_day = {c['dayOfWeek']: c for c in self.result['classes']}
        self.assertEqual(by_day[1]['section'], 'BSIT 1-A')
        self.assertEqual(by_day[1]['room'], 'IICT 101')
        self.assertIn('Algebra', by_day[1]['subject'])
        self.assertEqual(by_day[0]['room'], 'IICT 303')

    def test_header_details(self):
        doc = self.result['document']
        self.assertEqual(doc['academicYear'], '2025-2026')
        self.assertEqual(doc['effectivityDate'], '2026-03-09')

    def test_ocr_never_activates_anything(self):
        self.assertEqual(self.result['status'], 'NEEDS_REVIEW')
        self.assertTrue(any(w['code'] == 'FACULTY_IDENTITY' for w in self.result['warnings']))

    def test_empty_cells_produce_no_blocks(self):
        self.assertEqual(len(self.result['classes']) + len(self.result['consultationHours']), 4)


@unittest.skipUnless(HAVE_TESSERACT and os.environ.get('PERCY_PDF') and shutil.which('node'), 'set PERCY_PDF=<scanned PDF> (and have Node) to run')
class RealPercyScan(unittest.TestCase):
    def test_matches_the_demo_schedule_fixture(self):
        backend = Path(__file__).resolve().parent.parent
        raw = subprocess.run(['node', '-e', "console.log(JSON.stringify(require('./utils/demoSchedules').DEMO_FACULTY_SCHEDULES.find(f=>f.key==='percy')))"],
                             cwd=backend, capture_output=True, text=True, check=True).stdout
        result = S.extract_pdf(os.environ['PERCY_PDF'])
        cmp = S.compare_with_expected(result, json.loads(raw))
        self.assertEqual(cmp['classesMissing'], [])
        self.assertEqual(cmp['classesExtra'], [])
        self.assertEqual(cmp['hoursMissing'], [])
        self.assertEqual(cmp['hoursExtra'], [])
        self.assertEqual(cmp['roomDifferences'], [])
        self.assertEqual(cmp['subjectDifferences'], [])
        self.assertEqual(result['document']['effectivityDate'], '2026-03-09')


if __name__ == '__main__':
    unittest.main()
