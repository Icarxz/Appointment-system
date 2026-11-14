#!/usr/bin/env python3
"""
Reads one or more Faculty Individual Load PDFs and prints a short report per file, so a change to the reader can be checked on real scans.
A PDF whose SHA-256 matches a saved fixture (ocr/fixtures/*.extracted.json) is also compared with it: day/start/end of every block and the
consultation blocks must be identical (PASS) or the differences are listed (DIFF).

    python ocr/check_sheets.py C:\\path\\PERCY.pdf C:\\path\\FORTALEZA.pdf C:\\path\\SILVA.pdf
Exit code 1 when any file FAILED to read or differs from its fixture.
"""
import glob, hashlib, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import schedule_ocr as ocr

HERE = os.path.dirname(os.path.abspath(__file__))


def blocks(items):
    return {(c['dayOfWeek'], c['startTime'], c['endTime']) for c in items}


def fixtures_by_hash():
    out = {}
    for p in glob.glob(os.path.join(HERE, 'fixtures', '*.extracted.json')):
        with open(p, encoding='utf-8') as f:
            d = json.load(f)
        out[d.get('source', {}).get('sha256')] = (os.path.basename(p), d)
    return out


def main(paths):
    known, bad = fixtures_by_hash(), False
    for path in paths:
        name = os.path.basename(path)
        try:
            d = ocr.extract(path)
        except Exception as e:                                     # an unsupported layout is a failure, never a guess
            print(f'{name}: FAILED  {e}'); bad = True; continue
        ax = d['source']['timeAxis']
        cl = d['classes']
        print(f"{name}: read  rows={ax['rows']} first row={ax['firstRow']}  classes={len(cl)} (flagged {sum(1 for c in cl if c['needsReview'])})  "
              f"consultation blocks={len(d['consultationHours'])}  hours read={d['workload']['extractedTeachingHours']:g} "
              f"(sheet: {d['workload'].get('lectureHours')} lecture + {d['workload'].get('laboratoryHours')} lab, total {d['workload'].get('totalHours')}, reconciles={d['workload'].get('reconciles')})")
        print(f"    renderer={d['source']['renderer']}  warnings: {', '.join(sorted({w['code'] for w in d['warnings']})) or 'none'}")
        with open(path, 'rb') as f:
            sha = hashlib.sha256(f.read()).hexdigest()
        if sha in known:
            fx_name, fx = known[sha]
            a, b = blocks(cl), blocks(fx['classes'])
            ca, cb = blocks(d['consultationHours']), blocks(fx['consultationHours'])
            if a == b and ca == cb:
                print(f'    PASS  same {len(a)} blocks and {len(ca)} consultation blocks as {fx_name}')
            else:
                bad = True
                print(f'    DIFF  against {fx_name}: only now {sorted(a - b)}, only in fixture {sorted(b - a)}, consultation only now {sorted(ca - cb)}, only in fixture {sorted(cb - ca)}')
        else:
            print('    (no fixture for this file: compare the numbers above with the scan)')
    return 1 if bad else 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    sys.exit(main(sys.argv[1:]))
