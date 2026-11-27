export function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return 'Could not reach the server. Check your connection and try again.';
  return fallback;
}
