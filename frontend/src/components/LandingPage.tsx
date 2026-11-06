import React from 'react';
import { EmailIcon, PhoneIcon, CalendarIcon, CheckCircleIcon, ChevronRightIcon } from '@chakra-ui/icons';
import { useNavigate } from 'react-router-dom';
import { isSafeAppLink, linkMatchesRole } from '../utils/deepLink';
import GoogleSignInButton from './GoogleSignInButton';
import PrivacyPolicyModal from './PrivacyPolicyModal';
import {
  Box, Flex, Heading, Text, Button, VStack, useToast,
  useColorModeValue,
  HStack,
  Container,
  SimpleGrid,
  Icon,
  Stack,
  Link as ChakraLink,
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, useDisclosure,
  Accordion, AccordionItem, AccordionButton, AccordionPanel, AccordionIcon,
  createIcon,
} from '@chakra-ui/react';

// ───────────────────────── Palette (taken from the design mockup) ─────────────────────────
const NAVY = '#08305a';
const CARD = '#0d5a8a';
const TEAL = '#2bb3d6';
const ORANGE = '#f08a3c';
const ORANGE_HOVER = '#e07a2c';
const LIGHT = '#eaf5fb';

// ───────────────────────── Small icons ─────────────────────────
const CapIcon = createIcon({
  displayName: 'CapIcon', viewBox: '0 0 24 24',
  path: <path fill="currentColor" d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z" />,
});
const RocketIcon = createIcon({
  displayName: 'RocketIcon', viewBox: '0 0 24 24',
  path: <path fill="currentColor" d="M12 2c3.2 2.1 5.2 5.6 5.2 9.6 0 1.4-.3 2.7-.9 3.9L14 17.2h-4l-2.3-1.7A9.7 9.7 0 0 1 6.8 11.6C6.8 7.6 8.8 4.1 12 2zm0 5.2a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4zM6.6 15.8 3.4 20l4.4-1.3-1.2-2.9zm10.8 0-1.2 2.9 4.4 1.3-3.2-4.2zM12 18.4c.8 1 1.2 2.1 1.2 3.6h-2.4c0-1.5.4-2.6 1.2-3.6z" />,
});
const ChatBubbleIcon = createIcon({
  displayName: 'ChatBubbleIcon', viewBox: '0 0 24 24',
  path: <path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm4 5v2h8V9H8zm0 4v1.5h5V13H8z" />,
});

function LogoMark({ size = 36, color = NAVY }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" stroke={color} strokeWidth="2.4" aria-hidden="true">
      <circle cx="20" cy="20" r="18" />
      <circle cx="20" cy="20" r="4" fill={color} />
      <circle cx="20" cy="9" r="2.6" fill={color} />
      <circle cx="10.5" cy="25.5" r="2.6" fill={color} />
      <circle cx="29.5" cy="25.5" r="2.6" fill={color} />
      <path d="M20 16V9M17 22l-5 2.5M23 22l5 2.5" />
    </svg>
  );
}

