import { useEffect, useState } from 'react';
import {
  Avatar, Badge, Box, Button, FormControl, FormLabel, Heading, HStack, Input, Select, SimpleGrid, Spinner, Text,
  useColorModeValue, useDisclosure, useToast,
} from '@chakra-ui/react';
import { authFetch } from './authFetch';
import OnboardingModal from './OnboardingModal';
import PrivacyPolicyModal from './PrivacyPolicyModal';
import AvatarPicker from './AvatarPicker';
import { IdTray, isIdComplete, idRawOf } from './IdTray';

interface Profile {
  name: string; email: string; role: string; gender: string; programPosition: string;
  schoolId: string; facultyId: string; privacyAcceptedAt: string | null; profileComplete: boolean; avatar: string;
}

// The logged-in person's own profile (students and faculty).
// Editable: photo, name, gender (Male / Female), School / Employee ID.
// Read-only: email, role, program-year-section / academic position.
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
  const [avatarDraft, setAvatarDraft] = useState<string | null | undefined>(undefined); // undefined = unchanged, null = remove

  const cardBg = useColorModeValue('#ffffff', '#111d30');
  const border = useColorModeValue('#dde3ec', '#1e3048');
  const text = useColorModeValue('#0f2240', '#e8f0fe');
  const muted = useColorModeValue('#6b7fa0', '#7a93b0');

  useEffect(() => {
    authFetch(`${import.meta.env.VITE_API_URL}/api/auth/me`)
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then(setP)
      .catch((e: any) => setError(e.message || 'Could not load your profile.'));
  }, []);

  if (error) return <Text color="red.500">{error}</Text>;
  if (!p) return <Spinner />;

  const isStudent = p.role === 'STUDENT';
  const idKind = isStudent ? 'STUDENT' : 'FACULTY';
  const idLabel = isStudent ? 'School ID' : 'Employee ID';
  const idValue = isStudent ? p.schoolId : p.facultyId;
  const Row = ({ label, value }: { label: string; value?: string | null }) => (
    <Box>
      <Text fontSize="xs" color={muted}>{label}</Text>
      <Text fontWeight="600" color={text}>{value || '—'}</Text>
    </Box>
  );

  const startEdit = () => {
    setNameDraft(p.name);
    setGenderDraft(p.gender === 'Male' || p.gender === 'Female' ? p.gender : '');
    setIdDraft(idValue || '');
    setAvatarDraft(undefined);
    setEditing(true);
  };

  const nameClean = nameDraft.replace(/\s+/g, ' ').trim();
  const nameChanged = nameClean !== p.name;
  const genderChanged = genderDraft !== '' && genderDraft !== p.gender;
  const idChanged = idRawOf(idDraft) !== idRawOf(idValue);
  const avatarChanged = avatarDraft !== undefined;
  const nameOk = nameClean.length >= 2 && nameClean.length <= 100;
  const idOk = !idChanged || isIdComplete(idKind, idDraft);
  const canSave = (nameChanged || genderChanged || idChanged || avatarChanged) && nameOk && idOk;

  const save = async () => {
    const body: Record<string, any> = {};
    if (nameChanged) body.name = nameClean;
    if (genderChanged) body.gender = genderDraft;
    if (idChanged) body.idValue = idDraft;
    if (avatarChanged) body.avatar = avatarDraft;
    setSaving(true);
    try {
      const r = await authFetch(`${import.meta.env.VITE_API_URL}/api/auth/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      const next = d.profile;
      const completeChanged = next.profileComplete !== p.profileComplete;
      setP({ ...p, name: next.name, gender: next.gender, schoolId: next.schoolId, facultyId: next.facultyId, avatar: next.avatar, profileComplete: next.profileComplete });
      if (next.name !== p.name) localStorage.setItem('userName', next.name);
      if (completeChanged) localStorage.setItem('onboardingComplete', String(next.profileComplete));
      toast({ title: 'Profile saved', status: 'success' });
      setEditing(false);
      // the dashboard header / booking lock read these from localStorage, so refresh when they changed
      if (next.name !== p.name || completeChanged) window.location.reload();
    } catch (e: any) {
      toast({ title: 'Could not save your profile', description: e.message, status: 'error' });
    }
    setSaving(false);
  };

  const shownAvatar = avatarDraft === undefined ? p.avatar : (avatarDraft || '');

  return (
    <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={border} shadow="sm" maxW="720px">
      <HStack justify="space-between" align="start" mb={5} spacing={4}>
        <HStack spacing={4} align="center">
          {!editing && <Avatar size="xl" name={p.name} src={p.avatar || undefined} />}
          <Box>
            <Heading size="md" color={text} mb={1}>{p.name}</Heading>
            <Badge colorScheme={p.profileComplete ? 'green' : 'orange'}>{p.profileComplete ? 'Profile complete' : 'Profile incomplete'}</Badge>
          </Box>
        </HStack>
        {!editing && <Button size="sm" variant="outline" onClick={startEdit}>Edit profile</Button>}
      </HStack>

      {!p.profileComplete && !editing && (
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
            <Row label="Role" value={isStudent ? 'Student' : 'Faculty'} />
            <Row label="Gender" value={p.gender} />
            <Row label={isStudent ? 'Program, year and section' : 'Academic position'} value={p.programPosition} />
            <Row label={idLabel} value={idValue} />
            <Row label="Privacy Policy accepted" value={p.privacyAcceptedAt ? new Date(p.privacyAcceptedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : ''} />
          </SimpleGrid>
          <Text fontSize="xs" color={muted} mt={5}>
            You can edit your photo, name, gender and ID. Your email, role and {isStudent ? 'program, year and section' : 'academic position'} can only be changed by the administrator.
          </Text>
        </>
      ) : (
        <Box>
          <Box mb={6}>
            <AvatarPicker name={nameClean || p.name} value={shownAvatar} onChange={setAvatarDraft} />
          </Box>

          <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={4} mb={5}>
            <FormControl isRequired isInvalid={!nameOk}>
              <FormLabel fontSize="sm">Full name</FormLabel>
              <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={100} />
            </FormControl>
            <FormControl>
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

          <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={4} mb={5} opacity={0.75}>
            <Row label="School email (not editable)" value={p.email} />
            <Row label="Role (not editable)" value={isStudent ? 'Student' : 'Faculty'} />
            <Row label={`${isStudent ? 'Program, year and section' : 'Academic position'} (not editable)`} value={p.programPosition} />
          </SimpleGrid>

          <HStack justify="flex-end" spacing={3}>
            <Button variant="ghost" onClick={() => setEditing(false)} isDisabled={saving}>Cancel</Button>
            <Button colorScheme="blue" onClick={save} isLoading={saving} isDisabled={!canSave}>Save changes</Button>
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
          window.location.reload();
        }}
      />
      <PrivacyPolicyModal isOpen={privacyOpen} onClose={onPrivacyClose} />
    </Box>
  );
}
