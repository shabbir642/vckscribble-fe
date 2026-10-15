import { useEffect } from 'react';

/**
 * Publishes the height of the part of the page actually on screen as
 * `--app-h`, for screens laid out to fit it exactly (the game).
 *
 * CSS alone gets this wrong on phones: 100dvh ignores the on-screen keyboard
 * (iOS never shrinks the layout for it; Android only sometimes), so with the
 * keyboard up the guess box would sit under it, or the page would scroll the
 * drawing away. The visual viewport is the part not covered by browser bars or
 * the keyboard; sizing the layout to it keeps the drawing and the guess box in
 * view together while typing.
 */
export function useViewportHeight(active: boolean): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const root = document.documentElement;
    const update = () => {
      // Pinch-zoomed in: the visible part is small because it is magnified,
      // not covered. Re-fitting the layout to it would shrink everything.
      if (Math.abs(vv.scale - 1) > 0.01) return;
      root.style.setProperty('--app-h', `${Math.round(vv.height)}px`);
      // iOS scrolls the page to reveal a focused field; the layout already
      // fits above the keyboard, so put it back at the top.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    update();
    vv.addEventListener('resize', update);
    return () => {
      vv.removeEventListener('resize', update);
      root.style.removeProperty('--app-h');
    };
  }, [active]);
}
