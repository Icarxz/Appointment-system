function activationAtForNewAccount({ isNew, accountStatus, activatedAt }, now = new Date()) {
  if (activatedAt) return activatedAt;
  return isNew && accountStatus === 'ACTIVE' ? now : null;
}

function activationAtForApproval({ previousStatus, currentStatus, activatedAt }, now = new Date()) {
  if (activatedAt) return activatedAt;
  return previousStatus === 'PENDING_APPROVAL' && currentStatus === 'ACTIVE' ? now : null;
}

module.exports = { activationAtForNewAccount, activationAtForApproval };
