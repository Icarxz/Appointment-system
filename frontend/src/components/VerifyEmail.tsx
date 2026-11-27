import { useEffect, useRef, useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import {
  Box, Flex, Heading, Text, Button, VStack, Spinner, Icon, Input, InputGroup, InputRightAddon, useColorModeValue
} from '@chakra-ui/react';
import { CheckCircleIcon, WarningIcon } from '@chakra-ui/icons';
import { friendlyError, responseError } from '../utils/friendlyError';

// Shown when someone clicks the "verify your email" link from their inbox.
// It reads the :token from the URL, sends it to the backend once, and
// displays whichever result comes back. If the link is invalid or expired,
// the person can request a fresh one right here.
export default function VerifyEmail() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  // "Send me a new link" (shown on the error screen)
  const [resendEmail, setResendEmail] = useState('');
  const [isResending, setIsResending] = useState(false);
  const [resendResult, setResendResult] = useState<{ ok: boolean; text: string } | null>(null);

  const bg = useColorModeValue('#eaf5fb', '#0f1d33');
  const cardBg = useColorModeValue('white', 'gray.800');
  const headingColor = useColorModeValue('gray.800', 'white');

  // The token is one-time use. React 18 StrictMode (dev only) runs effects twice,
  // which would send it twice: the first call verifies the account, the second
  // fails because the token is already used, and the page would show "failed"
  // even though it worked. A ref survives that double run, so we only ever send once.
  const hasRequested = useRef(false);

  useEffect(() => {
    if (hasRequested.current) return;
    hasRequested.current = true;

    async function verify() {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/api/faculty/verify-email/${token}`);
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          setStatus('error');
          const fallback = 'This verification link is invalid or has expired. Request a new link and try again.';
          setMessage(friendlyError(responseError(response, data.error || fallback), fallback));
          return;
        }

        setStatus('success');
        setMessage(data.message || 'Your email has been verified.');
      } catch (error) {
        setStatus('error');
        setMessage(friendlyError(error, 'Could not verify your email. Please try again.'));
      }
    }

    if (token) {
      verify();
    } else {
      setStatus('error');
      setMessage('No verification token was provided.');
    }
  }, [token]);

  const handleResend = async () => {
    if (!resendEmail.trim()) {
      setResendResult({ ok: false, text: 'Enter your Gmail username first.' });
      return;
    }
    setIsResending(true);
    setResendResult(null);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/faculty/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `${resendEmail.trim()}@gmail.com`.toLowerCase() })
      });
      const data = await response.json();
      if (!response.ok) throw responseError(response, data.error || 'Could not send the verification email. Please try again.');
      setResendResult({ ok: true, text: data.message });
    } catch (error: any) {
      setResendResult({ ok: false, text: friendlyError(error, 'Could not send the verification email. Please try again.') });
    } finally {
      setIsResending(false);
    }
  };

  return (
    <Flex minH="100vh" align="center" justify="center" bg={bg} p={4}>
      <Box bg={cardBg} borderRadius="2xl" boxShadow="xl" p={10} maxW="420px" w="100%" textAlign="center">
        <VStack spacing={5}>
          {status === 'loading' && (
            <>
              <Spinner size="xl" color="blue.400" thickness="3px" />
              <Heading size="md" color={headingColor}>Verifying your email...</Heading>
            </>
          )}

          {status === 'success' && (
            <>
              <Icon as={CheckCircleIcon} boxSize={14} color="green.400" />
              <Heading size="md" color={headingColor}>Email verified</Heading>
              <Text color="gray.500">{message}</Text>
              <Button as={RouterLink} to="/" colorScheme="blue" size="lg" w="100%">
                Go to Login
              </Button>
            </>
          )}

          {status === 'error' && (
            <>
              <Icon as={WarningIcon} boxSize={14} color="red.400" />
              <Heading size="md" color={headingColor}>Verification failed</Heading>
              <Text color="gray.500">{message}</Text>

              <Box w="100%" textAlign="left">
                <Text fontSize="sm" fontWeight="600" color={headingColor} mb={2}>
                  Need a new link? Enter your Gmail username and we'll send one.
                </Text>
                <InputGroup>
                  <Input
                    placeholder="your.username"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    color={headingColor}
                  />
                  <InputRightAddon>@gmail.com</InputRightAddon>
                </InputGroup>
                <Button mt={3} colorScheme="blue" w="100%" onClick={handleResend} isLoading={isResending}>
                  Send me a new link
                </Button>
                {resendResult && (
                  <Text mt={3} fontSize="sm" color={resendResult.ok ? 'green.500' : 'red.400'}>
                    {resendResult.text}
                  </Text>
                )}
              </Box>

              <Button as={RouterLink} to="/" colorScheme="blue" size="md" w="100%" variant="outline">
                Back to Login
              </Button>
            </>
          )}
        </VStack>
      </Box>
    </Flex>
  );
}
