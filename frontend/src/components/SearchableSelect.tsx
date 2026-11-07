import { useMemo, useState } from 'react';
import {
  Button, Input, Popover, PopoverTrigger, PopoverContent, PopoverBody,
  Text, VStack, HStack, Box, useDisclosure,
} from '@chakra-ui/react';
import { ChevronDownIcon, SearchIcon } from '@chakra-ui/icons';

export interface SearchableOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  maxW?: string;
  isDisabled?: boolean;
  ariaLabel?: string;
}

export default function SearchableSelect({
  value, options, onChange, placeholder = 'Select an option',
  maxW = '100%', isDisabled = false, ariaLabel,
}: Props) {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [query, setQuery] = useState('');
  const selected = options.find(option => option.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(option => option.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const close = () => { setQuery(''); onClose(); };

  return (
    <Popover isOpen={isOpen} onOpen={onOpen} onClose={close} placement="bottom-start" isLazy matchWidth>
      <PopoverTrigger>
        <Button
          type="button" variant="outline" width="100%" maxW={maxW}
          justifyContent="space-between" fontWeight="normal"
          isDisabled={isDisabled} aria-label={ariaLabel || placeholder}
          rightIcon={<ChevronDownIcon />}
        >
          <Text noOfLines={1} textAlign="left">{selected?.label || placeholder}</Text>
        </Button>
      </PopoverTrigger>
      <PopoverContent maxW={maxW} zIndex={1500}>
        <PopoverBody p={2}>
          <HStack mb={2}>
            <SearchIcon color="gray.400" />
            <Input
              size="sm" autoFocus value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={`Search ${placeholder.toLowerCase()}...`}
              aria-label={`Search ${placeholder.toLowerCase()}`}
            />
          </HStack>
          <VStack align="stretch" spacing={1} maxH="240px" overflowY="auto">
            <Button size="sm" variant={!value ? 'solid' : 'ghost'} justifyContent="flex-start"
              onClick={() => { onChange(''); close(); }}>
              {placeholder}
            </Button>
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
