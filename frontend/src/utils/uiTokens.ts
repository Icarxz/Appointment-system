import { useColorMode } from '@chakra-ui/react';

// One place for the navy dashboard palette. Before this, Student, Faculty, Admin and Dean each
// declared their own copy, and they had drifted apart (different nav button styles, paddings, ...).
export function useNavPalette() {
  const { colorMode } = useColorMode();
  const dk = colorMode === 'dark';
  return {
    dk,
    pageBg:    dk ? '#0c1421' : '#eef2f7',
    sidebar:   dk ? '#070e1b' : '#0f2240',
    surface:   dk ? '#111d30' : '#ffffff',
    border:    dk ? '#1e3048' : '#dde3ec',
    text:      dk ? '#e8f0fe' : '#0f2240',
    textMid:   dk ? '#7a93b0' : '#6b7fa0',
    navText:   dk ? '#7a93b0' : '#8eaecb',
    navActive: '#ffffff',
    navBg:     dk ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.10)',
    navLine:   dk ? '#1e3048' : 'rgba(255,255,255,0.12)',
  };
}

// Sidebar width on screens from the "md" breakpoint (768px) up. Below that the sidebar becomes a drawer.
export const SIDEBAR_WIDTH = '220px';

// Page padding and card padding, so every portal spaces its content the same way.
export const PAGE_PAD = { base: 4, md: 8 } as const;
export const CARD_PAD = { base: 4, md: 6 } as const;

// One look for every text field and dropdown. theme.ts styles Chakra's Input / Select / Textarea with these
// values and SearchableSelect reads them through useFieldStyle(), so a field never changes colour or border
// depending on which component drew it. The border matches the card border, so fields that still pass
// borderColor={...} by hand look identical to the ones that do not.
export const FIELD = {
  light: { bg: '#ffffff', border: '#dde3ec', hover: '#b6c3d6', text: '#0f2240', placeholder: '#8a9bb5', disabledBg: '#f1f5f9' },
  dark:  { bg: '#111d30', border: '#1e3048', hover: '#34507a', text: '#e8f0fe', placeholder: '#6b86a6', disabledBg: '#0c1421' },
} as const;

export function useFieldStyle() {
  const { colorMode } = useColorMode();
  return FIELD[colorMode === 'dark' ? 'dark' : 'light'];
}
