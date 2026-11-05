import { extendTheme } from '@chakra-ui/react';

// One theme for every portal, so buttons, tabs and fields behave the same everywhere.
//
// Touch screens need bigger targets than a mouse. WCAG 2.2 asks for at least 24px; 44px is the common
// guideline on phones. These rules apply only when the main pointer is a finger ("coarse"), so the dense
// desktop layout stays exactly as it was.
const touchTarget = { '@media (pointer: coarse)': { minHeight: '40px', minWidth: '40px' } };
const touchHeight = { '@media (pointer: coarse)': { minHeight: '40px' } };

const font = "'Segoe UI', system-ui, -apple-system, Roboto, sans-serif";

// Blue follows the accent already used by the sidebar, tiles and charts (#2563eb), instead of Chakra's
// default blue (#3182ce), so every blue button, link and focus ring matches the rest of the site.
const blue = {
  50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa',
  500: '#2563eb', 600: '#1d4ed8', 700: '#1e40af', 800: '#1e3a8a', 900: '#172554',
};

export default extendTheme({
  config: { initialColorMode: 'light', useSystemColorMode: false },
  fonts: { heading: font, body: font },
  colors: { blue },
  radii: { md: '8px', lg: '12px', xl: '16px' },
  shadows: {
    // Softer, navy-tinted shadows read as lifted cards; Chakra's defaults are grey and harsh.
    sm: '0 1px 2px rgba(15, 34, 64, 0.06)',
    md: '0 4px 12px rgba(15, 34, 64, 0.10)',
    lg: '0 10px 24px rgba(15, 34, 64, 0.14)',
    outline: '0 0 0 3px rgba(37, 99, 235, 0.45)',
  },
  styles: {
    global: {
      body: { WebkitFontSmoothing: 'antialiased', textRendering: 'optimizeLegibility' },
      '::selection': { background: 'rgba(37, 99, 235, 0.25)' },
      // One visible keyboard focus ring everywhere, including the plain <button>s of the sidebar.
      ':focus-visible': { outline: '2px solid #2563eb', outlineOffset: '2px' },
      // Thin scrollbars, so long tables and the page do not carry a heavy grey bar.
      '*': { scrollbarWidth: 'thin', scrollbarColor: '#94a3b8 transparent' },
      // People who ask their system for less motion get none.
      '@media (prefers-reduced-motion: reduce)': { '*, *::before, *::after': { animationDuration: '0.01ms !important', transitionDuration: '0.01ms !important' } },
    },
  },
  components: {
    Button: {
      baseStyle: { ...touchTarget, fontWeight: 600, borderRadius: 'md', transition: 'background 0.15s ease, box-shadow 0.15s ease, transform 0.05s ease', _active: { transform: 'translateY(1px)' } },
    },
    IconButton: { baseStyle: touchTarget },
    CloseButton: { baseStyle: touchTarget },
    Input: { baseStyle: { field: touchHeight }, defaultProps: { focusBorderColor: 'blue.500' } },
    Select: { baseStyle: { field: touchHeight }, defaultProps: { focusBorderColor: 'blue.500' } },
    Textarea: { baseStyle: touchHeight, defaultProps: { focusBorderColor: 'blue.500' } },
    // Dialogs and drawers: rounder corners, a stronger title, and a dimmer backdrop that keeps the page readable behind it.
    Modal: {
      baseStyle: {
        overlay: { bg: 'blackAlpha.600' },
        dialog: { borderRadius: 'xl', boxShadow: 'lg' },
        header: { fontSize: 'lg', fontWeight: 700, letterSpacing: '-0.01em' },
      },
    },
    Drawer: { baseStyle: { overlay: { bg: 'blackAlpha.600' }, header: { fontWeight: 700, letterSpacing: '-0.01em' } } },
    Tooltip: { baseStyle: { borderRadius: 'md', fontSize: 'xs', px: 3, py: 2 } },
    // Table headings: small, spaced capitals, so the data rows carry the weight.
    Table: { baseStyle: { th: { fontSize: '11px', letterSpacing: '0.06em', fontWeight: 700 } } },
    Tabs: { baseStyle: { tab: { ...touchHeight, fontWeight: 600 } } },
    // Status badges wrap instead of being cut off ("WAITING FOR FACU…") when a column is narrow.
    Badge: {
      baseStyle: {
        whiteSpace: 'normal',
        textAlign: 'center',
        borderRadius: 'full',
        fontSize: 'xs',
        fontWeight: 700,
        lineHeight: 1.2,
        letterSpacing: '0.01em',
        textTransform: 'none',
        px: 2.5,
        py: 1,
      },
      // Subtle semantic backgrounds keep status chips readable without competing with page content.
      defaultProps: { variant: 'subtle' },
    },
  },
});
