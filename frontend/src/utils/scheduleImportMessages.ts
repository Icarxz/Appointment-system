import type { ImportIssue, ImportRow } from '../context/ImportSessionContext';
import { DAY_SHORT } from './daySettings.ts';

export const IMPORT_WARNING_ACTION = 'Double check for mistakes. You can still submit.';
export const IMPORT_BLOCKING_ACTION = 'Fix this before you can continue.';

export interface ParsedWarningDisplay {
  message: string;
  skippedDetails?: string;
}

function rowTime(row?: ImportRow): string {
  if (!row) return 'this time';
  return `${DAY_SHORT[row.dayOfWeek] || 'Unknown day'} ${row.startTime} to ${row.endTime}`;
}

export function blockingIssueMessage(issue: ImportIssue, row?: ImportRow): string {
  const message = issue.message.toLowerCase();
  switch (issue.code) {
    case 'IDENTITY_MISMATCH':
      return 'This document does not match the selected faculty account. Choose the correct account or a different PDF.';
    case 'IDENTITY_NOT_CONFIRMED':
      return 'Confirm that this document belongs to the selected faculty member.';
    case 'CLASS_INVALID':
      if (message.includes('overlap') || message.includes('approved consultation')) {
        return `Move or remove the class at ${rowTime(row)}; it overlaps another class or an approved consultation.`;
      }
      if (message.includes('subject is required')) return `Add a subject to the class at ${rowTime(row)}.`;
      if (message.includes('room is required')) return `Add a room to the class at ${rowTime(row)}.`;
      if (message.includes('day must')) return 'Choose a valid day for this class.';
      if (message.includes('start and end must') || message.includes('times must')) return 'Choose valid start and end times on 30-minute steps.';
      if (message.includes('fall between')) return 'Keep this class between 7:00 AM and 7:00 PM.';
      if (message.includes('end time must')) return 'Set the end time after the start time.';
      return `Update the class at ${rowTime(row)} and check it again.`;
    case 'CONSULT_DAY':
      return 'Move consultation hours to Monday through Friday.';
    case 'CONSULT_TIME':
      return 'Choose valid start and end times on 30-minute steps.';
    case 'CONSULT_RANGE':
      return 'Keep consultation hours between 7:00 AM and 7:00 PM.';
    case 'CONSULT_ORDER':
      return 'Set the end time after the start time.';
    case 'CONSULT_OVERLAP':
      return `Move or remove the consultation block at ${rowTime(row)}; it overlaps another consultation block.`;
    case 'CONSULT_CLASS_OVERLAP':
      return `Move or remove the consultation block at ${rowTime(row)}; it overlaps a class.`;
    case 'CONSULT_TOTAL':
      return 'Adjust consultation hours to total exactly 4 hours per week.';
    default:
      return 'Update this schedule detail and check it again.';
  }
}

export function acceptedIssueMessage(issue: ImportIssue): string {
  switch (issue.code) {
    case 'REVIEW_ROW':
      return issue.ref?.type === 'class' ? 'Double check this class.' : 'Double check this consultation block.';
    case 'PENDING_OVERLAP':
      return 'A pending consultation request is in this class time. It will not move automatically.';
    case 'METADATA_MISSING':
      if (issue.message.toLowerCase().includes('effectivity date')) return 'Enter an effectivity date before confirming.';
      return 'Some document details are missing. Review them before confirming.';
    case 'WORKLOAD_MISMATCH':
      return 'Compare the teaching blocks with the workload hours shown on the PDF.';
    case 'CONSULT_TOTAL':
      return 'Check the consultation hours total against the required 4 hours per week.';
    default:
      return 'Double-check this schedule detail against the PDF.';
  }
}

export function parsedWarningDisplay(issue: ImportIssue): ParsedWarningDisplay {
  switch (issue.code) {
    case 'time-labels-unverified':
      return {
        message: 'Double check the times. Some time labels in the PDF were unclear, so we filled them in from the other rows. Compare the calendar with your PDF.',
      };
    case 'ignored-marks':
      return {
        message: 'Some marks in the PDF were skipped because they are not classes. If a class is missing, click its time slot on the calendar and add it.',
        skippedDetails: issue.message,
      };
    case 'WEEKEND_CONSULTATION_EXCLUDED':
      return { message: 'Some weekend consultation entries were left out. Consultation hours must be Monday through Friday.' };
    case 'low-confidence':
      return { message: 'Some PDF details were hard to read. Compare the calendar with your PDF.' };
    default:
      return { message: 'Double-check the calendar against your PDF.' };
  }
}
