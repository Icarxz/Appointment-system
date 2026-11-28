const DISABLED_ACCOUNT_STATUSES = ['RESTRICTED', 'ARCHIVED'];
const DISABLEABLE_ROLES = ['STUDENT', 'FACULTY', 'DEAN'];

const isDisabledAccountStatus = (status) => DISABLED_ACCOUNT_STATUSES.includes(status);
const canDisableRole = (role) => DISABLEABLE_ROLES.includes(role);
const canEnableAccountStatus = (status) => DISABLED_ACCOUNT_STATUSES.includes(status);

module.exports = {
  DISABLED_ACCOUNT_STATUSES,
  DISABLEABLE_ROLES,
  isDisabledAccountStatus,
  canDisableRole,
  canEnableAccountStatus,
};
