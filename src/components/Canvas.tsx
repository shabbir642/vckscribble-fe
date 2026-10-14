import { memo, useEffect, useRef } from 'react';
import { COORD_SCALE, MAX_POINTS_PER_STROKE, type Stroke } from '../generated/contract';
import { drawStroke } from '../lib/render';
import { strokeStore } from '../lib/strokes';

interface Props {
  canDraw: boolean;
  tool: 'brush' | 'eraser' | 'fill';
  color: string;
  size: number;
  /** A new stroke: sent whole, once. */
  onStart: (stroke: Stroke) => void;
  /** New points for a live stroke: only the delta travels. */
  onAppend: (id: string, points: number[]) => void;
}

/**
 * Bitmap snapshots kept after flood fills, newest last. Each is a full-canvas
 * copy (~8 MB at 2x density), so only the most recent few are kept — they
 * cover the common case, undoing what you just did.
 */
const MAX_CHECKPOINTS = 4;

/** How often a live drag flushes its new points. */
const FLUSH_MS = 40;
/** Moves shorter than this (on the 0..COORD_SCALE grid) are jitter. */
const MIN_STEP = 20;

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Paints the shared stroke log imperatively. It never re-renders for drawing
 * traffic: it subscribes to the store and repaints at most once per animation
 * frame, however many point batches arrive in between.
 *
 * Finished strokes are baked into an offscreen cache; only strokes that may
 * still be growing are repainted each frame. "May still be growing" is the
 * latest non-fill stroke of each drawer — several in the lobby, where anyone
 * can draw at once, which is why the cache commits a prefix that stops at the
 * first live stroke rather than assuming only the last one is live.
 */
