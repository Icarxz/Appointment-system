import { useState } from 'react';
import { Textarea, VStack, Text, useColorModeValue } from '@chakra-ui/react';
import SearchableSelect from './SearchableSelect';

export interface CancelReasonOption {
  label: string; // saved as the reason and shown in notifications / tables
  hint: string;  // helper text shown under the dropdown once selected
}

export const STUDENT_CANCEL_REASONS: CancelReasonOption[] = [
  { label: 'Academic Conflict / Exam Conflict', hint: 'e.g., Conflict with major exam, class project deadline' },
  { label: 'Resolved Issue', hint: 'e.g., Question already answered, or issue resolved via email or peer' },
  { label: 'Personal / Health Emergency', hint: 'e.g., Sickness / medical appointment, family emergency' },
  { label: 'Transportation / Weather Issues', hint: 'e.g., Suspended classes, bad weather / typhoon, transport trouble' },
  { label: 'Schedule Change', hint: 'e.g., Faculty member posted an update: In Class / Not Available' },
];

export const FACULTY_CANCEL_REASONS: CancelReasonOption[] = [
  { label: 'Official University Duties', hint: 'e.g., Administrative meeting, committee assignment, faculty assembly' },
  { label: 'Emergency Leave / Personal Leave', hint: 'e.g., Sick leave, emergency personal leave' },
  { label: 'Teaching Overload / Class Extension', hint: 'e.g., Extended class discussion, makeup class' },
  { label: 'Slot Unavailable / Fully Booked', hint: 'If the slot was accidentally double-booked or clashed with a fixed consultation limit' },
];

// Reasons for marking a consultation as missed (the other person sees the reason, as with a cancellation).
export const FACULTY_MISSED_REASONS: CancelReasonOption[] = [
  { label: 'Did not arrive within 30 minutes', hint: 'The student did not come within the 30-minute grace period' },
  { label: 'Arrived after the slot ended', hint: 'The student came only after the consultation time was over' },
  { label: 'Could not be reached', hint: 'No answer to messages or calls during the consultation time' },
];

export const STUDENT_MISSED_REASONS: CancelReasonOption[] = [
  { label: 'Instructor did not arrive within 30 minutes', hint: 'You waited and the instructor did not come' },
  { label: 'Instructor was not at the meeting place', hint: 'The instructor was not where the consultation was to be held' },
  { label: 'Instructor could not be reached', hint: 'No answer to messages or calls during the consultation time' },
];

// Reasons for appealing a missed or cancelled consultation (shown in the same dropdown picker).
export const STUDENT_APPEAL_REASONS: CancelReasonOption[] = [
  { label: 'Medical / Health Emergency', hint: 'e.g., Sudden illness, hospital visit' },
  { label: 'Family Emergency', hint: 'e.g., Urgent family matter' },
  { label: 'Academic Conflict', hint: 'e.g., Exam or class requirement that ran at the same time' },
  { label: 'Transportation / Weather Issues', hint: 'e.g., Typhoon, suspended transport' },
  { label: 'Connectivity / Technical Problem', hint: 'e.g., No signal, could not access the system or notifications' },
];

export const FACULTY_APPEAL_REASONS: CancelReasonOption[] = [
  { label: 'Official University Duties', hint: 'e.g., Administrative meeting, committee work, faculty assembly' },
  { label: 'Illness / Emergency Leave', hint: 'e.g., Sick leave, emergency personal leave' },
  { label: 'Teaching Overload / Class Extension', hint: 'e.g., Class ran long, makeup class' },
  { label: 'Power / Connectivity Problem', hint: 'e.g., Outage that made the consultation impossible' },
  { label: 'Scheduling Error', hint: 'e.g., Slot clashed with another commitment' },
];

const OTHER = 'Other Reason';

interface Props {
  options: CancelReasonOption[];
  /** Called with the final reason text ('' while nothing valid is chosen/typed). */
  onChange: (reason: string) => void;
}

/**
 * Reason dropdown. Choosing "Other Reason" reveals a text box for the person's own words.
 * Remount it (change its `key`) to reset it.
 */
export default function CancelReasonPicker({ options, onChange }: Props) {
  const [preset, setPreset] = useState('');
  const [otherText, setOtherText] = useState('');

  const textColor = useColorModeValue('#0f2240', '#e8f0fe');
  const borderColor = useColorModeValue('#dde3ec', '#1e3048');
  const mutedText = useColorModeValue('#6b7fa0', '#7a93b0');
  const selectedHint = options.find(o => o.label === preset)?.hint;
  const isOther = preset === OTHER;

  return (
    <VStack align="stretch" spacing={3}>
      <SearchableSelect
        portal searchable={false} ariaLabel="Reason" placeholder="Select a reason" value={preset}
        onChange={(v) => {
          setPreset(v);
          onChange(v === OTHER ? otherText.trim() : v); // "Other Reason" stays invalid until something is typed
        }}
        options={[...options.map(opt => ({ value: opt.label, label: opt.label })), { value: OTHER, label: OTHER }]}
      />
      {!isOther && selectedHint && <Text fontSize="xs" color={mutedText} mt={-1}>{selectedHint}</Text>}
      {isOther && (
        <Textarea
          rows={3} maxLength={300} value={otherText}
          placeholder="Please specify your reason..."
          onChange={(e) => { setOtherText(e.target.value); onChange(e.target.value.trim()); }}
          color={textColor} borderColor={borderColor}
        />
      )}
    </VStack>
  );
}
