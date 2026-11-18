import { useEffect, useRef } from 'react';
import { Box } from '@chakra-ui/react';

// Google Identity Services button. Loads Google's script on demand (no npm package needed) and
// hands the signed ID token ("credential") to onCredential. The server verifies it.
declare global {
  interface Window { google?: any }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';

export default function GoogleSignInButton({ onCredential, text = 'signin_with' }: { onCredential: (credential: string) => void; text?: 'signin_with' | 'continue_with' }) {
  const holder = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  useEffect(() => {
    if (!clientId) return;
    const render = () => {
      if (!window.google || !holder.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (r: { credential: string }) => cb.current(r.credential),
      });
      window.google.accounts.id.renderButton(holder.current, {
        theme: 'outline', size: 'large', text, shape: 'rectangular', width: 320,
      });
    };
    if (window.google) { render(); return; }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = GSI_SRC; script.async = true; script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', render);
    return () => script?.removeEventListener('load', render);
  }, [clientId, text]);

  if (!clientId) {
    return <Box fontSize="sm" color="red.500">Google sign-in is not configured (missing VITE_GOOGLE_CLIENT_ID).</Box>;
  }
  return <Box ref={holder} display="flex" justifyContent="center" minH="44px" />;
}
