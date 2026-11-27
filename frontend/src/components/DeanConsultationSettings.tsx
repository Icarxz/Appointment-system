import { useEffect, useState } from 'react';
import { Box, Button, FormControl, FormLabel, Heading, HStack, NumberInput, NumberInputField, Spinner, Switch, Text, useToast } from '@chakra-ui/react';
import { authFetch } from './authFetch';
import { useNavPalette } from '../utils/uiTokens';
import { friendlyError, responseError } from '../utils/friendlyError';

interface Settings { acceptsConsultations: boolean; weeklyRequestLimit: number }

// The Dean's own switch for student consultation requests, and the most requests one student may send him in a week.
// While it is off, the Dean's dashboard looks exactly as it did before and students cannot see him in the faculty list.
export default function DeanConsultationSettings({ onChanged }: { onChanged?: (s: Settings) => void }) {
  const C = useNavPalette();
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [limit, setLimit] = useState('5');
  const [busy, setBusy] = useState(false);
  const base = `${import.meta.env.VITE_API_URL}/api/faculty/dean/consultation-settings`;

  useEffect(() => {
    authFetch(base)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw responseError(r, d.error || 'Could not load your settings. Please try again.'); return d as Settings; })
      .then((d) => { setSettings(d); setLimit(String(d.weeklyRequestLimit)); })
      .catch((e: any) => toast({ title: 'Could not load your settings', description: friendlyError(e, 'Could not load your settings. Please try again.'), status: 'error', position: 'top' }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (body: Partial<Settings>, okTitle: string) => {
    setBusy(true);
    try {
      const res = await authFetch(base, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw responseError(res, d.error || 'Could not save your settings. Please try again.');
      setSettings(d); setLimit(String(d.weeklyRequestLimit)); onChanged?.(d);
      toast({ title: okTitle, status: 'success', position: 'top' });
    } catch (e: any) {
      toast({ title: 'Could not save', description: friendlyError(e, 'Could not save your settings. Please try again.'), status: 'error', position: 'top' });
    }
    setBusy(false);
  };

  if (!settings) return <Spinner />;
  const limitNumber = Number(limit);
  const limitValid = Number.isInteger(limitNumber) && limitNumber >= 1 && limitNumber <= 20;

  return (
    <Box bg={C.surface} p={6} borderRadius="lg" borderWidth="1px" borderColor={C.border} shadow="sm" maxW="640px">
      <Heading size="sm" color={C.text} mb={1}>Student consultation requests</Heading>
      <Text fontSize="sm" color={C.textMid} mb={4}>
        Turn this on to let students request a consultation with you. You will then see Requests and My Analytics in your menu.
      </Text>
      <FormControl display="flex" alignItems="center" mb={5}>
        <Switch id="dean-accepts" isChecked={settings.acceptsConsultations} isDisabled={busy}
          onChange={(e) => save({ acceptsConsultations: e.target.checked }, e.target.checked ? 'Students can now request you' : 'Students can no longer request you')} />
        <FormLabel htmlFor="dean-accepts" mb={0} ml={3} color={C.text}>{settings.acceptsConsultations ? 'Accepting requests' : 'Not accepting requests'}</FormLabel>
      </FormControl>
      <FormControl>
        <FormLabel color={C.text} fontSize="sm">Most requests one student may send you per week (Monday to Sunday)</FormLabel>
        <HStack>
          <NumberInput maxW="100px" min={1} max={20} value={limit} onChange={setLimit} isDisabled={busy}>
            <NumberInputField aria-label="Weekly request limit" />
          </NumberInput>
          <Button size="sm" colorScheme="blue" isLoading={busy} isDisabled={!limitValid || limitNumber === settings.weeklyRequestLimit}
            onClick={() => save({ weeklyRequestLimit: limitNumber }, 'Weekly limit saved')}>Save limit</Button>
        </HStack>
        <Text fontSize="xs" color={C.textMid} mt={2}>Declined, expired and student-cancelled requests do not count toward the limit.</Text>
      </FormControl>
    </Box>
  );
}
