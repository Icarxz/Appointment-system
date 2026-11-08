import React from 'react';
import {
  Avatar, Badge, Box, Button as ChakraButton, Flex, HStack, SimpleGrid, Text, useColorModeValue,
} from '@chakra-ui/react';

// Shared pieces for every list / filter page (Dean, Faculty, Student, request lists).
// The Admin dashboard has its own copy of these, so nothing here changes it.

export const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
  { value: 'Not provided', label: 'Not provided' }, // accounts created before gender was collected
];

export const matchesGender = (gender: string | undefined, filter: string) =>
  !filter || (filter === 'Not provided' ? !gender : gender === filter);

// "BS INFO 1A" -> { program: 'BS INFO', year: '1', section: 'A' }
export const parseCohort = (pp?: string) => {
  const m = (pp || '').trim().match(/^(.*\S)\s+(\d+)([A-Za-z]+)$/);
  return m ? { program: m[1], year: m[2], section: m[3].toUpperCase() } : { program: '', year: '', section: '' };
};

export function GenderBadge({ gender }: { gender?: string }) {
  if (!gender) return <Text as="span" opacity={0.5}>—</Text>;
  const color = gender === 'Male' ? 'blue' : gender === 'Female' ? 'pink' : 'gray';
  return <Badge colorScheme={color} borderRadius="full" px={2}>{gender}</Badge>;
}

export function PersonCell({ name, sub, onClick, title }: { name: string; sub?: string; onClick?: () => void; title?: string }) {
  return (
    <HStack spacing={3} align="center">
      <Avatar size="sm" name={name} />
      <Box minW={0}>
        <Text
          fontWeight="bold" lineHeight="short"
          cursor={onClick ? 'pointer' : undefined}
          color={onClick ? 'blue.500' : undefined}
          _hover={onClick ? { textDecoration: 'underline' } : undefined}
          onClick={onClick} title={title}
        >
          {name}
        </Text>
        {sub && <Text fontSize="xs" opacity={0.65} lineHeight="short" fontWeight="normal">{sub}</Text>}
      </Box>
    </HStack>
  );
}

export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box minW={0}>
      <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide" opacity={0.65} mb={1}>{label}</Text>
      {children}
    </Box>
  );
}

export function FilterPanel({ children, shown, total, noun, canClear, onClear, columns }: {
  children: React.ReactNode; shown: number; total: number; noun: string; canClear: boolean; onClear: () => void;
  columns?: { base?: number; sm?: number; md?: number; lg?: number };
}) {
  const bg = useColorModeValue('gray.50', 'whiteAlpha.50');
  const line = useColorModeValue('gray.200', 'whiteAlpha.200');
  return (
    <Box bg={bg} borderWidth="1px" borderColor={line} borderRadius="lg" p={4} mb={4} className="no-print">
      <SimpleGrid columns={columns || { base: 1, sm: 2, lg: 4 }} spacing={3} alignItems="end">{children}</SimpleGrid>
      <Flex mt={3} align="center" justify="space-between" gap={3} flexWrap="wrap">
        <Text fontSize="xs" opacity={0.7}>Showing {shown} of {total} {noun}</Text>
        {canClear && <ChakraButton size="xs" variant="ghost" colorScheme="blue" onClick={onClear}>Clear filters</ChakraButton>}
      </Flex>
    </Box>
  );
}
