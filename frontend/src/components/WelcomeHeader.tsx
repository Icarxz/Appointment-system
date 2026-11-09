import type { ReactNode } from 'react';
import { Box, Flex, useColorModeValue } from '@chakra-ui/react';

// Greeting + today's date at the top of a dashboard's main area. `actions` sits at its right edge (buttons).
export default function WelcomeHeader({ name, actions }: { name: string; actions?: ReactNode }) {
  const color = useColorModeValue('#0f2240', '#e8f0fe');
  const muted = useColorModeValue('#6b7fa0', '#7a93b0');
  const border = useColorModeValue('#dde3ec', '#1e3048');
  const bg = useColorModeValue('#ffffff', '#0f1b2d');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <Box className="no-print" pl={{ base: 4, md: 8 }} pr={{ base: 4, md: '72px' }} py={{ base: 2, md: actions ? 2 : 3 }} borderBottom={`1px solid ${border}`} bg={bg} flexShrink={0}>
      <Flex align="center" justify="space-between" gap={3} wrap="wrap">
        <Box display="flex" alignItems="baseline" gap={3} minW={0}>
          <Box as="span" fontSize={{ base: '13px', md: '14px' }} color={color} noOfLines={1} display="block">{greeting}, <b>{name}</b></Box>
          <Box as="span" fontSize="12px" color={muted} display={{ base: 'none', sm: 'block' }} flexShrink={0}>{today}</Box>
        </Box>
        {actions}
      </Flex>
    </Box>
  );
}
