import { useEffect, useState } from 'react';
import {
  Box, Button, FormControl, FormLabel, HStack, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay,
  Select, SimpleGrid, Text, useColorModeValue, useToast,
} from '@chakra-ui/react';
import { authFetch } from './authFetch';
import { IdTray, isIdComplete, idRawOf } from './IdTray';
import SearchableSelect from './SearchableSelect';
import { parseCohort } from './PeopleUi';
import { cohortConfig } from '../data/cohortConfig';

// Admin > Faculty / Students > Edit. The same form a person sees on their own profile (name, gender, School / Faculty ID), plus program,
// year and section for a student. Email (it has its own safe change), role and a faculty member's academic position are shown but not editable.
// Only the fields that changed are sent, and the server checks every one of them.

interface Props { user: any | null; onClose: () => void; onSaved: () => void; onChangeEmail: (u: any) => void }

function Row({ label, value }: { label: string; value?: string }) {
  const muted = useColorModeValue('#64748b', '#8fa6c4');
  return (
    <Box>
      <Text fontSize="xs" color={muted}>{label}</Text>
      <Text fontWeight="600" wordBreak="break-word">{value || '—'}</Text>
    </Box>
  );
}

export default function AdminEditAccountModal({ user, onClose, onSaved, onChangeEmail }: Props) {
  const toast = useToast();
  const isStudent = user?.role === 'STUDENT';
  const idKind = isStudent ? 'STUDENT' : 'FACULTY';
  const idValue: string = (isStudent ? user?.schoolId : user?.facultyId) || '';
  const cohort = parseCohort(user?.programPosition);

  const [name, setName] = useState('');
  const [gender, setGender] = useState('');
  const [idDraft, setIdDraft] = useState('');
  const [program, setProgram] = useState('');
  const [year, setYear] = useState('');
  const [section, setSection] = useState('');
  const [saving, setSaving] = useState(false);

  // Start from the account's current details each time a different account is opened
  useEffect(() => {
    if (!user) return;
    const c = parseCohort(user.programPosition);
    setName(user.name || ''); setGender(user.gender || ''); setIdDraft((user.role === 'STUDENT' ? user.schoolId : user.facultyId) || '');
    setProgram(c.program); setYear(c.year); setSection(c.section); setSaving(false);
  }, [user?._id]);

  if (!user) return null;

  const nameClean = name.replace(/\s+/g, ' ').trim();
  const nameChanged = nameClean !== (user.name || '');
  const nameOk = nameClean.length >= 2 && nameClean.length <= 100;
  const genderChanged = gender !== '' && gender !== (user.gender || '');
  const idChanged = idRawOf(idDraft) !== idRawOf(idValue);
  const idOk = !idChanged || isIdComplete(idKind, idDraft);
  const cohortChanged = isStudent && (program !== cohort.program || year !== cohort.year || section !== cohort.section);
  const cohortOk = !cohortChanged || (!!program && !!year && !!section);
  const canSave = (nameChanged || genderChanged || idChanged || cohortChanged) && nameOk && idOk && cohortOk;

  const save = async () => {
    const body: Record<string, string> = {};
    if (nameChanged) body.name = nameClean;
    if (genderChanged) body.gender = gender;
    if (idChanged) body.idValue = idDraft;
    if (cohortChanged) { body.program = program; body.year = year; body.section = section; }
    setSaving(true);
    try {
      const res = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/users/${user._id}/profile`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the changes.');
      toast({ title: 'Changes saved', description: data.message, status: 'success' });
      onSaved();
      onClose();
    } catch (e: any) {
      toast({ title: 'Could not save', description: e.message, status: 'error' });
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} isCentered size="xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Edit {isStudent ? 'student' : 'faculty'} account</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={4} mb={5}>
            <FormControl isRequired isInvalid={!nameOk}>
              <FormLabel fontSize="sm">Full name</FormLabel>
              <Input value={name} onChange={e => setName(e.target.value)} maxLength={100} />
            </FormControl>
            <FormControl>
              <FormLabel fontSize="sm">Gender</FormLabel>
              <Select placeholder="Select gender" value={gender} onChange={e => setGender(e.target.value)}>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </Select>
            </FormControl>
          </SimpleGrid>

          <FormControl mb={5}>
            <FormLabel fontSize="sm">{isStudent ? 'School ID' : 'Employee ID'}</FormLabel>
            <IdTray kind={idKind} value={idDraft} onChange={setIdDraft} />
            {idChanged && !idOk && <Text fontSize="xs" color="red.500" mt={2} textAlign="center">Finish the ID, or restore the current one, to save.</Text>}
          </FormControl>

          {isStudent && (
            <HStack align="start" spacing={4} mb={5}>
              <FormControl isRequired>
                <FormLabel fontSize="sm">Program</FormLabel>
                <SearchableSelect portal searchable={false} clearable={false} ariaLabel="Program" placeholder="Select" value={program}
                  onChange={v => { setProgram(v); setYear(''); setSection(''); }}
                  options={Object.keys(cohortConfig).map(p => ({ value: p, label: p }))} />
              </FormControl>
              <FormControl isRequired>
                <FormLabel fontSize="sm">Year</FormLabel>
                <SearchableSelect portal searchable={false} clearable={false} ariaLabel="Year" placeholder="-" isDisabled={!program} value={year}
                  onChange={v => { setYear(v); setSection(''); }}
                  options={cohortConfig[program] ? Object.keys(cohortConfig[program]).map(y => ({ value: y, label: y })) : []} />
              </FormControl>
              <FormControl isRequired>
                <FormLabel fontSize="sm">Section</FormLabel>
                <SearchableSelect portal searchable={false} clearable={false} ariaLabel="Section" placeholder="-" isDisabled={!year} value={section} onChange={setSection}
                  options={cohortConfig[program]?.[year] ? cohortConfig[program][year].map(s => ({ value: s, label: s })) : []} />
              </FormControl>
            </HStack>
          )}

          <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={4} mb={5} opacity={0.8}>
            <Box>
              <Row label="School email (not editable here)" value={user.email} />
              <Button variant="link" size="xs" colorScheme="blue" mt={1} onClick={() => onChangeEmail(user)}>Change email</Button>
            </Box>
            <Row label="Role (not editable)" value={isStudent ? 'Student' : 'Faculty'} />
            {!isStudent && <Row label="Academic position (not editable)" value={user.programPosition} />}
          </SimpleGrid>

          <HStack justify="flex-end" spacing={3}>
            <Button variant="ghost" onClick={onClose} isDisabled={saving}>Cancel</Button>
            <Button colorScheme="blue" onClick={save} isDisabled={!canSave} isLoading={saving}>Save changes</Button>
          </HStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
