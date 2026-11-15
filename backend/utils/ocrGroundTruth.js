// What the three scanned faculty sheets (UA VAA-FM-061, second semester 2025-2026) actually say, read off the scans by eye - NOT taken from the OCR.
// Row format: [dayOfWeek (Sun=0), start, end, section, room]. Used by scheduleOcr.test.js to measure the OCR and to prove that every wrong cell is flagged.
const row = (d, a, b, section, room) => ({ dayOfWeek: d, startTime: a, endTime: b, section, room });

const SAYLO = { // 7:00 AM - 8:30 PM, 27 rows; part-time; 3 consultation hours
  firstRow: '07:00', rows: 27, lecture: 11, laboratory: 12, total: 23, effectivity: '2026-03-03',
  classes: [
    row(1, '09:30', '10:30', 'SC BSINFO 3-B', 'IICT 304 (LAB)'), row(1, '15:30', '16:30', 'SC BSINFO 2-C', 'IICT 305 (LAB)'),
    row(1, '16:30', '17:30', 'SC BSINFO 3-C', 'IICT 305 (LAB)'), row(1, '17:30', '18:30', 'SC BSINFO 3-C', 'IICT 305 (LAB)'),
    row(2, '11:30', '12:30', 'SC BSINFO 3-B', 'IICT 302 (LAB)'), row(2, '13:00', '14:30', 'SC BSINFO 2-C', 'IICT 305 (LAB)'),
    row(2, '14:30', '16:00', 'SC BSINFO 2-C', 'IICT 305 (LAB)'), row(2, '16:00', '17:30', 'SC BSINFO 2-B', 'IICT 201 (LAB)'),
    row(2, '17:30', '18:30', 'SC BSINFO 3-C', 'IICT 307 (LAB)'),
    row(3, '09:00', '10:00', 'SC BSINFO 3-B', 'IICT 304 (LAB)'), row(3, '15:00', '16:00', 'SC BSINFO 2-C', 'IICT 305 (LAB)'),
    row(3, '16:00', '17:00', 'SC BSINFO 3-C', 'IICT 305 (LAB)'), row(3, '17:00', '18:00', 'SC BSINFO 3-C', 'IICT 305 (LAB)'),
    row(4, '11:30', '12:30', 'SC BSINFO 3-B', 'IICT 302 (LAB)'), row(4, '13:00', '14:30', 'SC BSINFO 2-C', 'IICT 305 (LAB)'),
    row(4, '14:30', '16:00', 'SC BSINFO 2-C', 'IICT 305 (LAB)'), row(4, '16:00', '17:30', 'SC BSINFO 3-C', 'IICT 307 (LAB)'),
    row(4, '17:30', '18:30', 'SC BSINFO 3-C', 'IICT 307 (LAB)'),
    row(5, '09:00', '10:00', 'SC BSINFO 3-B', 'IICT 304 (LAB)'), row(5, '16:00', '17:00', 'SC BSINFO 3-C', 'IICT 305 (LAB)'),
  ],
  consultation: ['1 12:30-13:30', '3 12:30-13:30', '5 12:30-13:30'],
};

