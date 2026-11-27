type ErrorDetails = {
  message?: unknown;
  status?: unknown;
  response?: { status?: unknown };
};

const NETWORK_ERROR = "Can't reach the server. Check your internet connection and try again.";
const SERVER_ERROR = 'Something went wrong on our side. Please try again. If it keeps happening, tell your administrator.';

export function responseError(response: Pick<Response, 'status'>, message: unknown): Error & { status: number } {
  return Object.assign(new Error(typeof message === 'string' ? message : ''), { status: response.status });
}

export function friendlyError(error: unknown, fallback: string): string {
  const details = error && typeof error === 'object' ? error as ErrorDetails : undefined;
  const status = typeof details?.status === 'number'
    ? details.status
    : typeof details?.response?.status === 'number' ? details.response.status : undefined;

  if (status === 401) return 'Your session expired. Please sign in again.';
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return 'That item could not be found. It may have been removed.';
  if (status === 429) return 'Too many attempts. Please wait a minute and try again.';
  if (status !== undefined && status >= 500) return SERVER_ERROR;

  const message = typeof error === 'string'
    ? error
    : typeof details?.message === 'string' ? details.message : '';
  if (/\b(?:failed to fetch|fetch failed|network error|load failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT)\b/i.test(message)
    || (error instanceof TypeError && !message.trim())) {
    return NETWORK_ERROR;
  }
  if (/\bstack\b|\bObjectId\b|\bE11000\b|\bmongoose\b|\bUnexpected token\b|\bundefined\b|[{}]|<!doctype|^\s*</i.test(message)
    || /\b(?:TypeError|SyntaxError|ReferenceError|RangeError)\b|\n\s*at\s+/i.test(message)) {
    return fallback;
  }
  return message || fallback;
}
