export function normalizePersonName(value: string) {
  const parts = value.replace(/\s+/g, ' ').trim().toLowerCase().split(/([\s'’\-]+)/u);
  return parts.map(part => /^[\s'’\-]+$/u.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)).join('');
}
