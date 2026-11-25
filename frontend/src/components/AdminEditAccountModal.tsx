import { useEffect, useState } from 'react';
import {
  Box, Button, FormControl, FormHelperText, FormLabel, HStack, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay,
  Select, SimpleGrid, Text, useColorModeValue, useToast,
} from '@chakra-ui/react';
import { authFetch } from './authFetch';
import { IdTray, isIdComplete, idRawOf } from './IdTray';
import SearchableSelect from './SearchableSelect';
import { parseCohort } from './PeopleUi';
import { cohortConfig, FACULTY_POSITIONS } from '../data/cohortConfig';
import { PROGRAM_OPTIONS, facultyProgram, programOfPosition } from '../utils/programs';
import { EMPLOYMENT_OPTIONS } from '../utils/employment';
import { normalizePersonName } from '../utils/personName';

// Admin > Faculty / Students > Edit. The same form a person sees on their own profile (name, gender, School / Faculty ID), plus program,
// year and section for a student, or the program and employment type (Full-time / Part-time) for faculty. Email (it has its own safe change) is not editable here; a
// faculty member's academic position are editable here (a role change signs the person out); a Program Head's program comes from the position.
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
  const [role, setRole] = useState('');             // the role being chosen: STUDENT / FACULTY / DEAN ('' = unchanged)
  const [position, setPosition] = useState('');     // faculty / Dean academic position
  const wasStudent = user?.role === 'STUDENT';
  const roleNow = role || user?.role || '';
  const isStudent = roleNow === 'STUDENT';
  const idKind = isStudent ? 'STUDENT' : 'FACULTY';
  const idValue: string = (isStudent ? user?.schoolId : user?.facultyId) || '';
  const cohort = parseCohort(wasStudent ? user?.programPosition : '');

  const [name, setName] = useState('');
  const [gender, setGender] = useState('');
  const [idDraft, setIdDraft] = useState('');
  const [program, setProgram] = useState('');
  const [year, setYear] = useState('');
  const [section, setSection] = useState('');
  const [fProgram, setFProgram] = useState('');       // faculty: BS INFO / BS COMSCI / BLIS
  const [employment, setEmployment] = useState('');   // faculty: Full-time / Part-time
  const [saving, setSaving] = useState(false);

  // Start from the account's current details each time a different account is opened
  useEffect(() => {
    if (!user) return;
    const c = parseCohort(user.role === 'STUDENT' ? user.programPosition : '');
    setRole(''); setPosition(user.role === 'STUDENT' ? '' : (user.programPosition || ''));
    setName(normalizePersonName(user.name || '')); setGender(user.gender || ''); setIdDraft((user.role === 'STUDENT' ? user.schoolId : user.facultyId) || '');
    setProgram(c.program); setYear(c.year); setSection(c.section); setSaving(false);
    setFProgram(facultyProgram(user)); setEmployment(user.employmentType || '');
  }, [user?._id]);

  if (!user) return null;

  const nameClean = normalizePersonName(name);
  const nameChanged = nameClean !== (user.name || '');
  const nameOk = nameClean.length >= 2 && nameClean.length <= 100;
  const genderChanged = gender !== '' && gender !== (user.gender || '');
  const idChanged = idRawOf(idDraft) !== idRawOf(idValue);
  const idOk = !idChanged && !idValue ? true : isIdComplete(idKind, idDraft);
  const currentIdYear = new Date().getFullYear();
  const idYear = Number(idRawOf(idDraft).slice(0, 4));
  const idYearTooNew = idRawOf(idDraft).length >= 4 && idYear > currentIdYear;
  const roleChanged = role !== '' && role !== user.role;
  const cohortChanged = isStudent && (roleChanged || program !== cohort.program || year !== cohort.year || section !== cohort.section);
  const cohortOk = !cohortChanged || (!!program && !!year && !!section);
  const positionChanged = !isStudent && position !== '' && position !== (wasStudent ? '' : (user.programPosition || ''));
  const isHead = !isStudent && !!programOfPosition(position || (wasStudent ? '' : user.programPosition)); // a Program Head's program comes from the position
  const fProgramChanged = !isStudent && !isHead && fProgram !== '' && fProgram !== facultyProgram(user);
  const employmentChanged = !isStudent && employment !== '' && employment !== (user.employmentType || '');
  const legacyGender = !!user.gender && user.gender !== 'Male' && user.gender !== 'Female'; // the retired 'Prefer not to say'
  // Switching role: to Student needs a program / year / section and a School ID; from Student to Faculty or Dean needs a position.
  const roleOk = !roleChanged || (isStudent ? (!!program && !!year && !!section && (!!user.schoolId || (idChanged && idOk))) : (!wasStudent || !!position));
  const canSave = (nameChanged || genderChanged || idChanged || cohortChanged || fProgramChanged || employmentChanged || roleChanged || positionChanged)
    && nameOk && idOk && cohortOk && roleOk;

  const save = async () => {
    const body: Record<string, string> = {};
    if (nameChanged) body.name = nameClean;
    if (genderChanged) body.gender = gender;
    if (idChanged) body.idValue = idDraft;
    if (cohortChanged) { body.program = program; body.year = year; body.section = section; }
    if (fProgramChanged) body.program = fProgram;
    if (employmentChanged) body.employmentType = employment;
    if (roleChanged) body.role = role;
    if (positionChanged || (roleChanged && !isStudent && wasStudent)) body.programPosition = position;
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
        <ModalHeader>Edit {wasStudent ? 'student' : user.role === 'DEAN' ? 'Dean' : 'faculty'} account</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={4} mb={5}>
            <FormControl isRequired isInvalid={!nameOk}>
              <FormLabel fontSize="sm">Full name</FormLabel>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                onBlur={() => setName(current => normalizePersonName(current))}
                placeholder="First name MI. (optional) Last name"
                maxLength={100}
              />
              <FormHelperText>Names are capitalized automatically; middle names stay as entered.</FormHelperText>
            </FormControl>
            <FormControl>
              <FormLabel fontSize="sm">Gender</FormLabel>
              <Select placeholder="Select gender" value={gender} onChange={e => setGender(e.target.value)}>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </Select>
              {legacyGender && <FormHelperText>Currently saved as "{user.gender}". Choose Male or Female to change it.</FormHelperText>}
            </FormControl>
          </SimpleGrid>

          <FormControl mb={5}>
            <FormLabel fontSize="sm">{isStudent ? 'School ID' : 'Employee ID'}</FormLabel>
            <IdTray kind={idKind} value={idDraft} onChange={setIdDraft} />
            {!idOk && (
              <Text fontSize="xs" color="red.500" mt={2} textAlign="center">
                {idYearTooNew
                  ? `The ID year must be ${currentIdYear} or earlier. Update this ID to save changes.`
                  : 'Enter a valid ID, or restore your current one, to save.'}
              </Text>
            )}
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

          {!isStudent && (
            <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={4} mb={5}>
              <FormControl>
                <FormLabel fontSize="sm">Program</FormLabel>
                <SearchableSelect portal searchable={false} clearable={false} ariaLabel="Program" placeholder="Not set" isDisabled={isHead}
                  value={fProgram} onChange={setFProgram} options={PROGRAM_OPTIONS} />
                {isHead && <FormHelperText>Taken from the position.</FormHelperText>}
              </FormControl>
              <FormControl>
                <FormLabel fontSize="sm">Employment type</FormLabel>
                <SearchableSelect portal searchable={false} clearable={false} ariaLabel="Employment type" placeholder="Not set"
                  value={employment} onChange={setEmployment} options={EMPLOYMENT_OPTIONS} />
              </FormControl>
            </SimpleGrid>
          )}

          <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={4} mb={5}>
            <Box>
              <Row label="School email (not editable here)" value={user.email} />
              <Button variant="link" size="xs" colorScheme="blue" mt={1} onClick={() => onChangeEmail(user)}>Change email</Button>
            </Box>
            <FormControl>
              <FormLabel fontSize="sm">Role</FormLabel>
              <SearchableSelect portal searchable={false} clearable={false} ariaLabel="Role" placeholder="Select"
                value={roleNow}
                onChange={v => {
                  setRole(v === user.role ? '' : v);
                  setIdDraft(((v === 'STUDENT' ? user.schoolId : user.facultyId) || ''));
                  setProgram(v === user.role ? cohort.program : ''); setYear(v === user.role ? cohort.year : ''); setSection(v === user.role ? cohort.section : '');
                  setPosition(v !== 'STUDENT' && user.role !== 'STUDENT' ? (user.programPosition || '') : '');
                }}
                options={[{ value: 'STUDENT', label: 'Student' }, { value: 'FACULTY', label: 'Faculty' }, { value: 'DEAN', label: 'Dean' }]} />
              {roleChanged && <FormHelperText>Saving signs this person out. They sign in again with the new role. Their appointments stay.</FormHelperText>}
            </FormControl>
            {!isStudent && (
              <FormControl isRequired={roleChanged && wasStudent}>
                <FormLabel fontSize="sm">Academic position</FormLabel>
                <SearchableSelect portal searchable={false} clearable={false} ariaLabel="Academic position" placeholder="Select"
                  value={position} onChange={setPosition} options={FACULTY_POSITIONS.map(item => ({ value: item, label: item }))} />
              </FormControl>
            )}
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
