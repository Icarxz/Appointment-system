// Is the internet really reachable? navigator.onLine only knows whether a network adapter is connected, so a laptop on
// Wi-Fi with no internet still says "online". Asking our own server settles it: ANY reply (even an error page) means the
// network works; only a failed or timed-out request means we are offline.
export async function checkConnection(
  { url = `${import.meta.env.BASE_URL}favicon.svg`, timeoutMs = 4000, fetchImpl = fetch }: {
    url?: string; timeoutMs?: number; fetchImpl?: typeof fetch;
  } = {},
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // A unique query string and no-store make sure we never get an answer from the browser cache.
    await fetchImpl(`${url}${url.includes('?') ? '&' : '?'}probe=${Date.now()}`, { method: 'HEAD', cache: 'no-store', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
