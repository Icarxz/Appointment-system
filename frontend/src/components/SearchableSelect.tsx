import { useMemo, useState } from 'react';
import {
  Button, Input, Popover, PopoverTrigger, PopoverContent, PopoverBody,
  Text, VStack, HStack, Box, useDisclosure,
} from '@chakra-ui/react';
import { ChevronDownIcon, SearchIcon } from '@chakra-ui/icons';
import { useFieldStyle } from '../utils/uiTokens';

export interface SearchableOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Width of the field. A fixed value like "190px" keeps side-by-side filters on one row; "100%" fills its parent. */
  maxW?: string;
  /** Same sizes as Chakra's <Select>, so a filter bar can mix both without a height mismatch. */
  size?: 'sm' | 'md';
  isDisabled?: boolean;
  ariaLabel?: string;
  /** false hides the search box (for a short list such as Newest / Oldest). Default true. */
  searchable?: boolean;
  /** false hides the placeholder row that clears the choice (for a control that always has a value). Default true. */
  clearable?: boolean;
}

export default function SearchableSelect({
  value, options, onChange, placeholder = 'Select an option',
  maxW = '100%', size = 'md', isDisabled = false, ariaLabel, searchable = true, clearable = true,
}: Props) {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [query, setQuery] = useState('');
  const f = useFieldStyle();
  const selected = options.find(option => option.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(option => option.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const close = () => { setQuery(''); onClose(); };

  return (
    <Popover isOpen={isOpen} onOpen={onOpen} onClose={close} placement="bottom-start" isLazy matchWidth>
      <PopoverTrigger>
        {/* Looks like a themed <Select>/<Input>: same background, border, radius, height, hover and focus ring. */}
        <Button
          type="button" variant="outline" size={size} w={maxW} maxW="100%" flexShrink={0}
          justifyContent="space-between" fontWeight="normal"
          bg={f.bg} color={f.text} borderColor={f.border} boxShadow="0 1px 1px rgba(15, 34, 64, 0.04)"
          _hover={{ bg: f.bg, borderColor: f.hover }}
          _active={{ bg: f.bg, transform: 'none' }}
          _focusVisible={{ outline: 'none', borderColor: '#2563eb', boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.25)' }}
          isDisabled={isDisabled} aria-label={ariaLabel || placeholder}
          rightIcon={<ChevronDownIcon boxSize={5} />}
        >
          <Text noOfLines={1} textAlign="left">{selected?.label || placeholder}</Text>
        </Button>
      </PopoverTrigger>
      <PopoverContent maxW={maxW} zIndex={1500} bg={f.bg} color={f.text} borderColor={f.border}>
        <PopoverBody p={2}>
          {searchable && <HStack mb={2}>
            <SearchIcon color="gray.400" />
            <Input
              size="sm" autoFocus value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={`Search ${placeholder.toLowerCase()}...`}
              aria-label={`Search ${placeholder.toLowerCase()}`}
            />
          </HStack>}
          <VStack align="stretch" spacing={1} maxH="240px" overflowY="auto">
            {clearable && <Button size="sm" variant={!value ? 'solid' : 'ghost'} justifyContent="flex-start"
              onClick={() => { onChange(''); close(); }}>
              {placeholder}
            </Button>}
            {filtered.map(option => (
              <Button key={option.value} size="sm" variant={value === option.value ? 'solid' : 'ghost'}
                justifyContent="flex-start" whiteSpace="normal" height="auto" minH="36px"
                textAlign="left" onClick={() => { onChange(option.value); close(); }}>
                {option.label}
              </Button>
            ))}
            {filtered.length === 0 && <Box px={3} py={2}><Text fontSize="sm" color="gray.500">No matching options.</Text></Box>}
          </VStack>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
