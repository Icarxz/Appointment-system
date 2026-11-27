import { useEffect, useState } from 'react';
import {
  Avatar, Badge, Box, Button, Checkbox, FormControl, FormHelperText, FormLabel, Heading, HStack, Input, Link as ChakraLink, Select, SimpleGrid, Spinner, Text,
  useColorModeValue, useDisclosure, useToast,
} from '@chakra-ui/react';
import { authFetch } from './authFetch';
import OnboardingModal from './OnboardingModal';
import PrivacyPolicyModal from './PrivacyPolicyModal';
import AvatarPicker from './AvatarPicker';
import SearchableSelect from './SearchableSelect';
import { PROGRAM_OPTIONS, programOfPosition } from '../utils/programs';
import { EMPLOYMENT_OPTIONS } from '../utils/employment';
import { IdTray, isIdComplete, idRawOf } from './IdTray';
import { cohortConfig, FACULTY_POSITIONS } from '../data/cohortConfig';
import { parseCohort } from './PeopleUi';
import PersonalHistoryPanel from './PersonalHistoryPanel';
import { normalizePersonName } from '../utils/personName';
import { friendlyError, responseError } from '../utils/friendlyError';

interface Profile {
  name: string; email: string; role: string; gender: string; programPosition: string;
  program?: string; employmentType?: string; // faculty only ('' when not set)
  schoolId: string; facultyId: string; privacyAcceptedAt: string | null; profileComplete: boolean; avatar: string;
  credentialConfirmationRequired: boolean; credentialFieldsLocked: boolean;
}

