import {
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody,
  VStack, Text, Button, Box, useColorModeValue,
} from '@chakra-ui/react';

// The Privacy Policy dialog, shared by the landing page and the dashboards' profile form.
export default function PrivacyPolicyModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const headingColor = useColorModeValue('#08305a', 'white');
  const bodyColor = useColorModeValue('#3c5a78', 'gray.300');
  const modalBg = useColorModeValue('white', 'gray.800');
  return (
      <Modal isOpen={isOpen} onClose={onClose} size="xl" isCentered scrollBehavior="inside">
        <ModalOverlay backdropFilter="blur(4px)" />
        <ModalContent borderRadius="2xl" bg={modalBg}>
          <ModalHeader color={headingColor}>Privacy Policy</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            <VStack align="stretch" spacing={4} fontSize="sm" color={bodyColor}>
              <Text>
                CCIS Sync is the consultation appointment system of the College of Computing and Information
                Sciences, University of Antique. This policy explains what personal information we collect,
                why, and who can see it, in line with the Data Privacy Act of 2012 (Republic Act No. 10173).
              </Text>

              <Box>
                <Text fontWeight="700" mb={1}>1. Information we collect</Text>
                <VStack align="stretch" spacing={1} pl={3}>
                  <Text>• Account details: full name, gender, Gmail address, role (student or faculty), and your password (stored only in encrypted form).</Text>
                  <Text>• School identity: School ID or Faculty ID, and your program, year, and section (students) or position (faculty).</Text>
                  <Text>• Consultation records: appointment requests (date, time, purpose), and for completed consultations, the case presented and action taken.</Text>
                  <Text>• Faculty availability: class schedules, consultation hours, live status and location, and personal calendar notes.</Text>
                  <Text>• In-app notifications about your appointments and account.</Text>
                </VStack>
              </Box>

              <Box>
                <Text fontWeight="700" mb={1}>2. Why we collect it</Text>
                <Text>
                  To verify your identity, let students book consultations with faculty, record consultations
                  that took place, show faculty availability, send reminders and notices, and produce the
                  consultation reports the college requires. Gender is used only for summary statistics
                  (such as how many students or faculty are male or female) in those reports.
                </Text>
              </Box>

              <Box>
                <Text fontWeight="700" mb={1}>3. Who can see your information</Text>
                <VStack align="stretch" spacing={1} pl={3}>
                  <Text>• Students see their own requests and consultation records. They see a faculty member's consultation hours and class time blocks only; subject, room, and personal notes are never shown.</Text>
                  <Text>• Faculty see the requests made to them and the consultation records they sign off. Their personal calendar notes are visible only to them.</Text>
                  <Text>• The Admin verifies accounts and can view accounts and consultation records. The Dean can view consultation records and analytics for the college.</Text>
                  <Text>• We do not sell your information or share it with outside parties.</Text>
                </VStack>
              </Box>

              <Box>
                <Text fontWeight="700" mb={1}>4. How we protect it</Text>
                <Text>
                  Passwords are encrypted, access is limited by role, and sign-in sessions expire automatically.
                  No system is perfectly secure, so please keep your password private and log out on shared computers.
                </Text>
              </Box>

              <Box>
                <Text fontWeight="700" mb={1}>5. How long we keep it</Text>
                <Text>
                  We keep your information while your account is active and for as long as the college needs
                  consultation records for its reports and school records.
                </Text>
              </Box>

              <Box>
                <Text fontWeight="700" mb={1}>6. Your rights</Text>
                <Text>
                  Under the Data Privacy Act you may ask to access your personal information, correct
                  inaccurate information, object to its processing, and request its removal or blocking
                  where the law allows. You may also file a complaint with the National Privacy Commission.
                </Text>
              </Box>

              <Box>
                <Text fontWeight="700" mb={1}>7. Contact</Text>
                <Text>
                  For privacy questions or requests, contact the CCIS office or the University's Data
                  Protection Officer. [Contact details to be provided by the college.]
                </Text>
              </Box>

              <Text fontSize="xs" color="gray.500">
                By ticking the box on the registration form, you confirm that you have read this policy and
                consent to the collection and use of your information as described.
              </Text>
            </VStack>
            <Button mt={6} w="100%" colorScheme="blue" onClick={() => { onClose(); }}>
              I Understand and Agree
            </Button>
          </ModalBody>
        </ModalContent>
      </Modal>
  );
}
