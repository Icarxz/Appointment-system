import React, { useEffect, useRef, useState } from 'react';
import {
  Box, Button, Flex, HStack, Progress, SimpleGrid, Skeleton, SkeletonCircle, Text, VStack, useColorModeValue,
} from '@chakra-ui/react';

// Shared loading / offline / slow-connection visuals for every dashboard page.
//   Loading        -> skeleton "trays" that look like the finished page (cards, charts, tables)
//   Slow (> 4 s)   -> a banner with a progress bar on top of the skeleton
//   Offline        -> a banner while you are offline, and a full "can't load" panel with Retry
//   Back online    -> a short green "Back online" banner (and the page reloads its data)

// ---------- hooks ----------
export function useOnlineStatus() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}

/** true once `active` has stayed true for `ms` (default 4 s) */
export function useSlowLoading(active: boolean, ms = 4000) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return slow;
}

// ---------- icons ----------
const Svg = ({ children, size = 20 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
export const WifiOffIcon = ({ size }: { size?: number }) => (
  <Svg size={size}><line x1="1" y1="1" x2="23" y2="23" /><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" /><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" /><path d="M10.71 5.05A16 16 0 0 1 22.58 9" /><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" /></Svg>
);
export const WifiIcon = ({ size }: { size?: number }) => (
  <Svg size={size}><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" /></Svg>
);
const HourglassIcon = ({ size }: { size?: number }) => (
  <Svg size={size}><path d="M6 2h12" /><path d="M6 22h12" /><path d="M7 2c0 5 5 6 5 10s-5 5-5 10" /><path d="M17 2c0 5-5 6-5 10s5 5 5 10" /></Svg>
);

// ---------- banner: offline / back online / slow ----------
export function ConnectionBanner({ slow, onReconnect }: { slow?: boolean; onReconnect?: () => void }) {
  const online = useOnlineStatus();
  const [showBack, setShowBack] = useState(false);
  const wasOffline = useRef(false);
  const reconnect = useRef(onReconnect);
  reconnect.current = onReconnect;

  useEffect(() => {
    if (!online) { wasOffline.current = true; setShowBack(false); return; }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setShowBack(true);
    reconnect.current?.();
    const t = setTimeout(() => setShowBack(false), 3500);
    return () => clearTimeout(t);
  }, [online]);

  let tone: { bg: string; border: string; color: string; icon: React.ReactNode; title: string; text: string } | null = null;
  if (!online) tone = { bg: 'orange.50', border: 'orange.300', color: 'orange.900', icon: <WifiOffIcon />, title: "You're offline", text: "Changes can't be saved, and what you see may be out of date. We'll reload when you're back." };
  else if (showBack) tone = { bg: 'green.50', border: 'green.300', color: 'green.900', icon: <WifiIcon />, title: 'Back online', text: 'Refreshing your data…' };
  else if (slow) tone = { bg: 'blue.50', border: 'blue.200', color: 'blue.900', icon: <HourglassIcon />, title: 'Slow connection', text: 'This is taking longer than usual. Still loading…' };
  if (!tone) return null;

  return (
    <Box role="status" aria-live="polite" className="no-print" mb={4} borderRadius="lg" borderWidth="1px" borderColor={tone.border} bg={tone.bg} color={tone.color} overflow="hidden">
      <Flex align="center" gap={3} px={4} py={3}>
        <Box flexShrink={0}>{tone.icon}</Box>
        <Text fontSize="sm"><b>{tone.title}.</b> {tone.text}</Text>
      </Flex>
      {slow && online && !showBack && <Progress size="xs" isIndeterminate colorScheme="blue" bg="transparent" />}
    </Box>
  );
}

// ---------- full-panel "can't load" (offline or server unreachable) ----------
export function OfflineState({ offline, message, onRetry }: { offline?: boolean; message?: string; onRetry: () => void | Promise<any> }) {
  const [busy, setBusy] = useState(false);
  const cardBg = useColorModeValue('#ffffff', '#111d30');
  const border = useColorModeValue('#dde3ec', '#1e3048');
  const ring = useColorModeValue('orange.50', 'whiteAlpha.100');
  const ghost = useColorModeValue('gray.100', 'whiteAlpha.100');
  const muted = useColorModeValue('#6b7fa0', '#7a93b0');

  const retry = async () => { setBusy(true); try { await onRetry(); } finally { setBusy(false); } };

  return (
    <Box bg={cardBg} borderWidth="1px" borderColor={border} borderRadius="lg" shadow="sm" px={6} py={10} textAlign="center" role="alert">
      <Flex mx="auto" mb={4} w="84px" h="84px" borderRadius="full" bg={ring} align="center" justify="center" color="orange.500" borderWidth="2px" borderStyle="dashed" borderColor="orange.300">
        <WifiOffIcon size={38} />
      </Flex>
      <Text fontSize="lg" fontWeight="bold">{offline ? "You're offline" : "Can't load this page"}</Text>
      <Text fontSize="sm" color={muted} mt={1} mb={5} maxW="420px" mx="auto">
        {offline
          ? 'Check your Wi-Fi or mobile data. This page will reload by itself once you are back online.'
          : (message || 'We could not reach the server. Check your connection and try again.')}
      </Text>
      <Button colorScheme="blue" size="sm" onClick={retry} isLoading={busy}>Try again</Button>

      {/* faint outline of the page that failed to load */}
      <VStack spacing={2} mt={8} maxW="520px" mx="auto" opacity={0.7} aria-hidden="true">
        {[100, 86, 94].map((w, i) => <Box key={i} h="12px" w={`${w}%`} borderRadius="full" bg={ghost} />)}
      </VStack>
    </Box>
  );
}

// ---------- skeleton building blocks ----------
function useSkeletonColors() {
  return {
    start: useColorModeValue('gray.100', 'whiteAlpha.100'),
    end: useColorModeValue('gray.200', 'whiteAlpha.300'),
    cardBg: useColorModeValue('#ffffff', '#111d30'),
    border: useColorModeValue('#dde3ec', '#1e3048'),
    panelBg: useColorModeValue('gray.50', 'whiteAlpha.50'),
    line: useColorModeValue('gray.200', 'whiteAlpha.200'),
  };
}

const Bar = ({ w = '100%', h = '12px', mt }: { w?: string | number; h?: string; mt?: number }) => {
  const c = useSkeletonColors();
  return <Skeleton startColor={c.start} endColor={c.end} h={h} w={w} mt={mt} borderRadius="full" />;
};

/** A white card "tray" (same look as the real cards) */
export function SkeletonTray({ children, accent, p = 4 }: { children: React.ReactNode; accent?: string; p?: number }) {
  const c = useSkeletonColors();
  return (
    <Box bg={c.cardBg} borderWidth="1px" borderColor={c.border} borderTopWidth={accent ? '3px' : '1px'} borderTopColor={accent || c.border} borderRadius="xl" p={p} shadow="sm">
      {children}
    </Box>
  );
}

function StatCardSkeleton({ accent }: { accent: string }) {
  const c = useSkeletonColors();
  return (
    <SkeletonTray accent={accent} p={4}>
      <Flex justify="space-between" align="center">
        <HStack spacing={2}><SkeletonCircle size="5" startColor={c.start} endColor={c.end} /><Bar w="70px" /></HStack>
        <Bar w="38px" h="22px" />
      </Flex>
      <Bar w="80%" h="9px" mt={3} />
    </SkeletonTray>
  );
}

/** Reports & Analytics: the tabs, five stat cards, the big chart and two cards under it. */
export function AnalyticsSkeleton() {
  const c = useSkeletonColors();
  return (
    <Box role="status" aria-busy="true" aria-label="Loading analytics">
      <HStack spacing={2} mb={5}>
        {[84, 74, 70, 104].map((w, i) => <Skeleton key={i} startColor={c.start} endColor={c.end} h="34px" w={`${w}px`} borderRadius="full" />)}
      </HStack>
      <Flex gap={5} direction={{ base: 'column', lg: 'row' }} align="start">
        <VStack spacing={3} w={{ base: '100%', lg: '290px' }} flexShrink={0} align="stretch">
          {['blue.400', 'green.400', 'orange.400', 'gray.400', 'purple.400'].map(a => <StatCardSkeleton key={a} accent={a} />)}
        </VStack>
        <VStack spacing={5} flex="1" minW={0} w="100%" align="stretch">
          <SkeletonTray p={6}>
            <Flex justify="space-between" align="start" mb={5}>
              <Box><Bar w="150px" h="16px" /><Bar w="210px" h="10px" mt={3} /></Box>
              <Bar w="110px" h="14px" />
            </Flex>
            <Box position="relative" h="210px">
              {[0, 1, 2].map(i => <Box key={i} position="absolute" left={0} right={0} top={`${i * 45 + 8}%`} borderTopWidth="1px" borderStyle="dashed" borderColor={c.line} />)}
              <Skeleton startColor={c.start} endColor={c.end} position="absolute" left={0} right={0} bottom={0} h="46%" borderTopRadius="2xl" />
            </Box>
            <Flex justify="space-between" mt={3}>{Array.from({ length: 8 }).map((_, i) => <Bar key={i} w="26px" h="9px" />)}</Flex>
          </SkeletonTray>
          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={5}>
            <SkeletonTray p={6}>
              <Bar w="170px" h="16px" /><Bar w="120px" h="10px" mt={3} />
              <Skeleton startColor={c.start} endColor={c.end} h="26px" mt={5} borderRadius="lg" />
              <VStack spacing={2} mt={4} align="stretch">{[70, 55, 62].map((w, i) => <Bar key={i} w={`${w}%`} h="10px" />)}</VStack>
            </SkeletonTray>
            <SkeletonTray p={6}>
              <Bar w="110px" h="16px" /><Bar w="190px" h="10px" mt={3} />
              <VStack spacing={4} mt={5} align="stretch">
                {[88, 72, 40].map((w, i) => <Flex key={i} align="center" gap={3}><Bar w="110px" h="10px" /><Skeleton startColor={c.start} endColor={c.end} h="14px" w={`${w}%`} borderRadius="sm" /></Flex>)}
              </VStack>
            </SkeletonTray>
          </SimpleGrid>
        </VStack>
      </Flex>
    </Box>
  );
}

/** The grey filter bar above the Faculty / Student / Records tables */
export function FilterPanelSkeleton({ fields = 4 }: { fields?: number }) {
  const c = useSkeletonColors();
  return (
    <Box bg={c.panelBg} borderWidth="1px" borderColor={c.line} borderRadius="lg" p={4} mb={4} aria-hidden="true">
      <SimpleGrid columns={{ base: 1, sm: 2, lg: fields }} spacing={3}>
        {Array.from({ length: fields }).map((_, i) => (
          <Box key={i}><Bar w="70px" h="9px" /><Skeleton startColor={c.start} endColor={c.end} h="36px" mt={2} borderRadius="md" /></Box>
        ))}
      </SimpleGrid>
      <Bar w="130px" h="9px" mt={4} />
    </Box>
  );
}

/** Table with a header row and avatar + text rows */
export function TableSkeleton({ rows = 6, cols = 5, withAvatar = true }: { rows?: number; cols?: number; withAvatar?: boolean }) {
  const c = useSkeletonColors();
  return (
    <Box role="status" aria-busy="true" aria-label="Loading list" overflowX="auto">
      <Flex gap={6} pb={3} borderBottomWidth="1px" borderColor={c.line} minW="560px">
        {Array.from({ length: cols }).map((_, i) => <Bar key={i} w={i === 0 ? '28%' : `${Math.floor(72 / (cols - 1))}%`} h="10px" />)}
      </Flex>
      {Array.from({ length: rows }).map((_, r) => (
        <Flex key={r} gap={6} py={4} align="center" borderBottomWidth="1px" borderColor={c.line} minW="560px">
          <Flex w="28%" align="center" gap={3}>
            {withAvatar && <SkeletonCircle size="9" startColor={c.start} endColor={c.end} flexShrink={0} />}
            <Box flex="1"><Bar w={`${70 - (r % 3) * 10}%`} h="12px" /><Bar w="55%" h="9px" mt={2} /></Box>
          </Flex>
          {Array.from({ length: cols - 1 }).map((_, i) => <Bar key={i} w={`${Math.floor(72 / (cols - 1)) - 4}%`} h="12px" />)}
        </Flex>
      ))}
    </Box>
  );
}

/** Appointment / request cards (avatar, two lines, status pill, two buttons) */
export function CardListSkeleton({ count = 4 }: { count?: number }) {
  const c = useSkeletonColors();
  return (
    <VStack spacing={3} align="stretch" role="status" aria-busy="true" aria-label="Loading requests">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonTray key={i} p={4}>
          <Flex align="center" gap={4} flexWrap="wrap">
            <SkeletonCircle size="11" startColor={c.start} endColor={c.end} />
            <Box flex="1" minW="180px"><Bar w="45%" h="14px" /><Bar w="70%" h="10px" mt={3} /></Box>
            <Skeleton startColor={c.start} endColor={c.end} h="22px" w="82px" borderRadius="full" />
            <HStack><Skeleton startColor={c.start} endColor={c.end} h="30px" w="76px" borderRadius="md" /><Skeleton startColor={c.start} endColor={c.end} h="30px" w="76px" borderRadius="md" /></HStack>
          </Flex>
        </SkeletonTray>
      ))}
    </VStack>
  );
}
