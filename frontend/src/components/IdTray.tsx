import React, { useRef } from 'react';
import { Box, HStack, Input, Text, useColorModeValue } from '@chakra-ui/react';
import { idHint, isValidId } from '../utils/idValidator';

// ---------- School ID tray (one box per character) ----------
// Student: YYYY-S00001 (starts with S) or YYYY-1234-A (starts with a number). The layout switches on the 5th character.
// Employee / Faculty: YYYYS-00001.
export type IdKind = 'STUDENT' | 'FACULTY';

export const idRawOf = (v?: string) => (v || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
export const idSegments = (kind: IdKind, raw: string): number[] =>
  kind === 'FACULTY' ? [5, 5] : (raw.length > 4 && raw[4] !== 'S' ? [4, 4, 1] : [4, 6]);

export const idCharOk = (kind: IdKind, before: string, pos: number, ch: string) => {
  const digit = /^\d$/.test(ch), letter = /^[A-Z]$/.test(ch);
  if (kind === 'FACULTY') return pos < 4 || pos > 4 ? (pos < 10 && digit) : ch === 'S';
  if (pos < 4) return digit;
  if (pos === 4) return ch === 'S' || digit;
  if (before[4] === 'S') return pos <= 9 && digit;   // 2025-S00001
  if (pos <= 7) return digit;                         // 2025-1234-A
  return pos === 8 && letter;
};
export const idValidRaw = (kind: IdKind, s: string) => s.split('').every((ch, p) => idCharOk(kind, s.slice(0, p), p, ch));

export const formatId = (kind: IdKind, raw: string) => {
  if (kind === 'FACULTY') return raw.length > 5 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw;
  if (raw.length <= 4) return raw;
  if (raw[4] === 'S' || raw.length <= 8) return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
};
export const isIdComplete = (kind: IdKind, value: string) => {
  return isValidId(value, kind === 'FACULTY' ? 'EMPLOYEE' : 'STUDENT');
};

export function IdTray({ kind, value, onChange }: { kind: IdKind; value: string; onChange: (formatted: string) => void }) {
  const raw = idRawOf(value);
  const segs = idSegments(kind, raw);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const muted = useColorModeValue('gray.600', 'gray.400');
  const boxBg = useColorModeValue('white', 'whiteAlpha.100');
  const boxLine = useColorModeValue('gray.300', 'whiteAlpha.300');
  const validationKind = kind === 'FACULTY' ? 'EMPLOYEE' : 'STUDENT';
  const currentYear = new Date().getFullYear();

  const focusAt = (i: number) => setTimeout(() => refs.current[Math.max(0, i)]?.focus(), 0);
  const commit = (next: string) => onChange(formatId(kind, next));

  const typeChar = (i: number, ch: string) => {
    const candidate = i < raw.length ? raw.slice(0, i) + ch + raw.slice(i + 1) : raw + ch;
    if (!idValidRaw(kind, candidate)) return;
    commit(candidate);
    focusAt(i + 1);
  };
  const paste = (i: number, text: string) => {
    let next = raw.slice(0, Math.min(i, raw.length));
    for (const ch of idRawOf(text)) if (idCharOk(kind, next, next.length, ch)) next += ch;
    commit(next);
    focusAt(next.length);
  };

  let offset = 0;
  return (
    <Box>
      <Text fontFamily="mono" fontSize="sm" color={muted} mb={2}>
        {kind === 'FACULTY' ? `Employee format: ${idHint(validationKind, currentYear)}` : `Student formats: ${idHint(validationKind, currentYear)}`}
      </Text>
      <HStack spacing={1} justify="center" flexWrap="nowrap">
        {segs.map((n, s) => {
          const start = offset; offset += n;
          return (
            <React.Fragment key={s}>
              {s > 0 && <Text color={muted} px={0.5}>-</Text>}
              {Array.from({ length: n }).map((_, k) => {
                const i = start + k;
                return (
                  <Input
                    key={i}
                    ref={(el) => { refs.current[i] = el; }}
                    value={raw[i] || ''}
                    w="34px" h="44px" p={0} textAlign="center" fontFamily="mono" fontSize="lg" fontWeight="semibold"
                    bg={boxBg} borderColor={boxLine} borderRadius="md" flexShrink={0}
                    autoComplete="off" inputMode={/\d/.test(raw[i] || '') ? 'numeric' : 'text'}
                    onFocus={(e) => { if (i > raw.length) focusAt(raw.length); else e.target.select(); }}
                    onChange={(e) => {
                      const typed = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                      if (typed) typeChar(i, typed[typed.length - 1]);
                    }}
                    onPaste={(e) => { e.preventDefault(); paste(i, e.clipboardData.getData('text')); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace') {
                        e.preventDefault();
                        if (raw[i]) { commit(raw.slice(0, i)); focusAt(i); }
                        else { commit(raw.slice(0, Math.max(i - 1, 0))); focusAt(i - 1); }
                      } else if (e.key === 'ArrowLeft') { e.preventDefault(); focusAt(i - 1); }
                      else if (e.key === 'ArrowRight') { e.preventDefault(); if (i < raw.length) focusAt(i + 1); }
                    }}
                    aria-label={`ID character ${i + 1}`}
                  />
                );
              })}
            </React.Fragment>
          );
        })}
      </HStack>
      {kind === 'STUDENT' && (
        <Text fontSize="xs" color={muted} mt={2} textAlign="center">The boxes adjust after the 5th character: an S or a number.</Text>
      )}
    </Box>
  );
}

export default IdTray;
