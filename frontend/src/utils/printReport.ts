import { useColorMode } from '@chakra-ui/react';

// Print the element with id="printable-report" (see index.css). Paper is white, so a dark theme would print light
// text on a white page: switch to the light theme for the print dialog and put the person's own theme back after.
export function usePrintReport() {
  const { colorMode, setColorMode } = useColorMode();
  return () => {
    const previous = colorMode;
    document.body.classList.add('printing-report');
    if (previous !== 'light') setColorMode('light');
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('printing-report');
      if (previous !== 'light') setColorMode(previous);
    }, { once: true });
    setTimeout(() => window.print(), 350); // give the light theme a moment to paint first
  };
}
