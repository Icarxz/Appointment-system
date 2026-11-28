import { useState } from 'react';
import { useDisclosure } from '@chakra-ui/react';
import OnboardingModal from './OnboardingModal';
import PrivacyPolicyModal from './PrivacyPolicyModal';

// Collects profile details Google cannot supply for accounts that were not provisioned with them.
// Provisioned Student, Faculty and Dean accounts review their existing details on My Profile instead.
export default function ProfileGate({ role }: { role: string }) {
  const [open, setOpen] = useState(localStorage.getItem('onboardingComplete') === 'false');
  const { isOpen: privacyOpen, onOpen: onPrivacyOpen, onClose: onPrivacyClose } = useDisclosure();

  if (localStorage.getItem('credentialConfirmationRequired') === 'true') return null;

  return (
    <>
      <OnboardingModal
        isOpen={open}
        role={role}
        email={localStorage.getItem('userEmail') || ''}
        name={localStorage.getItem('userName') || ''}
        token={localStorage.getItem('token') || ''}
        onOpenPrivacy={onPrivacyOpen}
        onSkip={role === 'STUDENT' ? () => setOpen(false) : undefined}
        onDone={(data) => {
          localStorage.setItem('userName', data.name);
          localStorage.setItem('token', data.token);
          localStorage.setItem('programPosition', data.programPosition || '');
          localStorage.setItem('onboardingComplete', 'true');
          window.location.reload(); // refresh so the whole dashboard uses the completed profile
        }}
      />
      <PrivacyPolicyModal isOpen={privacyOpen} onClose={onPrivacyClose} />
    </>
  );
}
