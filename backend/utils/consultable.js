// Who a student may request a consultation from.
//   - every FACULTY account, and
//   - a DEAN account that has switched consultations on (acceptsConsultations).
// The role itself never changes: a Dean who takes consultations is still a Dean everywhere else.
const CONSULTABLE_ROLES = ['FACULTY', 'DEAN'];

const isConsultable = (user) =>
  !!user && (user.role === 'FACULTY' || (user.role === 'DEAN' && user.acceptsConsultations === true));

// Mongo filter for the same rule, so every route that used `role: 'FACULTY'` for "bookable people" stays consistent.
const consultableFilter = (extra = {}) => ({
  $or: [{ role: 'FACULTY' }, { role: 'DEAN', acceptsConsultations: true }],
  ...extra,
});

module.exports = { CONSULTABLE_ROLES, isConsultable, consultableFilter };