// Decorative wave background for the hero.
// The top-right corner shape is kept small so it never sits behind the headline, and is hidden on phones.
function HeroWaves() {
  const fill = { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' } as const;
  return (
    <>
      <Box display={{ base: 'none', md: 'block' }} position="absolute" inset={0} pointerEvents="none" aria-hidden="true">
        <svg viewBox="0 0 1440 700" preserveAspectRatio="none" style={fill}>
          <path d="M1090 0H1440V160C1390 140 1345 125 1310 70C1285 32 1190 10 1090 0Z" fill={TEAL} />
          <path d="M1230 0H1440V90C1400 76 1370 66 1350 38C1340 22 1290 8 1230 0Z" fill={NAVY} />
        </svg>
      </Box>
      <svg viewBox="0 0 1440 700" preserveAspectRatio="none" aria-hidden="true" style={fill}>
        <path d="M0 560C230 470 430 650 720 590C1000 530 1190 450 1440 540V700H0Z" fill={TEAL} fillOpacity=".22" />
        <path d="M0 620C260 560 470 690 760 650C1030 612 1220 560 1440 610V700H0Z" fill={NAVY} fillOpacity=".10" />
      </svg>
    </>
  );
}

// Flat illustration: code window + booking calendar + chat bubble
function HeroArt() {
  return (
    <svg viewBox="0 0 520 420" role="img" aria-label="Illustration of a consultation booking calendar and code editor" style={{ width: '100%', height: 'auto' }}>
      <path d="M62 214C36 124 118 38 232 48C304 54 336 18 416 58C494 98 506 200 474 272C442 344 362 394 272 384C192 376 152 404 100 352C66 320 80 252 62 214Z" fill="#0b4a7e" />
      <path d="M62 214C36 124 118 38 232 48C304 54 336 18 416 58" fill="none" stroke={TEAL} strokeWidth="5" strokeLinecap="round" opacity=".7" />
      <rect x="92" y="96" width="196" height="132" rx="10" fill="#082a4d" />
      <rect x="92" y="96" width="196" height="22" rx="10" fill="#0f3d6b" />
      <rect x="92" y="108" width="196" height="10" fill="#0f3d6b" />
      <circle cx="108" cy="107" r="4" fill={ORANGE} /><circle cx="122" cy="107" r="4" fill="#ffd166" /><circle cx="136" cy="107" r="4" fill="#4cd6a4" />
      <g strokeLinecap="round" strokeWidth="6">
        <line x1="106" y1="136" x2="150" y2="136" stroke={TEAL} /><line x1="158" y1="136" x2="210" y2="136" stroke="#9fb9d4" />
        <line x1="120" y1="152" x2="188" y2="152" stroke={ORANGE} /><line x1="196" y1="152" x2="236" y2="152" stroke="#9fb9d4" />
        <line x1="120" y1="168" x2="164" y2="168" stroke="#9fb9d4" /><line x1="172" y1="168" x2="262" y2="168" stroke={TEAL} />
        <line x1="106" y1="184" x2="176" y2="184" stroke="#4cd6a4" /><line x1="184" y1="184" x2="214" y2="184" stroke="#9fb9d4" />
        <line x1="106" y1="200" x2="150" y2="200" stroke="#9fb9d4" />
      </g>
      <rect x="304" y="120" width="136" height="124" rx="12" fill="#fff" />
      <path d="M304 132a12 12 0 0 1 12-12h112a12 12 0 0 1 12 12v22H304z" fill={ORANGE} />
      <rect x="326" y="110" width="6" height="18" rx="3" fill={NAVY} /><rect x="412" y="110" width="6" height="18" rx="3" fill={NAVY} />
      <g fill="#cfe3f0">
        <rect x="318" y="166" width="20" height="16" rx="3" /><rect x="346" y="166" width="20" height="16" rx="3" /><rect x="374" y="166" width="20" height="16" rx="3" /><rect x="402" y="166" width="20" height="16" rx="3" />
        <rect x="318" y="190" width="20" height="16" rx="3" /><rect x="374" y="190" width="20" height="16" rx="3" /><rect x="402" y="190" width="20" height="16" rx="3" />
        <rect x="318" y="214" width="20" height="16" rx="3" /><rect x="346" y="214" width="20" height="16" rx="3" />
      </g>
      <rect x="346" y="190" width="20" height="16" rx="3" fill={TEAL} />
      <rect x="374" y="214" width="20" height="16" rx="3" fill={TEAL} />
      <circle cx="428" cy="236" r="20" fill="#4cd6a4" stroke="#0b4a7e" strokeWidth="5" />
      <path d="M419 236l7 7 14-15" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M110 244h126a14 14 0 0 1 14 14v22a14 14 0 0 1-14 14h-86l-22 20 3-20h-21a14 14 0 0 1-14-14v-22a14 14 0 0 1 14-14z" fill={ORANGE} />
      <g stroke="#fff" strokeWidth="6" strokeLinecap="round"><line x1="122" y1="262" x2="214" y2="262" /><line x1="122" y1="278" x2="176" y2="278" /></g>
      <circle cx="228" cy="62" r="26" fill={TEAL} />
      <text x="228" y="70" textAnchor="middle" fontFamily="monospace" fontWeight="700" fontSize="20" fill="#fff">&lt;/&gt;</text>
      <circle cx="452" cy="96" r="18" fill="none" stroke={TEAL} strokeWidth="5" strokeDasharray="6 5" />
      <circle cx="452" cy="96" r="6" fill={TEAL} />
      <circle cx="290" cy="330" r="8" fill={TEAL} /><circle cx="330" cy="352" r="5" fill="#fff" opacity=".7" /><circle cx="380" cy="320" r="6" fill={ORANGE} />
    </svg>
  );
}

const SERVICES = [
  { icon: CapIcon, title: 'Need Academic Advising?', text: 'Course planning, program requirements, and strategies for academic success.' },
  { icon: RocketIcon, title: 'Need Capstone & Project Help?', text: 'From capstone proposals to coding issues, get guidance from your faculty.' },
  { icon: ChatBubbleIcon, title: 'Open Consultation?', text: 'Grades, schedules, or anything else. Book a time with the right faculty member.' },
];

const STEPS = [
  { icon: EmailIcon, title: '1. Sign in', text: 'Use your university email to log in or create an account.' },
  { icon: CalendarIcon, title: '2. Choose a time & faculty', text: 'Pick a consultant and an open slot that fits your schedule.' },
  { icon: CheckCircleIcon, title: '3. Get confirmed', text: 'Your faculty approves the request and you get notified in your Mail.' },
];

const FAQS = [
  { q: 'Who can use CCIS Sync?', a: 'Students and faculty of the College of Computing and Information Sciences. Sign in with your school Google account (@antiquespride.edu.ph) and complete your profile with your School/Employee ID.' },
  { q: 'How do I book a consultation?', a: 'Log in, choose a faculty member and an available time, then submit your request with a short reason. The faculty member approves or declines it, and you are notified in your Mail.' },
  { q: 'Can I cancel an appointment?', a: 'Yes. You can cancel your own appointment from your dashboard, and the faculty member is notified.' },
  { q: 'Why is my account still pending?', a: 'New student and faculty accounts are reviewed by an administrator before access is granted. You will get an email once yours is approved; click the link in it to confirm your email, then log in.' },
  { q: 'What if a faculty member is on leave?', a: 'When a faculty member declares leave for a date, appointments on that date are cancelled automatically and the affected students are notified.' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const toast = useToast();

  // Theme tokens (light by default, readable in dark mode too)
  const pageBg = useColorModeValue(LIGHT, '#0b1220');
  const altBg = useColorModeValue('#ffffff', 'gray.800');
  const headingColor = useColorModeValue(NAVY, 'white');
  const bodyColor = useColorModeValue('#3c5a78', 'gray.300');
  const navBg = useColorModeValue('rgba(255,255,255,0.92)', 'rgba(11,18,32,0.92)');
  const navBorder = useColorModeValue('#d6e8f2', 'gray.700');
  const footerBg = useColorModeValue('#d9e9f3', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');
  const modalBg = useColorModeValue('white', 'gray.800');
  const heroGradient = useColorModeValue('linear(to-b, #f3fafd, #e3f2f9)', 'linear(to-b, #0b1220, #0f1d33)');
  const faqHoverBg = useColorModeValue('#f3fafd', 'gray.700');
  const outlineBorder = useColorModeValue(NAVY, 'whiteAlpha.700');
  const outlineHoverBg = useColorModeValue('#dff0f8', 'whiteAlpha.200');

  // Login / registration modal ("Book" buttons open it)
  const { isOpen, onOpen, onClose } = useDisclosure();
  const openAuth = () => onOpen();

  const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const { isOpen: isPrivacyOpen, onClose: onPrivacyClose } = useDisclosure();

  // After Google sign-in: store the session and go to the right dashboard.
  const finishLogin = (data: any) => {
    // Save secure data to local storage
    localStorage.setItem('userId', data._id);
    localStorage.setItem('userName', data.name);
    localStorage.setItem('userRole', data.role);
    localStorage.setItem('token', data.token);
    localStorage.setItem('programPosition', data.programPosition || '');
    localStorage.setItem('userEmail', data.email || '');
    localStorage.setItem('onboardingComplete', data.onboardingComplete === false ? 'false' : 'true');

    toast({ title: 'Login Successful', status: 'success', duration: 2000 });

    // Continue to the page a notification link was pointing at (saved by ProtectedRoute before sign-in).
    // One-shot, and only used when it is an allowlisted path on THIS person's own dashboard.
    const intendedRoute = sessionStorage.getItem('intendedRoute');
    sessionStorage.removeItem('intendedRoute');
    if (isSafeAppLink(intendedRoute) && linkMatchesRole(intendedRoute, data.role)) {
      navigate(intendedRoute);
      return;
    }

    // Default Navigation based on role
    if (data.role === 'STUDENT') navigate('/student-dashboard');
    else if (data.role === 'FACULTY') navigate('/faculty-dashboard');
    else if (data.role === 'ADMIN') navigate('/admin-dashboard');
    else if (data.role === 'DEAN') navigate('/dean-dashboard');
  };

  // The only way to sign in. The server verifies the token, checks the school domain and decides the role
  // (student, faculty, dean or admin) from the roster / ADMIN_EMAILS, so there is no Student / Faculty choice here.
  const handleGoogleCredential = async (credential: string) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      finishLogin(data); // an incomplete profile is finished on the dashboard (ProfileGate)
    } catch (error: any) {
      toast({ title: 'Sign-in failed', description: error.message, status: 'error', position: 'top' });
    }
  };

  // The sign-in box: Google only. New students are created on first sign-in; faculty, Dean and Admin accounts are added
  // by the administrator, so their first sign-in simply works once they are on the list.
  const authTabs = (
    <Box p={8}>
      <Text fontSize="sm" color="gray.600" mb={6}>
        Sign in with your school Google account. First time here as a student? Signing in creates your account, and you
        will then complete your profile with your School ID. Faculty, Dean and Admin accounts are added by the administrator.
      </Text>
      <VStack spacing={2}>
        <GoogleSignInButton onCredential={handleGoogleCredential} />
        <Text fontSize="xs" color="gray.500">Use your @antiquespride.edu.ph account</Text>
      </VStack>
    </Box>
  );

  const NAV_LINKS = [
    { label: 'Home', id: 'home' },
    { label: 'Services', id: 'services' },
    { label: 'How it Works', id: 'how' },
    { label: 'FAQ', id: 'faq' },
    { label: 'Contact', id: 'contact' },
  ];

  const pillPrimary = {
    bg: NAVY, color: 'white', borderRadius: 'full', fontWeight: 700, letterSpacing: '0.04em',
    _hover: { bg: CARD }, _active: { bg: CARD },
  };

  const authButtons = (
    <HStack spacing={{ base: 2, sm: 3 }} flexShrink={0}>
      <Button
        size="sm" px={{ base: 3, sm: 5 }} variant="outline" borderRadius="full" borderWidth="2px"
        borderColor={outlineBorder} color={headingColor} fontWeight={700} letterSpacing="0.04em"
        _hover={{ bg: outlineHoverBg }} _active={{ bg: outlineHoverBg }}
        onClick={() => openAuth()}
      >
        Log in
      </Button>
      <Button size="sm" px={{ base: 3, sm: 5 }} {...pillPrimary} onClick={() => openAuth()}>Sign in</Button>
    </HStack>
  );

  return (
    <Box bg={pageBg} textAlign="left">

      {/* ================= NAVBAR ================= */}
      <Box as="header" position="sticky" top={0} zIndex={20} bg={navBg} backdropFilter="blur(10px)" borderBottomWidth="1px" borderColor={navBorder}>
        <Container maxW="6xl">
          <Flex h="72px" align="center" justify="space-between">
            <HStack spacing={3} cursor="pointer" onClick={() => goTo('home')}>
              <LogoMark />
              <Text fontWeight="800" fontSize={{ base: "md", md: "xl" }} letterSpacing="0.06em" color={headingColor}>CCIS_SYNC</Text>
            </HStack>

            <HStack spacing={{ lg: 6, xl: 8 }} display={{ base: 'none', lg: 'flex' }}>
              {NAV_LINKS.map((l, i) => (
                <ChakraLink
                  key={l.id} href={`#${l.id}`} fontSize="sm" fontWeight="600" whiteSpace="nowrap" color={headingColor}
                  borderBottom="2px solid" borderColor={i === 0 ? TEAL : 'transparent'} pb="2px"
                  _hover={{ textDecoration: 'none', borderColor: TEAL }}
                  onClick={(e) => { e.preventDefault(); goTo(l.id); }}
                >
                  {l.label}
                </ChakraLink>
              ))}
            </HStack>

            {authButtons}
          </Flex>
        </Container>
      </Box>

      {/* ================= HERO ================= */}
      <Box id="home" position="relative" overflow="hidden" scrollMarginTop="72px"
        bgGradient={heroGradient}>
        <HeroWaves />
        <Container maxW="6xl" position="relative" py={{ base: 12, md: 20 }}>
          <Flex direction={{ base: 'column', md: 'row-reverse' }} align="center" gap={{ base: 8, md: 12 }}>
            <Box flex="1" textAlign={{ base: 'center', md: 'left' }}>
              <Heading as="h1" fontSize={{ base: '3xl', md: '4xl', lg: '5xl' }} fontWeight="800" lineHeight="1.15"
                textTransform="uppercase" letterSpacing="-0.01em" color={headingColor} mb={5}>
                Unlock your tech potential. Schedule your consultation today.
              </Heading>
              <Text fontSize={{ base: 'md', md: 'lg' }} color={bodyColor} mb={8} maxW="lg" mx={{ base: 'auto', md: 0 }}>
                Streamline your academic schedule. Book consultations with CCIS faculty without the wait.
              </Text>
              <Button
                size="lg" px={10} bg={ORANGE} color="white" borderRadius="full" fontWeight="800" letterSpacing="0.06em"
                boxShadow="0 8px 20px rgba(240,138,60,0.45)" rightIcon={<CalendarIcon />}
                _hover={{ bg: ORANGE_HOVER, transform: 'translateY(-2px)' }} _active={{ bg: ORANGE_HOVER }}
                onClick={() => openAuth()}
              >
                BOOK NOW
              </Button>
            </Box>
            <Box flex="1" w="100%" maxW={{ base: '420px', md: '540px' }}>
              <HeroArt />
            </Box>
          </Flex>
        </Container>
      </Box>

      {/* ================= OUR SERVICES ================= */}
      <Box id="services" py={{ base: 14, md: 20 }} scrollMarginTop="72px">
        <Container maxW="5xl">
          <Heading textAlign="center" fontSize={{ base: 'xl', md: '2xl' }} fontWeight="800" letterSpacing="0.08em" textTransform="uppercase" color={headingColor} mb={10}>
            Our Service
          </Heading>
          <SimpleGrid columns={{ base: 1, md: 3 }} spacing={6}>
            {SERVICES.map((s) => (
              <VStack key={s.title} spacing={3} p={7} borderRadius="2xl" textAlign="center"
                bgGradient={`linear(to-b, ${CARD}, #0b4a7e)`} color="white" boxShadow="0 10px 24px rgba(8,48,90,0.25)"
                transition="transform .2s" _hover={{ transform: 'translateY(-4px)' }}>
                <Icon as={s.icon} boxSize={12} color="white" />
                <Heading as="h3" fontSize="md" fontWeight="800" letterSpacing="0.06em" textTransform="uppercase">{s.title}</Heading>
                <Text fontSize="sm" color="whiteAlpha.900" flex="1">{s.text}</Text>
                <Button size="sm" px={8} mt={2} bg="white" color={NAVY} borderRadius="full" fontWeight="800"
                  _hover={{ bg: 'blue.50' }} onClick={() => openAuth()}>BOOK NOW!</Button>
              </VStack>
            ))}
          </SimpleGrid>
        </Container>
      </Box>

      {/* ================= HOW IT WORKS ================= */}
      <Box id="how" bg={NAVY} py={{ base: 14, md: 20 }} scrollMarginTop="72px">
        <Container maxW="5xl">
          <Heading textAlign="center" fontSize={{ base: 'xl', md: '2xl' }} fontWeight="800" letterSpacing="0.08em" textTransform="uppercase" color="white" mb={12}>
            How it Works
          </Heading>
          <Flex direction={{ base: 'column', md: 'row' }} align={{ base: 'center', md: 'flex-start' }} justify="center" gap={{ base: 8, md: 2 }}>
            {STEPS.map((s, i) => (
              <React.Fragment key={s.title}>
                <VStack flex="1" spacing={3} textAlign="center" maxW="280px">
                  <Flex w="84px" h="84px" borderRadius="full" bg="whiteAlpha.200" borderWidth="2px" borderColor={TEAL} align="center" justify="center">
                    <Icon as={s.icon} boxSize={8} color="white" />
                  </Flex>
                  <Text fontWeight="800" color="white" letterSpacing="0.03em">{s.title}</Text>
                  <Text fontSize="sm" color="whiteAlpha.800">{s.text}</Text>
                </VStack>
                {i < STEPS.length - 1 && (
                  <Flex display={{ base: 'none', md: 'flex' }} align="center" h="84px">
                    <Icon as={ChevronRightIcon} boxSize={8} color={TEAL} />
                  </Flex>
                )}
              </React.Fragment>
            ))}
          </Flex>
        </Container>
      </Box>

      {/* ================= FAQ ================= */}
      <Box id="faq" py={{ base: 14, md: 20 }} scrollMarginTop="72px">
        <Container maxW="3xl">
          <Heading textAlign="center" fontSize={{ base: 'xl', md: '2xl' }} fontWeight="800" letterSpacing="0.08em" textTransform="uppercase" color={headingColor} mb={10}>
            Frequently Asked Questions
          </Heading>
          <Accordion allowToggle>
            {FAQS.map((f) => (
              <AccordionItem key={f.q} bg={altBg} borderWidth="1px" borderColor={borderColor} borderRadius="lg" mb={3} overflow="hidden">
                <AccordionButton py={4} px={5} _hover={{ bg: faqHoverBg }}>
                  <Box flex="1" textAlign="left" fontWeight="700" color={headingColor}>{f.q}</Box>
                  <AccordionIcon color={TEAL} />
                </AccordionButton>
                <AccordionPanel pb={5} px={5} color={bodyColor} fontSize="sm">{f.a}</AccordionPanel>
              </AccordionItem>
            ))}
          </Accordion>
        </Container>
      </Box>

      {/* ================= ABOUT US (placeholder copy, design only) ================= */}
      <Box py={{ base: 14, md: 20 }} bg={altBg} borderTopWidth="1px" borderColor={borderColor}>
        <Container maxW="6xl">
          <Heading textAlign="center" fontSize={{ base: 'xl', md: '2xl' }} fontWeight="800" letterSpacing="0.08em" textTransform="uppercase" color={headingColor} mb={4}>About Us</Heading>
          <Text fontSize="md" color={bodyColor} textAlign="center" maxW="3xl" mx="auto" mb={12}>
            {/* TODO: replace with your real About Us copy */}
            CCIS Sync is a scheduling platform built by students, for students — designed to make
            booking faculty consultations simple, fast, and transparent for the whole college.
          </Text>
          <SimpleGrid columns={{ base: 1, md: 3 }} spacing={10}>
            {[
              { t: 'Our Mission', d: 'To remove the friction between students and faculty when scheduling academic consultations.' },
              { t: 'Our Team', d: 'Built by "Alpha Drive," a student development team from the College of Computing and Information Sciences.' },
              { t: 'Our Values', d: "Reliability, accessibility, and respect for everyone's time." },
            ].map((x) => (
              <VStack key={x.t} spacing={3} textAlign="center">
                <Heading size="md" color={headingColor}>{x.t}</Heading>
                {/* TODO: replace placeholder */}
                <Text fontSize="sm" color={bodyColor}>{x.d}</Text>
              </VStack>
            ))}
          </SimpleGrid>
        </Container>
      </Box>

      {/* ================= CONTACT / FOOTER (placeholder details) ================= */}
      <Box id="contact" bg={footerBg} pt={{ base: 12, md: 14 }} pb={6} scrollMarginTop="72px">
        <Container maxW="6xl">
          <Stack direction={{ base: 'column', md: 'row' }} spacing={{ base: 8, md: 12 }} justify="space-between" align={{ base: 'flex-start', md: 'center' }}>
            <VStack align="flex-start" spacing={4}>
              <HStack spacing={3}><LogoMark size={30} color={NAVY} /><Text fontWeight="800" letterSpacing="0.06em" color={headingColor}>CCIS_SYNC</Text></HStack>
              <HStack align="flex-start">
                <Icon as={EmailIcon} boxSize={4} color={TEAL} mt={1} />
                <Box>
                  <Text fontWeight="700" fontSize="sm" color={headingColor}>Email</Text>
                  {/* TODO: replace placeholder email */}
                  <Text color={bodyColor} fontSize="sm">ccis.support@ua.edu.ph</Text>
                </Box>
              </HStack>
              <HStack align="flex-start">
                <Icon as={PhoneIcon} boxSize={4} color={TEAL} mt={1} />
                <Box>
                  <Text fontWeight="700" fontSize="sm" color={headingColor}>Phone</Text>
                  {/* TODO: replace placeholder number */}
                  <Text color={bodyColor} fontSize="sm">+63 963 802 0042</Text>
                </Box>
              </HStack>
            </VStack>

            <Box>
              <Text fontWeight="700" fontSize="sm" color={headingColor}>Office</Text>
              {/* TODO: replace placeholder address */}
              <Text color={bodyColor} fontSize="sm">College of Computing and Information Sciences<br />CCIS Building, Room 205</Text>
            </Box>

            <VStack align={{ base: 'flex-start', md: 'center' }} spacing={3}>
              <Text fontWeight="800" color={headingColor} fontSize="sm" textTransform="uppercase" letterSpacing="0.06em">Ready to talk to a consultant?</Text>
              {authButtons}
            </VStack>
          </Stack>

          <Text mt={10} fontSize="xs" color={bodyColor} textAlign="center">
            © {new Date().getFullYear()} CCIS Sync — The Alpha Drive
          </Text>
        </Container>
      </Box>

      {/* ================= LOGIN / REGISTER MODAL ================= */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg" isCentered scrollBehavior="inside">
        <ModalOverlay backdropFilter="blur(4px)" />
        <ModalContent borderRadius="2xl" overflow="hidden" bg={modalBg}>
          <ModalHeader display="flex" alignItems="center" gap={3} pr={12} color={headingColor}>
            <LogoMark size={28} color={NAVY} />
            <Text fontWeight="800" letterSpacing="0.04em">Welcome to CCIS Sync</Text>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody p={0}>
            {authTabs}
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* ================= PRIVACY POLICY MODAL ================= */}

      <PrivacyPolicyModal isOpen={isPrivacyOpen} onClose={onPrivacyClose} />

    </Box>
  );
}
