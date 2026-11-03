import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Text, useColorModeValue } from '@chakra-ui/react';

// For tables that are too wide to turn into cards (admin lists, the consultation log): the table scrolls
// sideways inside its own box, and a hint says so, because a clipped column otherwise looks like a bug.
// The hint is measured, so it shows only when the table really overflows.
export default function ScrollTable({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  const muted = useColorModeValue('#64748b', '#8fa6c4');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild); // the table itself grows when rows load
    return () => ro.disconnect();
  }, []);

  return (
    <Box>
      {scrolls && <Text fontSize="11px" color={muted} mb={1} className="no-print">Swipe sideways to see every column →</Text>}
      <Box ref={ref} overflowX="auto" sx={{ '@media print': { overflow: 'visible' } }}>{children}</Box>
    </Box>
  );
}
