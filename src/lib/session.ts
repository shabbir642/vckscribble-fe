/**
 * The reconnect token, kept client-side so a refresh rejoins the same seat.
 * localStorage rather than sessionStorage: closing a tab by accident mid-game
 * should not cost you your score. Wrapped because storage throws in private
 * windows and with site data blocked.
 */
const KEY = 'vck:session';

export interface Session {
  roomCode: string;
  token: string;
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Session>;
    return v.roomCode && v.token ? { roomCode: v.roomCode, token: v.token } : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* non-fatal: the player just loses refresh-survival */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Shared join links: /?room=ABCD */
export function roomFromUrl(): string | null {
  const v = new URLSearchParams(location.search).get('room');
  return v ? v.toUpperCase() : null;
}
