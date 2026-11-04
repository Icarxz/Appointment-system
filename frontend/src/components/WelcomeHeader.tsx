import type { ReactNode } from 'react';
import { Box, Flex, useColorModeValue } from '@chakra-ui/react';

// "Welcome, [Full Name]" strip at the top of a dashboard's main area. `actions` sits at its right edge (buttons).
export default function WelcomeHeader({ name, actions }: { name: string; actions?: ReactNode }) {
  const color = useColorModeValue('#0f2240', '#e8f0fe');
  const border = useColorModeValue('#dde3ec', '#1e3048');
  const bg = useColorModeValue('#ffffff', '#0f1b2d');
  return (
    <Box className="no-print" px={{ base: 4, md: 8 }} py={{ base: 2, md: actions ? 2 : 3 }} borderBottom={`1px solid ${border}`} bg={bg} flexShrink={0}>
      <Flex align="center" justify="space-between" gap={3} wrap="wrap">
        <Box as="span" fontSize={{ base: '13px', md: '14px' }} color={color} noOfLines={1} display="block">Welcome, <b>{name}</b></Box>
        {actions}
      </Flex>
    </Box>
  );
}
