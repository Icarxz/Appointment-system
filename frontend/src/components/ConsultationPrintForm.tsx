import { Heading, HStack, Table, Tbody, Td, Text, Th, Thead, Tr, VStack } from '@chakra-ui/react';
import { formatDate } from './dateUtils';

// The "STUDENTS' CONSULTATION FORM" that is printed or saved as PDF. ONE component for the Faculty and the Admin, so both
// print exactly the same page (the layout rules are in index.css under #printable-log). It is invisible on screen.
export default function ConsultationPrintForm({ facultyName, entries }: { facultyName: string; entries: any[] }) {
  return (
    <div id="printable-log" className="print-only consultation-print-form" style={{ background: 'white', color: 'black', padding: '24px' }}>
      <VStack spacing={0} mb={2} className="consultation-print-heading">
        <Text fontSize="xs">Republic of the Philippines</Text>
        <Text fontSize="xs" fontWeight="bold">UNIVERSITY OF ANTIQUE</Text>
        <Text fontSize="xs">Sibalom, Antique</Text>
        <Heading size="sm" mt={1} letterSpacing="wide">STUDENTS' CONSULTATION FORM</Heading>
      </VStack>

      <HStack justifyContent="space-between" mb={2} fontSize="xs" className="consultation-print-meta">
        <VStack align="start" spacing={0}>
          <Text>Name of Faculty: <b>{facultyName}</b></Text>
          <Text>School Term: __________ Sem, AY __________</Text>
        </VStack>
        <Text>Consultation Schedule: __________</Text>
      </HStack>

      <Table id="consult-form-table" className="consultation-print-table" size="sm" variant="simple" border="1px solid black">
        <Thead bg="gray.600">
          <Tr>
            <Th color="white" border="1px solid black">Name of Student/Advisee</Th>
            <Th color="white" border="1px solid black">Gender</Th>
            <Th color="white" border="1px solid black">Course and Year</Th>
            <Th color="white" border="1px solid black">Date</Th>
            <Th color="white" border="1px solid black">Case Presented</Th>
            <Th color="white" border="1px solid black">Intervention/Action Taken</Th>
          </Tr>
        </Thead>
        <Tbody>
          {Array.from({ length: Math.max(15, entries.length) }).map((_, i) => {
            const entry = entries[i];
            return (
              <Tr key={i} height="21px">
                <Td border="1px solid black" p={1} fontSize="xs">{entry ? `${i + 1}. ${entry.studentName || ''}` : `${i + 1}.`}</Td>
                <Td border="1px solid black" p={1} fontSize="xs">{entry?.studentId?.gender || ''}</Td>
                <Td border="1px solid black" p={1} fontSize="xs">{entry?.studentSection || ''}</Td>
                <Td border="1px solid black" p={1} fontSize="xs">{entry?.date ? formatDate(entry.date) : ''}</Td>
                <Td border="1px solid black" p={1} fontSize="xs" whiteSpace="pre-wrap">{entry?.casePresented || ''}</Td>
                <Td border="1px solid black" p={1} fontSize="xs" whiteSpace="pre-wrap">{entry?.interventionTaken || ''}</Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>

      <HStack justifyContent="space-between" mt={4} fontSize="xs">
        <Text>VAA-FM-035</Text>
        <Text>Rev.1/01-15-20</Text>
      </HStack>
    </div>
  );
}

// Prints with an empty page title, so the browser header shows no title text (same as the Faculty's Print button).
export const printConsultationForm = () => {
  const previousTitle = document.title;
  document.title = ' ';
  window.addEventListener('afterprint', () => { document.title = previousTitle; }, { once: true });
  window.print();
};
