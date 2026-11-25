function normalizePersonName(value) {
  const parts = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase().split(/([\s'’\-]+)/u);
  return parts.map(part => /^[\s'’\-]+$/u.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

module.exports = { normalizePersonName };
