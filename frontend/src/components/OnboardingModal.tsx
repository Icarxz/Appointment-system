import { useState } from 'react';
import {
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, VStack, FormControl, FormLabel,
  FormHelperText, Input, Checkbox, Button, HStack, Text, Link as ChakraLink,
} from '@chakra-ui/react';
import { cohortConfig } from '../data/cohortConfig';
import SearchableSelect from './SearchableSelect';
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
              <SearchableSelect portal searchable={false} clearable={false} ariaLabel="Gender" placeholder="Select" value={gender} onChange={setGender}
                options={['Male', 'Female', 'Prefer not to say'].map(g => ({ value: g, label: g }))} />
            </FormControl>
            {isStudent ? (
              <HStack align="start">
                <FormControl isRequired>
                  <FormLabel>Program</FormLabel>
                  <SearchableSelect portal searchable={false} clearable={false} ariaLabel="Program" placeholder="Select" value={program}
                    onChange={v => { setProgram(v); setYear(''); setSection(''); }}
                    options={Object.keys(cohortConfig).map(p => ({ value: p, label: p }))} />
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>Year</FormLabel>
                  <SearchableSelect portal searchable={false} clearable={false} ariaLabel="Year" placeholder="-" isDisabled={!program} value={year}
                    onChange={v => { setYear(v); setSection(''); }}
                    options={program ? Object.keys(cohortConfig[program]).map(y => ({ value: y, label: y })) : []} />
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>Section</FormLabel>
                  <SearchableSelect portal searchable={false} clearable={false} ariaLabel="Section" placeholder="-" isDisabled={!year} value={section} onChange={setSection}
                    options={program && year ? cohortConfig[program][year].map(sec => ({ value: sec, label: sec })) : []} />
                </FormControl>
              </HStack>
            ) : (
              <FormControl isRequired>
                <FormLabel>Academic Position</FormLabel>
                <SearchableSelect portal searchable={false} clearable={false} ariaLabel="Academic Position" placeholder="Select position" value={position} onChange={setPosition}
                  options={facultyPositions.map(item => ({ value: item, label: item }))} />
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
