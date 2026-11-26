// Drop-in replacement for fetch() that attaches the login token.
// Place this file next to the dashboard files (or adjust the import path).
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('token');
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(input, { ...init, headers });
  } catch (err) {
    // The request never reached the server: ask the offline page to check the connection (see utils/useOnlineStatus.ts).
    window.dispatchEvent(new Event('sync:network-error'));
    throw err;
  }

  // Missing, invalid or expired (8h) token -> back to the login page.
  // 403 (not allowed) is NOT a logout; the caller handles it.
  if (res.status === 401) {
    const data = await res.clone().json().catch(() => null);
    if (data?.code === 'ACCOUNT_DISABLED') {
      sessionStorage.setItem(
        'accountDisabledNotice',
        data.error || 'Your account has been disabled. Please contact the administrator.',
      );
    }
    localStorage.clear();
    window.location.href = '/';
  }
  return res;
}