// The logged-in person's own profile. Newly provisioned students and staff review their account details here before first use.
export default function ProfilePage() {
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const { isOpen: privacyOpen, onOpen: onPrivacyOpen, onClose: onPrivacyClose } = useDisclosure();
  const toast = useToast();

  // edit mode
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [genderDraft, setGenderDraft] = useState('');
  const [idDraft, setIdDraft] = useState('');
  const [programDraft, setProgramDraft] = useState('');
  const [employmentDraft, setEmploymentDraft] = useState('');
  const [cohortDraft, setCohortDraft] = useState({ program: '', year: '', section: '' });
  const [positionDraft, setPositionDraft] = useState('');
  const [avatarDraft, setAvatarDraft] = useState<string | null | undefined>(undefined); // undefined = unchanged, null = remove
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const cardBg = useColorModeValue('#ffffff', '#111d30');
  const border = useColorModeValue('#dde3ec', '#1e3048');
  const text = useColorModeValue('#0f2240', '#e8f0fe');
  const muted = useColorModeValue('#6b7fa0', '#7a93b0');
  const valueBg = useColorModeValue('gray.50', '#17263b');

  useEffect(() => {
    authFetch(`${import.meta.env.VITE_API_URL}/api/auth/me`)
      .then(async r => { const d = await r.json(); if (!r.ok) throw responseError(r, d.error || 'Could not load your profile. Please try again.'); return d; })
      .then((data: Profile) => {
        setP(data);
        setPrivacyAccepted(!!data.privacyAcceptedAt);
        if (data.credentialConfirmationRequired) {
          localStorage.setItem('credentialConfirmationRequired', 'true');
        } else if (localStorage.getItem('credentialConfirmationRequired') === 'true') {
          localStorage.setItem('credentialConfirmationRequired', 'false');
          window.location.reload();
        }
      })
      .catch((e: any) => setError(friendlyError(e, 'Could not load your profile. Please try again.')));
  }, []);

  if (error) return <Text color="red.500">{error}</Text>;
  if (!p) return <Spinner />;

  const isStudent = p.role === 'STUDENT';
  const isFaculty = p.role === 'FACULTY';
  const isAdmin = p.role === 'ADMIN';
  const credentialReviewRequired = p.credentialConfirmationRequired;
  const credentialFieldsLocked = p.credentialFieldsLocked;
  const idKind = isStudent ? 'STUDENT' : 'FACULTY';
  const idLabel = isStudent ? 'School ID' : 'Employee ID';
  const idValue = isStudent ? p.schoolId : p.facultyId;
  const cohortValue = parseCohort(p.programPosition);
  const displayRole = isStudent ? 'Student' : isFaculty ? 'Faculty' : p.role === 'DEAN' ? 'Dean' : 'Admin';
  const Row = ({ label, value }: { label: string; value?: string | null }) => (
    <Box>
      <Text fontSize="sm" color={muted} mb={1}>{label}</Text>
      <Box
        minH="40px"
        display="flex"
        alignItems="center"
        px={3}
        py={2}
        borderWidth="1px"
        borderColor={border}
        borderRadius="md"
        bg={valueBg}
      >
        <Text fontSize="sm" fontWeight="medium" color={text} overflowWrap="anywhere">
          {value || '—'}
        </Text>
      </Box>
    </Box>
  );

  const startEdit = () => {
    setNameDraft(p.name);
    setGenderDraft(p.gender === 'Male' || p.gender === 'Female' ? p.gender : '');
    setIdDraft(idValue || '');
    setProgramDraft(p.program || '');
    setEmploymentDraft(p.employmentType || '');
    setCohortDraft(cohortValue);
    setPositionDraft(p.programPosition || '');
    setAvatarDraft(undefined);
    setEditing(true);
  };

  const nameClean = normalizePersonName(nameDraft);
  const nameChanged = !credentialFieldsLocked && nameClean !== normalizePersonName(p.name);
  const genderChanged = !credentialFieldsLocked && genderDraft !== '' && genderDraft !== p.gender;
  const idChanged = !credentialFieldsLocked && idRawOf(idDraft) !== idRawOf(idValue);
  const avatarChanged = avatarDraft !== undefined;
  const nextPosition = credentialReviewRequired ? positionDraft : p.programPosition;
  const isHead = !!programOfPosition(nextPosition); // a Program Head's program comes from the position
  const positionChanged = !credentialFieldsLocked && credentialReviewRequired && !isStudent && positionDraft !== p.programPosition;
  const previousPositionWasHead = !!programOfPosition(p.programPosition);
  const programChanged = !credentialFieldsLocked && isFaculty && !isHead && programDraft !== '' &&
    (programDraft !== (p.program || '') || (positionChanged && previousPositionWasHead));
  const employmentChanged = !credentialFieldsLocked && isFaculty && employmentDraft !== '' && employmentDraft !== (p.employmentType || '');
  const cohortChanged = !credentialFieldsLocked && isStudent && (
    cohortDraft.program !== cohortValue.program || cohortDraft.year !== cohortValue.year || cohortDraft.section !== cohortValue.section
  );
  const credentialChanged = nameChanged || genderChanged || idChanged || programChanged || employmentChanged || cohortChanged || positionChanged;
  const nameOk = nameClean.length >= 2 && nameClean.length <= 100;
  const idOk = !idChanged || isIdComplete(idKind, idDraft);
  const canSave = (credentialChanged || avatarChanged) && (!credentialChanged || (nameOk && idOk));

  const save = async () => {
    const body: Record<string, any> = {};
    if (nameChanged) body.name = nameClean;
    if (genderChanged) body.gender = genderDraft;
    if (idChanged) body.idValue = idDraft;
    if (avatarChanged) body.avatar = avatarDraft;
    if (programChanged) body.program = programDraft;
    if (employmentChanged) body.employmentType = employmentDraft;
    if (cohortChanged) {
      body.program = cohortDraft.program;
      body.year = cohortDraft.year;
      body.section = cohortDraft.section;
    }
    if (positionChanged) body.programPosition = positionDraft;
    setSaving(true);
    try {
      const r = await authFetch(`${import.meta.env.VITE_API_URL}/api/auth/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw responseError(r, d.error || 'Could not save your profile. Please try again.');
      const next = d.profile;
      const completeChanged = next.profileComplete !== p.profileComplete;
      setP({
        ...p, name: next.name, gender: next.gender, schoolId: next.schoolId, facultyId: next.facultyId,
        avatar: next.avatar, profileComplete: next.profileComplete, program: next.program,
        programPosition: next.programPosition, employmentType: next.employmentType,
        credentialConfirmationRequired: next.credentialConfirmationRequired,
      });
      if (next.name !== p.name) localStorage.setItem('userName', next.name);
      if (next.programPosition !== p.programPosition) localStorage.setItem('programPosition', next.programPosition || '');
      if (completeChanged) localStorage.setItem('onboardingComplete', String(next.profileComplete));
      toast({ title: 'Profile saved', status: 'success' });
      setEditing(false);
      // the dashboard header / booking lock read these from localStorage, so refresh when they changed
      if (next.name !== p.name || next.programPosition !== p.programPosition || completeChanged) window.location.reload();
    } catch (e: any) {
      toast({ title: 'Could not save your profile', description: friendlyError(e, 'Could not save your profile. Please try again.'), status: 'error' });
    }
    setSaving(false);
  };

  const confirmCredentials = async () => {
    setConfirming(true);
    try {
      const r = await authFetch(`${import.meta.env.VITE_API_URL}/api/auth/profile/confirm-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privacyAccepted }),
      });
      const d = await r.json();
      if (!r.ok) throw responseError(r, d.error || 'Could not confirm your credentials. Please try again.');
      localStorage.setItem('onboardingComplete', 'true');
      localStorage.setItem('credentialConfirmationRequired', 'false');
      localStorage.setItem('programPosition', d.profile.programPosition || '');
      toast({ title: 'Credentials confirmed', description: 'Your account details are now locked.', status: 'success' });
      window.location.reload();
    } catch (e: any) {
      toast({ title: 'Could not confirm credentials', description: friendlyError(e, 'Could not confirm your credentials. Please try again.'), status: 'error' });
    } finally {
      setConfirming(false);
    }
  };

  const shownAvatar = avatarDraft === undefined ? p.avatar : (avatarDraft || '');

  return (
    <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={border} shadow="sm" maxW="720px">
      <HStack justify="space-between" align="start" mb={5} spacing={4}>
        <HStack spacing={4} align="center">
          {!editing && <Avatar size="xl" name={p.name} src={p.avatar || undefined} />}
          <Box>
            <Heading size="md" color={text} mb={1}>{p.name}</Heading>
            <Badge colorScheme={credentialReviewRequired ? 'orange' : p.profileComplete ? 'green' : 'orange'}>
              {credentialReviewRequired ? 'Confirm your credentials' : p.profileComplete ? 'Profile complete' : 'Profile incomplete'}
            </Badge>
          </Box>
        </HStack>
        {!editing && !isAdmin && <Button size="sm" variant="outline" onClick={startEdit}>{credentialFieldsLocked ? 'Edit photo' : 'Edit profile'}</Button>}
      </HStack>

      {credentialReviewRequired && !editing && (
        <Box mb={5} p={4} borderRadius="md" bg="blue.50" borderWidth="1px" borderColor="blue.300" color="blue.900">
          <Text fontSize="sm" mb={3}>
            Review your account details. You can edit them before confirming; email and role can only be changed by an Admin. After confirmation, your account details are locked. Contact the administrator if you need a correction later.
          </Text>
          <Checkbox
            display="flex"
            alignItems="flex-start"
            width="100%"
            mb={3}
            isChecked={privacyAccepted}
            onChange={(e) => setPrivacyAccepted(e.target.checked)}
          >
            I have read and accept the{' '}
            <ChakraLink color="blue.600" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPrivacyOpen(); }}>Privacy Policy</ChakraLink>
          </Checkbox>
          <Button size="sm" alignSelf="flex-start" colorScheme="blue" onClick={confirmCredentials} isLoading={confirming} isDisabled={!privacyAccepted}>
            Confirm details
          </Button>
        </Box>
      )}

      {!p.profileComplete && !credentialReviewRequired && !editing && (
        <Box mb={5} p={4} borderRadius="md" bg="orange.50" borderWidth="1px" borderColor="orange.300" color="orange.900">
          <Text fontSize="sm" mb={3}>
            {isStudent
              ? 'Complete your profile details and ID verification to unlock consultation requests.'
              : 'Complete your profile details to finish setting up your account.'}
          </Text>
          <Button size="sm" colorScheme="orange" onClick={() => setFormOpen(true)}>Complete profile</Button>
        </Box>
      )}

      {!editing ? (
        <>
          <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={4}>
            <Row label="School email" value={p.email} />
            <Row label="Role" value={displayRole} />
            <Row label="Gender" value={p.gender} />
            {!isAdmin && <Row label={isStudent ? 'Program, year and section' : 'Academic position'} value={p.programPosition} />}
            {isFaculty && <Row label="Program" value={p.program} />}
            {isFaculty && <Row label="Employment type" value={p.employmentType} />}
            {!isAdmin && <Row label={idLabel} value={idValue} />}
            <Row label="Privacy Policy accepted" value={p.privacyAcceptedAt ? new Date(p.privacyAcceptedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : ''} />
          </SimpleGrid>
          <Text fontSize="xs" color={muted} mt={5}>
            {isAdmin
              ? 'Administrator account details are managed by the System Administrator.'
              : credentialFieldsLocked
              ? 'Your account details are confirmed and locked. You can still update your profile photo.'
              : `You can edit your photo, name, gender${isStudent ? '' : ', program and employment type'} and ID. Your email and role can only be changed by the administrator.`}
          </Text>
        </>
      ) : (
        <Box>
          <Box mb={6}>
            <AvatarPicker name={nameClean || p.name} value={shownAvatar} onChange={setAvatarDraft} />
          </Box>

          {credentialFieldsLocked ? (
            <Text fontSize="sm" color={muted} mb={5}>Your confirmed account details are locked. Only the profile photo can be changed.</Text>
          ) : (
            <>
              <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={4} mb={5}>
                <FormControl isRequired isInvalid={!nameOk}>
                  <FormLabel fontSize="sm">Full name</FormLabel>
                  <Input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => setNameDraft(current => current === p.name ? current : normalizePersonName(current))}
                    placeholder="First name MI. (optional) Last name"
                    maxLength={100}
                  />
                </FormControl>
                <FormControl isRequired={credentialReviewRequired}>
                  <FormLabel fontSize="sm">Gender</FormLabel>
                  <Select placeholder="Select gender" value={genderDraft} onChange={(e) => setGenderDraft(e.target.value)}>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </Select>
                </FormControl>
              </SimpleGrid>

              <FormControl mb={5}>
                <FormLabel fontSize="sm">{idLabel}</FormLabel>
                <IdTray kind={idKind} value={idDraft} onChange={setIdDraft} />
                {idChanged && !idOk && <Text fontSize="xs" color="red.500" mt={2} textAlign="center">Finish the ID, or restore your current one, to save.</Text>}
              </FormControl>

              {credentialReviewRequired && isStudent && (
                <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4} mb={5}>
                  <FormControl isRequired>
                    <FormLabel fontSize="sm">Program</FormLabel>
                    <SearchableSelect searchable={false} clearable={false} ariaLabel="Program" placeholder="Select program"
                      value={cohortDraft.program} onChange={(value) => setCohortDraft({ program: value, year: '', section: '' })}
                      options={Object.keys(cohortConfig).map(value => ({ value, label: value }))} />
                  </FormControl>
                  <FormControl isRequired>
                    <FormLabel fontSize="sm">Year</FormLabel>
                    <SearchableSelect searchable={false} clearable={false} ariaLabel="Year" placeholder="Select year" isDisabled={!cohortDraft.program}
                      value={cohortDraft.year} onChange={(value) => setCohortDraft({ ...cohortDraft, year: value, section: '' })}
                      options={cohortDraft.program ? Object.keys(cohortConfig[cohortDraft.program]).map(value => ({ value, label: value })) : []} />
                  </FormControl>
                  <FormControl isRequired>
                    <FormLabel fontSize="sm">Section</FormLabel>
                    <SearchableSelect searchable={false} clearable={false} ariaLabel="Section" placeholder="Select section" isDisabled={!cohortDraft.year}
                      value={cohortDraft.section} onChange={(value) => setCohortDraft({ ...cohortDraft, section: value })}
                      options={cohortDraft.program && cohortDraft.year ? cohortConfig[cohortDraft.program][cohortDraft.year].map(value => ({ value, label: value })) : []} />
                  </FormControl>
                </SimpleGrid>
              )}

              {credentialReviewRequired && !isStudent && (
                <FormControl isRequired mb={5}>
                  <FormLabel fontSize="sm">Academic position</FormLabel>
                  <SearchableSelect searchable={false} clearable={false} ariaLabel="Academic position" placeholder="Select position"
                    value={positionDraft} onChange={setPositionDraft}
                    options={FACULTY_POSITIONS.map(value => ({ value, label: value }))} />
                </FormControl>
              )}

              {isFaculty && (
                <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={4} mb={5}>
                  <FormControl>
                    <FormLabel fontSize="sm">Program</FormLabel>
                    <SearchableSelect searchable={false} clearable={false} ariaLabel="Program" placeholder="Select program" isDisabled={isHead}
                      value={isHead ? (programOfPosition(nextPosition) || p.program || '') : programDraft} onChange={setProgramDraft} options={PROGRAM_OPTIONS} />
                    {isHead && <FormHelperText>Taken from your position.</FormHelperText>}
                  </FormControl>
                  <FormControl>
                    <FormLabel fontSize="sm">Employment type</FormLabel>
                    <SearchableSelect searchable={false} clearable={false} ariaLabel="Employment type" placeholder="Select type"
                      value={employmentDraft} onChange={setEmploymentDraft} options={EMPLOYMENT_OPTIONS} />
                  </FormControl>
                </SimpleGrid>
              )}

              <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={4} mb={5} opacity={0.75}>
                <Row label="School email (not editable)" value={p.email} />
                <Row label="Role (not editable)" value={displayRole} />
                {!credentialReviewRequired && !isAdmin && (
                  <Row label={`${isStudent ? 'Program, year and section' : 'Academic position'} (not editable)`} value={p.programPosition} />
                )}
              </SimpleGrid>
            </>
          )}

          <HStack justify="flex-end" spacing={3}>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} isDisabled={saving}>Cancel</Button>
            <Button size="sm" colorScheme="blue" onClick={save} isLoading={saving} isDisabled={!canSave}>Save changes</Button>
          </HStack>
        </Box>
      )}

      <OnboardingModal
        isOpen={formOpen}
        role={p.role}
        email={p.email}
        name={p.name}
        token={localStorage.getItem('token') || ''}
        onOpenPrivacy={onPrivacyOpen}
        onSkip={() => setFormOpen(false)}
        onDone={(data) => {
          localStorage.setItem('token', data.token);
          localStorage.setItem('programPosition', data.programPosition || '');
          localStorage.setItem('onboardingComplete', 'true');
          localStorage.setItem('credentialConfirmationRequired', 'false');
          window.location.reload();
        }}
      />
      <PrivacyPolicyModal isOpen={privacyOpen} onClose={onPrivacyClose} />
      <PersonalHistoryPanel />
    </Box>
  );
}
