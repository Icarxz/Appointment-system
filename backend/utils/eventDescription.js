function describeEvent(event = {}) {
  const details = event.details || {};
  const from = (value) => String(value || 'unspecified');
  switch (event.eventType) {
    case 'ACCOUNT_PROVISIONED':
      return 'Account provisioned.';
    case 'ACCOUNT_ACTIVATED':
      return 'Account approved or activated.';
    case 'ACCOUNT_ONBOARDED':
      return 'Account onboarding completed.';
    case 'ACCOUNT_DETAILS_CONFIRMED':
      return 'Account details confirmed.';
    case 'ACCOUNT_DISABLED':
      return 'Account disabled.';
    case 'ACCOUNT_ENABLED':
      return 'Account enabled.';
    case 'ROLE_CHANGED':
      return `Role changed from ${from(details.fromRole)} to ${from(details.toRole)}.`;
    case 'POSITION_CHANGED':
      return `Position changed from ${from(details.fromPosition)} to ${from(details.toPosition)}.`;
    case 'SIGN_IN_BLOCKED': {
      const status = String(details.accountStatus || '').toUpperCase();
      const account = status === 'ARCHIVED' ? 'an archived' : status === 'RESTRICTED' ? 'a restricted' : 'a disabled';
      return `Sign-in blocked for ${account} account.`;
    }
    case 'PROFILE_UPDATED':
      return 'Account profile updated.';
    case 'SCHEDULE_IMPORT_STAGED':
      return 'Schedule import confirmed and scheduled.';
    case 'SCHEDULE_IMPORT_ACTIVATED':
      return 'Schedule import activated.';
    case 'SCHEDULE_IMPORT_FAILED':
      return 'Schedule import could not be applied.';
    case 'SCHEDULE_IMPORT_ROLLED_BACK':
      return 'Schedule import rolled back.';
    case 'SCHEDULE_IMPORT_CANCELLED':
      return 'Scheduled import cancelled.';
    case 'CLASS_SCHEDULE_ADDED':
      return 'Class added to the schedule.';
    case 'CLASS_SCHEDULE_UPDATED':
      return 'Class schedule updated.';
    case 'CLASS_SCHEDULE_REMOVED':
      return 'Class removed from the schedule.';
    case 'ADDED_CONSULTATION_HOURS':
      return 'Additional consultation hours added.';
    case 'ADDED_CONSULTATION_HOURS_REMOVED':
      return 'Additional consultation hours removed.';
    case 'CONSULTATION_HOURS_REPLACED':
      return 'Consultation hours updated.';
    case 'NOTICE_POSTED':
      return 'A notice was posted.';
    case 'NOTICE_CANCELLED':
      return 'A notice was cancelled.';
    case 'FACULTY_STATUS_SET':
      return 'Faculty status updated.';
    case 'FACULTY_STATUS_CLEARED':
      return 'Faculty status cleared.';
    case 'APPOINTMENT_REQUESTED':
      return 'Appointment requested.';
    case 'APPOINTMENT_STATUS_CHANGED': {
      const status = String(details.toStatus || '').toUpperCase();
      if (status === 'APPROVED') return 'Appointment approved.';
      if (status === 'REJECTED') {
        return event.actorRole === 'SYSTEM'
          ? 'Appointment request automatically rejected by the system.'
          : 'Appointment request declined.';
      }
      if (status === 'CANCELLED BY STUDENT') return 'Appointment cancelled by the student.';
      if (status === 'CANCELLED BY FACULTY') return 'Appointment cancelled by the faculty member.';
      if (status.startsWith('MISSED')) {
        return event.actorRole === 'SYSTEM'
          ? 'Appointment automatically marked as missed by the system.'
          : 'Appointment marked as missed.';
      }
      return 'Appointment status changed.';
    }
    case 'CONSULTATION_COMPLETED':
      return 'Consultation completed.';
    case 'CONSULTATION_LOG_UPDATED':
      return 'Consultation log updated.';
    case 'APPEAL_SUBMITTED':
      return 'Appointment appeal submitted.';
    default:
      return 'Activity recorded.';
  }
}

module.exports = { describeEvent };
