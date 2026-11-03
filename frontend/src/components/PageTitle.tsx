import type { ReactNode } from 'react';
import { Heading, useColorModeValue } from '@chakra-ui/react';

// The heading at the top of every portal page. One component so Student, Faculty, Admin and Dean
// titles all share the same size, weight and spacing (they used to be 18px, 18px, 30px and 30px).
export default function PageTitle({ children }: { children: ReactNode }) {
  const color = useColorModeValue('#0f2240', '#e8f0fe');
  return (
    <Heading as="h1" fontSize={{ base: '17px', md: '20px' }} fontWeight="700" letterSpacing="-0.01em" lineHeight="1.3" color={color} mt={0} mb={{ base: 4, md: 5 }}>
      {children}
    </Heading>
  );
}
