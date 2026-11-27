import { useState } from 'react';
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Box, Flex, Heading, Text, Input, Button, VStack, useToast, useColorModeValue,
  FormControl, FormLabel, InputGroup, InputRightElement, IconButton, List, ListItem, ListIcon
} from '@chakra-ui/react';
import { ViewIcon, ViewOffIcon, CheckCircleIcon, WarningIcon } from '@chakra-ui/icons';
import { friendlyError, responseError } from '../utils/friendlyError';

// Same password rule enforced on the backend in routes/faculty.js
// (POST /reset-password/:token) and in LandingPage.tsx's registration form.
// Keeping this in one place would be better long-term, but for now the
// three copies must be changed together if the rule ever changes.
const PASSWORD_MIN_LENGTH = 12;
const passwordPattern = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

export default function ResetPassword() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [done, setDone] = useState(false);

  const bg = useColorModeValue('#eaf5fb', '#0f1d33');
  const cardBg = useColorModeValue('white', 'gray.800');

  const passwordRules = {
    length: newPassword.length >= PASSWORD_MIN_LENGTH,
    upper: /[A-Z]/.test(newPassword),
    number: /\d/.test(newPassword),
    symbol: /[^A-Za-z0-9]/.test(newPassword),
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!passwordPattern.test(newPassword)) {
      toast({
        title: 'Password too weak',
        description: 'Must be at least 12 characters, with 1 uppercase letter, 1 number, and 1 symbol.',
        status: 'warning'
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", status: 'warning' });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/faculty/reset-password/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword })
      });

      const data = await response.json();
      if (!response.ok) throw responseError(response, data.error || 'Could not reset your password. Please try again.');

      setDone(true);
      toast({ title: 'Password updated', description: data.message, status: 'success' });
    } catch (error: any) {
      toast({ title: 'Reset failed', description: friendlyError(error, 'Could not reset your password. Please try again.'), status: 'error' });
    }
    setIsSubmitting(false);
  };

  return (
    <Flex minH="100vh" align="center" justify="center" bg={bg} p={4}>
      <Box bg={cardBg} borderRadius="2xl" boxShadow="xl" p={10} maxW="440px" w="100%">
        {done ? (
          <VStack spacing={5} textAlign="center">
            <CheckCircleIcon boxSize={14} color="green.400" />
            <Heading size="md">Password updated</Heading>
            <Text color="gray.500">You can now log in with your new password.</Text>
            <Button colorScheme="blue" size="lg" w="100%" onClick={() => navigate('/')}>
              Go to Login
            </Button>
          </VStack>
        ) : (
          <>
            <Heading size="md" mb={2}>Set a new password</Heading>
            <Text color="gray.500" fontSize="sm" mb={6}>
              Choose a new password for your account. This link can only be used once and expires 15 minutes after it was requested.
            </Text>
            <form onSubmit={handleSubmit}>
              <VStack spacing={5} align="stretch">
                <FormControl isRequired>
                  <FormLabel>New Password</FormLabel>
                  <InputGroup>
                    <Input
                      type={showPw ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setShowRules(true); }}
                    />
                    <InputRightElement>
                      <IconButton
                        aria-label="Toggle password visibility"
                        icon={showPw ? <ViewOffIcon /> : <ViewIcon />}
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowPw(!showPw)}
                      />
                    </InputRightElement>
                  </InputGroup>
                </FormControl>

                {showRules && (
                  <List spacing={1} fontSize="sm" color="gray.500">
                    <ListItem>
                      <ListIcon as={passwordRules.length ? CheckCircleIcon : WarningIcon} color={passwordRules.length ? 'green.400' : 'gray.400'} />
                      At least {PASSWORD_MIN_LENGTH} characters
                    </ListItem>
                    <ListItem>
                      <ListIcon as={passwordRules.upper ? CheckCircleIcon : WarningIcon} color={passwordRules.upper ? 'green.400' : 'gray.400'} />
                      One uppercase letter
                    </ListItem>
                    <ListItem>
                      <ListIcon as={passwordRules.number ? CheckCircleIcon : WarningIcon} color={passwordRules.number ? 'green.400' : 'gray.400'} />
                      One number
                    </ListItem>
                    <ListItem>
                      <ListIcon as={passwordRules.symbol ? CheckCircleIcon : WarningIcon} color={passwordRules.symbol ? 'green.400' : 'gray.400'} />
                      One symbol
                    </ListItem>
                  </List>
                )}

                <FormControl isRequired>
                  <FormLabel>Confirm New Password</FormLabel>
                  <Input
                    type={showPw ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </FormControl>

                <Button type="submit" colorScheme="blue" size="lg" w="100%" isLoading={isSubmitting}>
                  Update Password
                </Button>

                <Text textAlign="center" fontSize="sm">
                  <RouterLink to="/">Back to Login</RouterLink>
                </Text>
              </VStack>
            </form>
          </>
        )}
      </Box>
    </Flex>
  );
}