export const Canvas = memo(function Canvas({
  canDraw, tool, color, size, onStart, onAppend,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cacheRef = useRef<HTMLCanvasElement | null>(null);
  const cachedCount = useRef(0);
  const cachedIds = useRef(new Set<string>());
  const cachedRebuild = useRef(-1);
  /** The exact stroke objects baked into the cache, in order. */
  const committed = useRef<Stroke[]>([]);
  /**
   * Cache bitmaps taken right after a fill was baked in: `count` strokes deep.
   * A rebuild restores the deepest one whose strokes are all still in place
   * and replays only what follows, instead of every fill from the start.
   */
  const checkpoints = useRef<{ count: number; image: ImageData }[]>([]);
  const frame = useRef(0);

  // Live drag state, in refs so pointer handlers never wait on React.
  const live = useRef<{ stroke: Stroke; pending: number[]; lastFlush: number } | null>(null);
  const props = useRef({ canDraw, tool, color, size, onStart, onAppend });
  props.current = { canDraw, tool, color, size, onStart, onAppend };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const cache = document.createElement('canvas');
    cacheRef.current = cache;
    // Fills read the cache's pixels back; this keeps that readback cheap
    // instead of forcing a GPU round-trip per fill on every replay.
    const cctx = cache.getContext('2d', { willReadFrequently: true })!;
    const ctx = canvas.getContext('2d')!;

    const paint = () => {
      frame.current = 0;
      const { width: w, height: h } = canvas;
      if (!w || !h) return;
      const strokes = strokeStore.strokes;

      if (strokeStore.rebuild !== cachedRebuild.current || strokes.length < cachedCount.current) {
        // How much of what is baked in is still there, untouched? Compared by
        // object identity: a replaced or resynced stroke is a new object, so
        // it ends the shared prefix even when its id is the same.
        const baked = committed.current;
        let keep = 0;
        while (keep < baked.length && keep < strokes.length && baked[keep] === strokes[keep]) keep++;

        const cps = checkpoints.current.filter((c) => c.count <= keep);
        const cp = cps[cps.length - 1];
        checkpoints.current = cps;
        if (cp) {
          cctx.putImageData(cp.image, 0, 0);
          committed.current = baked.slice(0, cp.count);
        } else {
          cctx.clearRect(0, 0, w, h);
          committed.current = [];
        }
        cachedCount.current = committed.current.length;
        cachedIds.current = new Set(committed.current.map((x) => x.id));
        cachedRebuild.current = strokeStore.rebuild;
      }

      // Which strokes may still grow: each drawer's latest non-fill stroke.
      const liveIdx = new Set<number>();
      const seen = new Set<string>();
      for (let i = strokes.length - 1; i >= cachedCount.current; i--) {
        const s = strokes[i]!;
        if (seen.has(s.drawerId)) continue;
        seen.add(s.drawerId);
        if (s.tool !== 'fill') liveIdx.add(i);
      }

      // Commit the finished prefix.
      let i = cachedCount.current;
      for (; i < strokes.length && !liveIdx.has(i); i++) {
        const st = strokes[i]!;
        drawStroke(cctx, st, w, h);
        cachedIds.current.add(st.id);
        committed.current.push(st);
        if (st.tool === 'fill') {
          checkpoints.current.push({ count: i + 1, image: cctx.getImageData(0, 0, w, h) });
          if (checkpoints.current.length > MAX_CHECKPOINTS) checkpoints.current.shift();
        }
      }
      cachedCount.current = i;

      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(cache, 0, 0);
      for (let j = cachedCount.current; j < strokes.length; j++) {
        drawStroke(ctx, strokes[j]!, w, h);
      }
    };

    const schedule = () => {
      if (!frame.current) frame.current = requestAnimationFrame(paint);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      // The cache is checked on its own, not only when the visible canvas
      // changes: a remount (StrictMode does one in dev) creates a fresh cache
      // at the default 300x150 while the canvas element keeps its size, and a
      // cache sized only "on change" then clips every finished stroke.
      let stale = false;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        stale = true;
      }
      if (cache.width !== w || cache.height !== h) {
        cache.width = w;
        cache.height = h;
        stale = true;
      }
      if (stale) {
        // Resolution changed: the cache and every snapshot of it are stale.
        cachedRebuild.current = -1;
        committed.current = [];
        checkpoints.current = [];
      }
      schedule();
    };

    const unsubscribe = strokeStore.subscribe((touchedId) => {
      // Growth of a stroke already baked into the cache needs a rebuild, and
      // the stroke is the same object, so no snapshot can be trusted either.
      if (touchedId && cachedIds.current.has(touchedId)) {
        cachedRebuild.current = -1;
        committed.current = [];
        checkpoints.current = [];
      }
      schedule();
    });
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    return () => {
      unsubscribe();
      ro.disconnect();
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, []);

  // Losing the pen mid-drag (the turn ended, or the connection dropped) ends
  // the drag: points drawn after it could never reach the server.
  useEffect(() => {
    if (canDraw) return;
    const l = live.current;
    if (l?.pending.length) props.current.onAppend(l.stroke.id, l.pending);
    live.current = null;
  }, [canDraw]);

  const pointAt = (e: { clientX: number; clientY: number }, rect: DOMRect): [number, number] => [
    Math.round(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * COORD_SCALE),
    Math.round(Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) * COORD_SCALE),
  ];

  const flush = () => {
    const l = live.current;
    if (!l || !l.pending.length) return;
    props.current.onAppend(l.stroke.id, l.pending);
    l.pending = [];
    l.lastFlush = performance.now();
  };

  const begin = (first: [number, number]) => {
    const { tool: t, color: c, size: sz, onStart: start } = props.current;
    const stroke: Stroke = {
      id: newId(),
      drawerId: 'me', // server overwrites with the authenticated seat
      tool: t,
      color: c,
      size: sz,
      points: [first[0], first[1]],
    };
    strokeStore.put(stroke);
    // A copy: the local stroke keeps growing, the message must not.
    start({ ...stroke, points: stroke.points.slice() });
    return stroke;
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!props.current.canDraw) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const stroke = begin(pointAt(e, e.currentTarget.getBoundingClientRect()));
    live.current = stroke.tool === 'fill'
      ? null
      : { stroke, pending: [], lastFlush: performance.now() };
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = live.current;
    if (!l || !props.current.canDraw) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // Coalesced events recover the samples the browser merged into one frame,
    // so fast curves stay smooth without raising the send rate.
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of samples.length ? samples : [e.nativeEvent]) {
      const cur = live.current!;
      const [x, y] = pointAt(ev, rect);
      const pts = cur.stroke.points;
      const px = pts[pts.length - 2]!, py = pts[pts.length - 1]!;
      if (Math.abs(x - px) + Math.abs(y - py) < MIN_STEP) continue;

      if (pts.length / 2 >= MAX_POINTS_PER_STROKE) {
        // The server caps a stroke's length; continue seamlessly in a new one
        // that starts where this one ended.
        flush();
        const next = begin([px, py]);
        live.current = { stroke: next, pending: [], lastFlush: performance.now() };
      }
      const target = live.current!;
      strokeStore.append(target.stroke.id, [x, y]);
      target.pending.push(x, y);
    }
    if (performance.now() - live.current!.lastFlush >= FLUSH_MS) flush();
  };

  const onUp = () => {
    flush();
    live.current = null;
  };

  return (
    <canvas
      ref={canvasRef}
      className={`canvas ${canDraw ? 'can-draw' : ''}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  );
});
