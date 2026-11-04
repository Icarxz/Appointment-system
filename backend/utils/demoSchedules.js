// Real teaching loads and consultation hours of five faculty, used ONLY as CHECKING data (see utils/demoData.js).
// Source: the "Faculty Time Schedule & Consultation Hours" sheet from the project owner (Nov 3, 2026).
// dayOfWeek: 1 = Monday ... 5 = Friday (same as the Schedule and ConsultationHours models). Times are 24-hour "HH:MM".
//
// What is NOT in the sheet, and therefore not invented here:
//   - Silva's classes (the sheet says they are imported from "...silvaSchedule", which was not provided);
//   - consultation hours for Colmo, Edjan and Fortaleza (they simply have none; the vacant Mon-Fri 8-5 window still applies).

const c = (day, subject, room, start, end) => ({ dayOfWeek: day, subject, room, startTime: start, endTime: end });

const DEMO_FACULTY_SCHEDULES = [
  {
    key: 'colmo', label: 'Colmo', source: 'colmoId',
    classes: [
      c(2, 'LIS 6 (BLIS 2-A)', 'New Library', '07:00', '08:30'),
      c(3, 'LIS 6 (BLIS 2-B)', 'New Library', '07:00', '08:30'),
      c(4, 'LIS 6 (BLIS 2-A)', 'New Library', '07:00', '08:30'),
      c(5, 'LIS 6 (BLIS 2-B)', 'New Library', '07:00', '08:30'),
    ],
    hours: [],
  },
  {
    key: 'edjan', label: 'Edjan', source: 'edjanId',
    classes: [
      c(1, 'LIS 2 (SC BLIS 1-B)', 'Old Library', '09:30', '11:00'),
      c(1, 'LIS 2 (SC BLIS 1-A)', 'Old Library', '12:00', '13:00'),
      c(2, 'LIS 2 (SC BLIS 1-A)', 'ICT 309', '10:00', '11:00'),
      c(3, 'LIS 2 (SC BLIS 1-B)', 'Old Library', '09:30', '11:00'),
      c(4, 'LIS 2 (SC BLIS 1-A)', 'ICT 309', '10:00', '11:00'),
    ],
    hours: [],
  },
  {
    key: 'fortaleza', label: 'Fortaleza', source: 'fortalezaId (effective Feb 2, 2026)',
    classes: [
      c(1, 'ICT 1 (SC BSCD 1-C)', 'ICT 101 A', '08:30', '10:30'),
      c(1, 'LIS 11 (SC BLIS 3-A)', 'ICT 301 (LAB)', '10:30', '11:30'),
      c(1, 'SPT 6 (SC BLIS 3-A)', 'TBA', '13:00', '14:00'),
      c(1, 'ELECT 2 (SC BSISM 3-C)', 'IICT 107 A', '14:30', '15:30'),
      c(1, 'ISM 6 (SC BSISM 1-A)', 'IICT 101 A', '16:00', '17:00'),
      c(2, 'LICT 3 (SC BLIS 2-B)', 'ICT 301 (LAB)', '09:30', '11:30'),
      c(2, 'ELECT 2 (SC BSISM 3-C)', 'IICT 104 A', '13:00', '14:30'),
      c(2, 'SPT 6 (SC BLIS 3-A)', 'TBA (LAB)', '15:00', '17:00'),
      c(3, 'ICT 1 (SC BSCD 1-C)', 'ICT 101 A', '08:00', '10:00'),
      c(3, 'SPT 6 (SC BLIS 3-A)', 'TBA', '10:00', '11:00'),
      c(3, 'LICT 3 (SC BLIS 2-A)', 'ICT 309 (LAB)', '13:00', '14:30'),
      c(3, 'ELECT 2 (SC BSISM 3-C)', 'IICT 104 A', '14:30', '15:30'),
      c(3, 'ISM 6 (SC BSISM 1-A)', 'IICT 101 A', '16:00', '17:00'),
      c(4, 'LICT 3 (SC BLIS 2-B)', 'ICT 301 (LAB)', '09:00', '11:30'),
      c(4, 'ELECT 2 (SC BSISM 3-C)', 'IICT 104 A', '13:00', '14:30'),
      c(4, 'LIS 11 (SC BLIS 3-A)', 'ICT 301 (LAB)', '15:00', '17:00'),
      c(5, 'ICT 1 (SC BSCD 1-C)', 'ICT 101 A', '08:30', '10:30'),
      c(5, 'LICT 3 (SC BLIS 2-A)', 'ICT 309 (LAB)', '13:00', '15:00'),
      c(5, 'ISM 6 (SC BSISM 1-A)', 'IICT 101 A', '16:00', '17:00'),
    ],
    hours: [],
  },
  {
    key: 'percy', label: 'Percy', source: 'percyId (effective Mar 9, 2026)',
    classes: [
      c(1, 'INFOT 8 - Platform Technologies (BSIT 3-D)', 'IICT 306', '11:30', '12:30'),
      c(1, 'INFOT 8 - Platform Technologies (BSIT 3-B)', 'IICT 307', '13:30', '14:30'),
      c(1, 'INFOE 4 (MMT) - Videography in Multimedia (BSIT 3-D)', 'IICT 304', '15:30', '16:30'),
      c(2, 'INFOT 8 - Platform Technologies (BSIT 3-D)', 'IICT 307', '14:30', '16:00'),
      c(2, 'INFOE 4 (MMT) - Videography in Multimedia (BSIT 3-D)', 'IICT 304', '16:00', '17:00'),
      c(3, 'INFOT 8 - Platform Technologies (BSIT 3-D)', 'IICT 308', '11:00', '12:00'),
      c(3, 'INFOT 8 - Platform Technologies (BSIT 3-B)', 'IICT 307', '13:00', '14:00'),
      c(3, 'INFOT 8 - Platform Technologies (BSIT 3-B)', 'IICT 108', '14:00', '15:00'),
      c(3, 'INFOE 4 (MMT) - Videography in Multimedia (BSIT 3-D)', 'IICT 304', '16:00', '17:00'),
      c(4, 'INFOT 8 - Platform Technologies (BSIT 3-D)', 'IICT 307', '14:30', '16:00'),
      c(4, 'INFOE 4 (MMT) - Videography in Multimedia (BSIT 3-D)', 'IICT 304', '16:00', '17:00'),
      c(5, 'INFOT 8 - Platform Technologies (BSIT 3-B)', 'IICT 307', '13:00', '14:00'),
      c(5, 'INFOT 8 - Platform Technologies (BSIT 3-B)', 'IICT 108', '14:00', '15:00'),
      c(5, 'INFOE 4 (MMT) - Videography in Multimedia (BSIT 3-D)', 'IICT 304', '16:00', '17:00'),
    ],
    hours: [{ dayOfWeek: 2, startTime: '09:00', endTime: '11:00' }, { dayOfWeek: 4, startTime: '09:00', endTime: '11:00' }],
  },
  {
    key: 'silva', label: 'Silva', source: 'silvaId (2nd Sem AY 2025-2026, effective Feb 2, 2026)',
    classes: [],
    hours: [{ dayOfWeek: 2, startTime: '12:30', endTime: '14:30' }, { dayOfWeek: 4, startTime: '12:30', endTime: '14:30' }],
  },
];

module.exports = { DEMO_FACULTY_SCHEDULES };
