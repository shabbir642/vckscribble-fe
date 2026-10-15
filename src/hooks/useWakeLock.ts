import { useEffect } from 'react';

/**
 * Keeps the screen on while `active` (the player is in a room). A phone that
 * is only watching would otherwise lock after a minute, the browser would drop
 * the connection, and the player would come back to "reconnecting". Browsers
 * release the lock when the tab is hidden, so it is taken again on return.
 * Unsupported or refused (low battery, an old browser): the game just works
 * as before.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const take = async () => {
      if (document.hidden || (lock && !lock.released)) return;
      try {
        const l = await navigator.wakeLock.request('screen');
        if (cancelled) void l.release();
        else lock = l;
      } catch {
        /* refused; nothing to do */
      }
    };
    const onVisible = () => void take();
    void take();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
