import type { ReactNode } from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { useNavPalette } from '../utils/uiTokens';

// One appointment as a card. The request tables have five columns, which do not fit a phone or a portrait tablet:
// the Status and Action columns (Approve, Reject, Cancel) ended up off-screen with no sign that they were there.
// Below the table's width, ByWidth shows these cards instead, with everything stacked and every button in reach.
interface Props {
  /** Professor (student view) or student name and section (faculty view). */
  title: ReactNode;
  /** "Fri, Oct 9, 2026 at 9:00 AM" */
  when: ReactNode;
  reason?: string;
  /** The status badge, shown top right. */
  status: ReactNode;
  /** Cancel reason, appeal controls and similar notes under the reason. */
  extra?: ReactNode;
  /** Approve / Reject / Cancel buttons. */
  actions?: ReactNode;
}

export default function RequestCard({ title, when, reason, status, extra, actions }: Props) {
  const C = useNavPalette();
  return (
    <Box borderWidth="1px" borderColor={C.border} borderRadius="lg" p={3}>
      <Flex justify="space-between" align="flex-start" gap={2} mb={1}>
        <Text fontWeight="700" fontSize="sm" color={C.text} minW={0} overflowWrap="anywhere">{title}</Text>
        <Box flexShrink={0} maxW="50%">{status}</Box>
      </Flex>
      <Text fontSize="sm" color={C.text}>{when}</Text>
      {reason && <Text fontSize="sm" color={C.textMid} mt={1} noOfLines={3}>{reason}</Text>}
      {extra && <Box mt={2}>{extra}</Box>}
      {actions && <Flex mt={3} gap={2} wrap="wrap" align="center">{actions}</Flex>}
    </Box>
  );
}
