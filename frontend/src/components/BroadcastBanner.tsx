import { useEffect, useState } from 'react';
import { Box, Flex, Text, Badge, useColorMode } from '@chakra-ui/react';
import { authFetch } from './authFetch';

interface ActiveBroadcast {
  _id: string;
  title: string;
  message: string;
  priority: 'URGENT' | 'NOTICE';
  createdByName: string;
  createdAt: string;
  expiresAt: string;
}

// Pinned Dean's announcement. Rendered as the first child of the dashboard's
// <main>; sticks to the top while the page content scrolls. Not dismissible:
// it disappears only when it expires or the Dean ends it.
// `userRole` is passed by the Student/Faculty dashboards; the server already
// filters by the logged-in role, so it is accepted but not needed here.
export default function BroadcastBanner(_props: { userRole?: string }) {
  const { colorMode } = useColorMode();
  const dark = colorMode === 'dark';
  const [items, setItems] = useState<ActiveBroadcast[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/broadcasts/active`)
        .then(r => (r.ok ? r.json() : []))
        .then(d => { if (alive && Array.isArray(d)) setItems(d); })
        .catch(() => { /* keep showing the last known banner */ });
    };
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!items.length) return null;

  return (
    <Box position="sticky" top="0" zIndex={20} flexShrink={0} maxH="40vh" overflowY="auto">
      {items.map(b => {
        const urgent = b.priority === 'URGENT';
        return (
          <Box
            key={b._id}
            role="alert"
            bg={urgent
              ? (dark ? '#321D29' : '#FEF2F2')
              : (dark ? '#172B4D' : '#EFF6FF')}
            color={urgent
              ? (dark ? '#FECdd3' : '#991B1B')
              : (dark ? '#BFDBFE' : '#1E40AF')}
            px={5}
            py={3}
            borderBottomWidth="1px"
            borderBottomColor={urgent
              ? (dark ? '#633247' : '#FECACA')
              : (dark ? '#29466F' : '#BFDBFE')}
          >
            <Flex align="center" gap={3} wrap="wrap">
              <Badge
                bg={urgent
                  ? (dark ? '#5B2D42' : '#FECACA')
                  : (dark ? '#25436E' : '#DBEAFE')}
                color={urgent
                  ? (dark ? '#FFE4EC' : '#991B1B')
                  : (dark ? '#DBEAFE' : '#1E40AF')}
                fontSize="10px"
                px={2.5}
                borderRadius="full"
              >
                {urgent ? 'Urgent · Dean' : 'Notice · Dean'}
              </Badge>
              <Text fontWeight="700" fontSize="sm">{b.title}</Text>
            </Flex>
            <Text fontSize="sm" mt={1} whiteSpace="pre-wrap">{b.message}</Text>
            <Text fontSize="11px" mt={1} opacity={0.85}>
              {b.createdByName || 'Office of the Dean'} · posted {new Date(b.createdAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
