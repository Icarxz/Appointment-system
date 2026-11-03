import { extendTheme } from '@chakra-ui/react';

// One theme for every portal, so buttons, tabs and fields behave the same everywhere.
//
// Touch screens need bigger targets than a mouse. WCAG 2.2 asks for at least 24px; 44px is the common
// guideline on phones. These rules apply only when the main pointer is a finger ("coarse"), so the dense
// desktop layout stays exactly as it was.
const touchTarget = { '@media (pointer: coarse)': { minHeight: '40px', minWidth: '40px' } };
const touchHeight = { '@media (pointer: coarse)': { minHeight: '40px' } };

const font = "'Segoe UI', system-ui, -apple-system, Roboto, sans-serif";

export default extendTheme({
  config: { initialColorMode: 'light', useSystemColorMode: false },
  fonts: { heading: font, body: font },
  components: {
    Button: { baseStyle: touchTarget },
    IconButton: { baseStyle: touchTarget },
    CloseButton: { baseStyle: touchTarget },
    Tabs: { baseStyle: { tab: touchHeight } },
    Input: { baseStyle: { field: touchHeight } },
    Select: { baseStyle: { field: touchHeight } },
    Textarea: { baseStyle: touchHeight },
    // Status badges wrap instead of being cut off ("WAITING FOR FACU…") when a column is narrow.
    Badge: { baseStyle: { whiteSpace: 'normal', textAlign: 'center' } },
  },
});
