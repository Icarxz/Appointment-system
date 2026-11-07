import { useEffect, useState, useCallback } from 'react';
import {
  Box, Heading, Text, Input, Textarea, Select, Button, HStack, VStack, Badge, Flex,
  Table, Thead, Tbody, Tr, Th, Td, TableContainer, useToast,
} from '@chakra-ui/react';
import { authFetch } from './authFetch';

interface Palette { surface: string; border: string; text: string; textMid: string }

interface BroadcastRow {
  _id: string;
  title: string;
  message: string;
  audience: 'ALL' | 'STUDENT' | 'FACULTY';
  priority: 'URGENT' | 'NOTICE';
  status: 'ACTIVE' | 'EXPIRED' | 'ENDED';
  expiresAt: string;
  createdAt: string;
}

const DURATIONS = [
  { label: '1 hour', value: 60 },
  { label: '3 hours', value: 180 },
  { label: 'Until end of day (12 hrs)', value: 720 },
  { label: '1 day', value: 1440 },
  { label: '3 days', value: 4320 },
  { label: '7 days', value: 10080 },
];
const AUDIENCE_LABEL = { ALL: 'Students & Faculty', STUDENT: 'Students only', FACULTY: 'Faculty only' };
const PRIORITY_LABEL = { URGENT: 'Urgent', NOTICE: 'Notice' } as const;
const BROADCAST_STATUS_LABEL = { ACTIVE: 'Active', EXPIRED: 'Expired', ENDED: 'Ended' } as const;
const fmt = (s: string) => new Date(s).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function DeanBroadcastPanel({ C }: { C: Palette }) {
  const toast = useToast();
  const api = `${import.meta.env.VITE_API_URL}/api/faculty`;
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<'ALL' | 'STUDENT' | 'FACULTY'>('ALL');
  const [priority, setPriority] = useState<'URGENT' | 'NOTICE'>('URGENT');
  const [duration, setDuration] = useState(180);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<BroadcastRow[]>([]);

  const load = useCallback(() => {
    authFetch(`${api}/broadcasts`)
      .then(r => (r.ok ? r.json() : []))
      .then(d => setHistory(Array.isArray(d) ? d : []))
      .catch(() => setHistory([]));
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!title.trim() || !message.trim()) {
      toast({ title: 'Add a title and a message first.', status: 'warning', duration: 3000 });
      return;
    }
    const ok = window.confirm(
      `Send this ${priority === 'URGENT' ? 'URGENT ' : ''}announcement to ${AUDIENCE_LABEL[audience]}?\n\nIt will be pinned on their dashboards immediately.`
    );
    if (!ok) return;
    setSending(true);
    try {
      const res = await authFetch(`${api}/broadcasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, message, audience, priority, durationMinutes: duration }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send.');
      toast({ title: 'Broadcast sent', description: `Delivered to ${data.recipients} user(s).`, status: 'success', duration: 4000 });
      setTitle(''); setMessage('');
      load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Failed to send.', status: 'error', duration: 4000 });
    } finally { setSending(false); }
  };

  const endNow = async (id: string) => {
    if (!window.confirm('End this broadcast now? The banner will be removed from all dashboards.')) return;
    const res = await authFetch(`${api}/broadcasts/${id}/end`, { method: 'PATCH' });
    if (res.ok) { toast({ title: 'Broadcast ended', status: 'info', duration: 2500 }); load(); }
    else toast({ title: 'Could not end broadcast.', status: 'error', duration: 3000 });
  };

  const active = history.filter(h => h.status === 'ACTIVE');
  const card = { bg: C.surface, p: 6, borderRadius: 'lg', borderWidth: '1px', borderColor: C.border, shadow: 'sm' } as const;

  return (
    <VStack align="stretch" spacing={6}>
      <Box {...card}>
        <Heading size="md" color={C.text} mb={1}>Executive Broadcast</Heading>
        <Text fontSize="sm" color={C.textMid} mb={4}>
          Pins an announcement at the top of every Student / Faculty dashboard and adds it to their notifications.
        </Text>
        <VStack align="stretch" spacing={3}>
          <Input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder="Title, e.g. CCIS Faculty Meeting Today" color={C.text} />
          <Box>
            <Textarea
              value={message} maxLength={1000} rows={4} onChange={e => setMessage(e.target.value)} color={C.text}
              placeholder="e.g. CCIS Faculty Meeting today at 3:00 PM in IICT 306. All consultation hours between 3–5 PM are suspended."
            />
            <Text fontSize="xs" color={C.textMid} textAlign="right">{message.length}/1000</Text>
          </Box>
          <HStack spacing={3} flexWrap="wrap" align="flex-end">
            <Box><Text fontSize="xs" color={C.textMid} mb={1}>Send to</Text>
              <Select value={audience} onChange={e => setAudience(e.target.value as typeof audience)} color={C.text}>
                <option value="ALL">Students &amp; Faculty</option>
                <option value="STUDENT">Students only</option>
                <option value="FACULTY">Faculty only</option>
              </Select></Box>
            <Box><Text fontSize="xs" color={C.textMid} mb={1}>Priority</Text>
              <Select value={priority} onChange={e => setPriority(e.target.value as typeof priority)} color={C.text}>
                <option value="URGENT">Urgent</option>
                <option value="NOTICE">Notice</option>
              </Select></Box>
            <Box><Text fontSize="xs" color={C.textMid} mb={1}>Display duration</Text>
              <Select value={duration} onChange={e => setDuration(Number(e.target.value))} color={C.text}>
                {DURATIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </Select></Box>
            <Button colorScheme="blue" size="sm" onClick={send} isLoading={sending}>Send broadcast</Button>
          </HStack>
        </VStack>
      </Box>

      <Box {...card}>
        <Heading size="sm" color={C.text} mb={3}>Active now ({active.length})</Heading>
        {active.length === 0 && <Text fontSize="sm" color={C.textMid}>No broadcast is currently pinned.</Text>}
        <VStack align="stretch" spacing={3}>
          {active.map(b => (
            <Flex key={b._id} justify="space-between" align="flex-start" gap={3} borderWidth="1px" borderColor={C.border} borderRadius="md" p={3}>
              <Box>
                <HStack mb={1}>
                  <Badge colorScheme={b.priority === 'URGENT' ? 'red' : 'blue'}>{PRIORITY_LABEL[b.priority]}</Badge>
                  <Text fontWeight="700" color={C.text} fontSize="sm">{b.title}</Text>
                </HStack>
                <Text fontSize="sm" color={C.textMid} whiteSpace="pre-wrap">{b.message}</Text>
                <Text fontSize="xs" color={C.textMid} mt={1}>{AUDIENCE_LABEL[b.audience]} · until {fmt(b.expiresAt)}</Text>
              </Box>
              <Button size="xs" variant="outline" colorScheme="red" onClick={() => endNow(b._id)}>End now</Button>
            </Flex>
          ))}
        </VStack>
      </Box>

      <Box {...card}>
        <Heading size="sm" color={C.text} mb={3}>History</Heading>
        <TableContainer>
          <Table size="sm">
            <Thead><Tr><Th>Sent</Th><Th>Title</Th><Th>Audience</Th><Th>Priority</Th><Th>Status</Th></Tr></Thead>
            <Tbody>
              {history.map(b => (
                <Tr key={b._id}>
                  <Td color={C.text}>{fmt(b.createdAt)}</Td>
                  <Td color={C.text}>{b.title}</Td>
                  <Td color={C.text}>{AUDIENCE_LABEL[b.audience]}</Td>
                  <Td><Badge colorScheme={b.priority === 'URGENT' ? 'red' : 'blue'}>{PRIORITY_LABEL[b.priority]}</Badge></Td>
                  <Td><Badge colorScheme={b.status === 'ACTIVE' ? 'green' : 'gray'}>{BROADCAST_STATUS_LABEL[b.status]}</Badge></Td>
                </Tr>
              ))}
              {history.length === 0 && <Tr><Td colSpan={5} color={C.textMid}>No broadcasts sent yet.</Td></Tr>}
            </Tbody>
          </Table>
        </TableContainer>
      </Box>
    </VStack>
  );
}
