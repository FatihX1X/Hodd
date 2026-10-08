/** Remembers an OAuth consent request across the sign-in round trip (15 minutes). */
export const AFTER_LOGIN_COOKIE = "hodd_after_login";

/** Only the consent screen may be resumed after login: no open redirects. */
export function safeAfterLogin(value: string | undefined | null): string | null {
  if (!value) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  return /^\/oauth\/consent\?authorization_id=[\w-]{8,200}$/.test(decoded) ? decoded : null;
}