const NIEGO = { // 7:00 AM - 6:30 PM, 23 rows; Saturday and Sunday columns only ~140-180 px wide; room printed BEFORE the section
  firstRow: '07:00', rows: 23, lecture: 10, laboratory: 15, total: 25, effectivity: '2026-02-02',
  classes: [
    row(1, '10:30', '11:30', 'BSCD 1-A', 'IICT 103 (LEC)'), row(1, '12:30', '13:30', 'BSCS 3-B', 'IICT 304 (LAB)'), row(1, '16:30', '18:30', 'BS INFO 3-B', 'IICT 306 (LEC)'),
    row(2, '10:00', '11:30', 'BSCD 1-A', 'IICT 107 (LAB)'), row(2, '14:30', '16:00', 'BSINFO 2-D', 'IICT 303 (LAB)'),
    row(2, '16:00', '17:30', 'BS INFO 3-A', 'IICT 305 (LAB)'), row(2, '17:30', '18:30', 'BS INFO 3-A', 'IICT 305 (LEC)'),
    row(3, '10:30', '11:30', 'BSCD 1-A', 'IICT 104 (LEC)'), row(3, '12:00', '13:00', 'BSCS 3-B', 'IICT 304 (LAB)'),
    row(3, '15:00', '16:00', 'BSCS 3-B', 'IICT 309 (LEC)'), row(3, '16:00', '18:00', 'BS INFO 3-B', 'IICT 306 (LAB)'),
    row(4, '10:00', '11:30', 'BSCD 1-A', 'IICT 107 (LAB)'), row(4, '14:30', '16:00', 'BSINFO 2-D', 'IICT 303 (LAB)'),
    row(4, '16:00', '17:30', 'BS INFO 3-A', 'IICT 305 (LAB)'), row(4, '17:30', '18:30', 'BS INFO 3-A', 'IICT 305 (LEC)'),
    row(5, '10:00', '12:00', 'BSINFO 2-D', 'IICT 303 (LEC)'), row(5, '12:00', '13:00', 'BSCS 3-B', 'IICT 304 (LAB)'),
    row(5, '15:00', '16:00', 'BSCS 3-B', 'IICT 309 (LEC)'), row(5, '16:00', '17:00', 'BS INFO 3-B', 'IICT 306 (LAB)'),
  ],
  consultation: ['1 14:00-16:00', '4 12:30-14:30'],
};

const EGUALAN = { // starts at 7:30 AM (not 7:00), 21 rows; one printed line "<section> <room>" under the title; 5 consultation hours
  firstRow: '07:30', rows: 21, lecture: 12, laboratory: 15, total: 27, effectivity: '2026-02-02',
  classes: [
    row(1, '08:30', '10:30', 'BSCS 4-B', 'IICT 308 (LEC)'), row(1, '10:30', '11:30', 'BSIT 3-D', 'IICT 307 (LEC)'),
    row(1, '11:30', '12:30', 'BSCS 3-A', 'IICT 308 (LAB)'), row(1, '17:00', '18:00', 'BSCS 3-A', 'IICT 308 (LAB)'),
    row(2, '07:30', '08:30', 'BSIT 3-D', 'IICT 307 (LEC)'), row(2, '08:30', '10:00', 'BSIT 3-C', 'IICT 307 (LEC)'),
    row(2, '10:00', '11:30', 'BSCS 3-A', 'IICT 106 (LEC)'), row(2, '11:30', '13:00', 'BSCS 3-B', 'IICT 106 (LEC)'),
    row(2, '14:30', '16:00', 'BSCS 3-B', 'IICT 308 (LAB)'),
    row(3, '08:00', '10:00', 'BSCS 4-B', 'IICT 308 (LAB)'), row(3, '10:00', '11:00', 'BSIT 3-D', 'IICT 307 (LAB)'),
    row(3, '15:00', '16:00', 'BSIT 3-C', 'IICT 307 (LEC)'), row(3, '17:00', '18:00', 'BSCS 3-A', 'IICT 308 (LAB)'),
    row(4, '07:30', '08:30', 'BSIT 3-D', 'IICT 307 (LAB)'), row(4, '08:30', '10:00', 'BSIT 3-C', 'IICT 307 (LAB)'),
    row(4, '10:00', '11:30', 'BSCS 3-A', 'IICT 106 (LEC)'), row(4, '11:30', '13:00', 'BSCS 3-B', 'IICT 106 (LEC)'),
    row(4, '14:30', '16:00', 'BSCS 3-B', 'IICT 308 (LAB)'),
    row(5, '08:00', '09:00', 'BSCS 4-B', 'IICT 308 (LAB)'), row(5, '10:00', '11:00', 'BSIT 3-D', 'IICT 307 (LAB)'),
    row(5, '15:00', '16:00', 'BSIT 3-C', 'IICT 307 (LEC)'),
  ],
  consultation: ['1 13:30-14:30', '2 13:30-14:30', '3 13:30-14:30', '4 13:30-14:30', '5 13:30-14:30'],
};

module.exports = { SAYLO, NIEGO, EGUALAN };
