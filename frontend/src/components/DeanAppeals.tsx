import { useEffect, useState } from 'react';
import {
  Box, Heading, Text, Table, Thead, Tbody, Tr, Th, Td, TableContainer, Badge, useColorModeValue,
} from '@chakra-ui/react';
import { authFetch } from './authFetch';
import { formatDate } from './dateUtils';
import { statusColor, statusLabel } from './appointmentStatus';
import AppealControls from './AppealControls';

const fmtTime = (t: string) => {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

// The Dean's list of the reasons faculty gave for missed or cancelled consultations (the code still calls them appeals).
export default function DeanAppeals() {
  const [appeals, setAppeals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const cardBg = useColorModeValue('#ffffff', '#111d30');
  const borderColor = useColorModeValue('#dde3ec', '#1e3048');
  const textColor = useColorModeValue('#0f2240', '#e8f0fe');
  const mutedText = useColorModeValue('#6b7fa0', '#7a93b0');

  const load = () => {
    authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/appeals`)
      .then(r => r.json())
      .then(d => setAppeals(Array.isArray(d) ? d : []))
      .catch(() => setAppeals([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
      <Heading size="md" color={textColor} mb={1}>Faculty Reasons</Heading>
      <Text fontSize="sm" color={mutedText} mb={4}>Reasons faculty gave for a consultation they missed or cancelled. They are a record only; nothing needs to be approved.</Text>
      {loading ? <Text color={mutedText}>Loading...</Text> : appeals.length === 0 ? (
        <Text color={mutedText}>No reasons yet.</Text>
      ) : (
        <TableContainer>
          <Table size="sm" variant="simple">
            <Thead><Tr><Th color={mutedText}>Faculty</Th><Th color={mutedText}>Consultation</Th><Th color={mutedText}>Status</Th><Th color={mutedText}>Reason</Th></Tr></Thead>
            <Tbody>
              {appeals.map(apt => (
                <Tr key={apt._id}>
                  <Td fontWeight="bold" color={textColor}>{apt.facultyId?.name || 'Unknown'}</Td>
                  <Td color={textColor}>{apt.studentName} · {formatDate(apt.date)} at {fmtTime(apt.time)}</Td>
                  <Td><Badge colorScheme={statusColor(apt.status)}>{statusLabel(apt.status)}</Badge></Td>
                  <Td><AppealControls apt={apt} role="DEAN" onChanged={load} /></Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
