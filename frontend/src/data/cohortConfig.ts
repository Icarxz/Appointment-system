export const cohortConfig: Record<string, Record<string, string[]>> = {
  'BS INFO': {
    '1': ['A', 'B', 'C', 'D', 'E'],
    '2': ['A', 'B', 'C', 'D'],
    '3': ['A', 'B', 'C', 'D'],
    '4': ['A', 'B', 'C', 'D']
  },
  'BS COMSCI': {
    '1': ['A', 'B'], '2': ['A', 'B'], '3': ['A', 'B'], '4': ['A', 'B']
  },
  'BLIS': {
    '1': ['A', 'B'], '2': ['A', 'B'], '3': ['A', 'B'], '4': ['A', 'B']
  }
};

// The approved positions for a faculty-side account. Used by Provision Account, Onboarding and the student faculty filter.
export const FACULTY_POSITIONS: string[] = [
  'Faculty',
  'Librarian',
  'Program Head (BS INFO)',
  'Program Head (BS COMSCI)',
  'Program Head (BLIS)',
  'Dean',
];
