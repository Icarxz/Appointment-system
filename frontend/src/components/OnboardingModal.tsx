import { useState } from 'react';
import {
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, VStack, FormControl, FormLabel,
  FormHelperText, Input, Select, Checkbox, Button, HStack, Text, Link as ChakraLink,
} from '@chakra-ui/react';
import { cohortConfig } from '../data/cohortConfig';
import { idHint, isValidId } from '../utils/idValidator';

interface Props {
  isOpen: boolean;
  role: string;
  email: string;
  name?: string; // from the school Google account
  token: string;
  onDone: (data: any) => void;
  onOpenPrivacy: () => void;
  // Students may browse read-only instead of finishing now. Leave undefined to make the form mandatory.
  onSkip?: () => void;
}

export default function OnboardingModal({ isOpen, role, email, name: googleName, token, onDone, onOpenPrivacy, onSkip }: Props) {
  const isStudent = role === 'STUDENT';
  const needsId = role !== 'ADMIN'; // students: student ID; faculty and dean: employee ID
  const idKind = isStudent ? 'STUDENT' : 'EMPLOYEE';
  const [gender, setGender] = useState('');
  const [program, setProgram] = useState('');
  const [year, setYear] = useState('');
  const [section, setSection] = useState('');
  const [position, setPosition] = useState('');
  const facultyPositions = ['Faculty', 'Librarian', 'Program Head (BS INFO)', 'Program Head (BS COMSCI)', 'Program Head (BLIS)', 'Dean'];
  const [idValue, setIdValue] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError('');
    if (!gender) return setError('Please select your gender.');
    if (isStudent && !(program && year && section)) return setError('Please select your program, year and section.');
    if (!isStudent && !position) return setError('Please select your position.');
    if (needsId && !isValidId(idValue, idKind)) return setError(`Enter a valid ${isStudent ? 'Student' : 'Employee'} ID (${idHint(idKind)}).`);
    if (!privacy) return setError('Please accept the Privacy Policy.');

    setSaving(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          gender,
          programPosition: isStudent ? `${program} ${year}${section}` : position,
          idValue: needsId ? idValue : undefined,
          privacyAccepted: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save your details.');
      onDone(data);
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={() => {}} closeOnOverlayClick={false} closeOnEsc={false} isCentered scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Complete your profile</ModalHeader>
        <ModalBody pb={6}>
          <VStack spacing={4} align="stretch">
            <Text fontSize="sm" color="gray.600">
              Signed in as <b>{googleName ? `${googleName} (${email})` : email}</b>. Your name comes from your school account. We just need a few details Google doesn't provide.
            </Text>
            <FormControl isRequired>
              <FormLabel>Gender</FormLabel>
              <Select placeholder="Select" value={gender} onChange={e => setGender(e.target.value)}>
                <option>Male</option><option>Female</option><option>Prefer not to say</option>
              </Select>
            </FormControl>
            {isStudent ? (
              <HStack align="start">
                <FormControl isRequired>
                  <FormLabel>Program</FormLabel>
                  <Select placeholder="Select" value={program} onChange={e => { setProgram(e.target.value); setYear(''); setSection(''); }}>
                    {Object.keys(cohortConfig).map(p => <option key={p}>{p}</option>)}
                  </Select>
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>Year</FormLabel>
                  <Select placeholder="-" isDisabled={!program} value={year} onChange={e => { setYear(e.target.value); setSection(''); }}>
                    {program && Object.keys(cohortConfig[program]).map(y => <option key={y}>{y}</option>)}
                  </Select>
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>Section</FormLabel>
                  <Select placeholder="-" isDisabled={!year} value={section} onChange={e => setSection(e.target.value)}>
                    {program && year && cohortConfig[program][year].map(s => <option key={s}>{s}</option>)}
                  </Select>
                </FormControl>
              </HStack>
            ) : (
              <FormControl isRequired>
                <FormLabel>Academic Position</FormLabel>
                <Input placeholder="e.g. IT Instructor or Program Head" value={position} onChange={e => setPosition(e.target.value)} />
              </FormControl>
            )}
            {needsId && (
              <FormControl isRequired isInvalid={idValue !== '' && !isValidId(idValue, idKind)}>
                <FormLabel>{isStudent ? 'School ID' : 'Employee ID'}</FormLabel>
                <Input
                  placeholder={isStudent ? 'e.g. 2025-S00001 or 2025-1234-A' : 'e.g. 2025S-00001'}
                  value={idValue}
                  onChange={e => setIdValue(e.target.value.toUpperCase())}
                />
                <FormHelperText>Accepted format: {idHint(idKind)}</FormHelperText>
              </FormControl>
            )}
            <Checkbox isChecked={privacy} onChange={e => setPrivacy(e.target.checked)}>
              I have read and accept the{' '}
              <ChakraLink color="blue.500" onClick={(e) => { e.preventDefault(); onOpenPrivacy(); }}>Privacy Policy</ChakraLink>
            </Checkbox>
            {error && <Text color="red.500" fontSize="sm">{error}</Text>}
            <Button colorScheme="blue" onClick={submit} isLoading={saving}>Save and continue</Button>
            {onSkip && (
              <Button variant="ghost" size="sm" onClick={onSkip}>
                Not now: browse read-only (booking stays locked)
              </Button>
            )}
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
