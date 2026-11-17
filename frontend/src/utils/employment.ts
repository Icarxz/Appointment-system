// Full-time or part-time (faculty only). Same two values as the server (backend/utils/employment.js).
export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time'];
export const EMPLOYMENT_OPTIONS = EMPLOYMENT_TYPES.map(t => ({ value: t, label: t }));
