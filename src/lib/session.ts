import { inviteUrl } from '../generated/contract';

/**
 * Everything the browser remembers about the player, skribbl-style:
 *
 * - session: the seat you hold right now (room + reconnect token), so a refresh
 *   or a dropped connection puts you straight back in your seat;
 * - profile: your name and avatar, prefilled next time you play;
 * - device: a random id kept forever, so the server can hand your seat back
 *   even after the session token is gone.
 *
 * localStorage rather than sessionStorage: closing a tab by accident mid-game
 * should not cost you your score. Every access is wrapped because storage
 * throws in private windows and with site data blocked.
 */
const SESSION_KEY = 'vck:session';
const PROFILE_KEY = 'vck:profile';
const DEVICE_KEY = 'vck:device';

export interface Session {
  roomCode: string;
  token: string;
}

export interface Profile {
  name: string;
  avatar: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* non-fatal: the player just loses this bit of memory */
  }
}

export function loadSession(): Session | null {
  const v = read<Partial<Session>>(SESSION_KEY);
  return v?.roomCode && v.token ? { roomCode: v.roomCode, token: v.token } : null;
}
export const saveSession = (s: Session) => write(SESSION_KEY, s);
export const clearSession = () => write(SESSION_KEY, null);

export function loadProfile(): Profile | null {
  const v = read<Partial<Profile>>(PROFILE_KEY);
  return typeof v?.name === 'string' && typeof v.avatar === 'number'
    ? { name: v.name, avatar: v.avatar }
    : null;
}
export const saveProfile = (p: Profile) => write(PROFILE_KEY, p);

/** Stable per browser; generated on first use. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      // getRandomValues, not randomUUID: the latter only exists in a secure
      // context, and the game is also played over plain http on a LAN.
      id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------ the URL */

/**
 * One invite format everywhere: `/?room=CODE`. The address bar shows it while
 * you are in a room — so copying the URL is as good as the invite button — and
 * drops it when you leave, so a dead code never lingers.
 */
export function roomFromUrl(): string | null {
  const v = new URLSearchParams(location.search).get('room');
  return v && /^[A-Za-z0-9]{4,6}$/.test(v) ? v.toUpperCase() : null;
}

export function setUrlRoom(code: string | null): void {
  const target = code ? inviteUrl('', code) : '/';
  if (location.pathname + location.search !== target) {
    history.replaceState(null, '', target);
  }
}

export const roomInviteUrl = (code: string) => inviteUrl(location.origin, code);
