import { memo, useEffect, useRef } from 'react';
import { COORD_SCALE, MAX_POINTS_PER_STROKE, type Stroke, type Tool } from '../generated/contract';
import { drawStroke } from '../lib/render';
import { isShape, shapePoints, type Shape } from '../lib/shapes';
import { strokeStore } from '../lib/strokes';

/** What a press on the canvas does: a stroke tool, or a shape to drag out. */
export type CanvasTool = Tool | Shape;

interface Props {
  canDraw: boolean;
  tool: CanvasTool;
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

/** Where a pointer is, as fractions of the canvas, clamped to it. */
const fractionAt = (e: { clientX: number; clientY: number }, rect: DOMRect): [number, number] => [
  Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
  Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
];

const pointAt = (e: { clientX: number; clientY: number }, rect: DOMRect): [number, number] => {
  const [fx, fy] = fractionAt(e, rect);
  return [Math.round(fx * COORD_SCALE), Math.round(fy * COORD_SCALE)];
};

/**
 * A shape being dragged out. Nothing is sent until it is let go: until then it
 * is a preview on this screen alone. The ends are fractions of the canvas, so
 * a resize mid-drag (a phone turning, a toolbar sliding away) keeps them.
 */
interface ShapeDrag {
  pointerId: number;
  shape: Shape;
  color: string;
  size: number;
  from: [number, number];
  to: [number, number];
  /** Shift: squares, circles, lines at 45° steps. */
  constrain: boolean;
}

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
  const live = useRef<{ pointerId: number; stroke: Stroke; pending: number[]; lastFlush: number } | null>(null);
  const shaping = useRef<ShapeDrag | null>(null);
  /** The shape as it would land if let go now; null while too small to draw. */
  const preview = useRef<Stroke | null>(null);
  /** Schedules a paint; set up with the canvas. */
  const repaint = useRef(() => {});
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
      // A shape being dragged out goes on top, where it will land when let go.
      if (preview.current) drawStroke(ctx, preview.current, w, h);
    };

    const schedule = () => {
      if (!frame.current) frame.current = requestAnimationFrame(paint);
    };
    repaint.current = schedule;

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
      repaint.current = () => {};
    };
  }, []);

  // Losing the pen mid-drag (the turn ended, or the connection dropped) ends
  // the drag: points drawn after it could never reach the server, and a shape
  // not yet let go is dropped.
  useEffect(() => {
    if (canDraw) return;
    const l = live.current;
    if (l?.pending.length) props.current.onAppend(l.stroke.id, l.pending);
    live.current = null;
    cancelShape();
  }, [canDraw]);

  // Escape drops a shape mid-drag. Shift squares it up (or snaps a line) the
  // moment it is pressed or let go, without waiting for the pointer to move.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = shaping.current;
      if (!d) return;
      if (e.key === 'Escape' && e.type === 'keydown') {
        e.preventDefault();
        cancelShape();
      } else if (e.key === 'Shift' && d.constrain !== e.shiftKey) {
        d.constrain = e.shiftKey;
        reshape();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  const flush = () => {
    const l = live.current;
    if (!l || !l.pending.length) return;
    props.current.onAppend(l.stroke.id, l.pending);
    l.pending = [];
    l.lastFlush = performance.now();
  };

  const begin = (first: [number, number], style: Pick<Stroke, 'tool' | 'color' | 'size'>) => {
    const stroke: Stroke = {
      id: newId(),
      drawerId: 'me', // server overwrites with the authenticated seat
      tool: style.tool,
      color: style.color,
      size: style.size,
      points: [first[0], first[1]],
    };
    strokeStore.put(stroke);
    // A copy: the local stroke keeps growing, the message must not.
    props.current.onStart({ ...stroke, points: stroke.points.slice() });
    return stroke;
  };

  /** Works the preview out again from the drag, at the canvas's size now. */
  const reshape = () => {
    const d = shaping.current;
    const canvas = canvasRef.current;
    if (!d || !canvas) return;
    const { width: w, height: h } = canvas.getBoundingClientRect();
    const points = shapePoints(
      d.shape,
      { x: d.from[0] * w, y: d.from[1] * h },
      { x: d.to[0] * w, y: d.to[1] * h },
      w,
      h,
      d.constrain,
    );
    // An ordinary brush stroke, so it travels and replays like any other.
    preview.current = points
      ? { id: 'preview', drawerId: 'me', tool: 'brush', color: d.color, size: d.size, points }
      : null;
    repaint.current();
  };

  const cancelShape = () => {
    if (!shaping.current) return;
    shaping.current = null;
    preview.current = null;
    repaint.current();
  };

  /** Let go: what the preview showed becomes one stroke, sent whole, once. */
  const finishShape = () => {
    const shape = preview.current;
    shaping.current = null;
    preview.current = null;
    if (!shape) return; // a tap, or dragged back to where it started
    const stroke: Stroke = { ...shape, id: newId() };
    strokeStore.put(stroke);
    props.current.onStart({ ...stroke, points: stroke.points.slice() });
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // One pen at a time: a second finger (or a resting palm) neither starts a
    // stroke of its own nor tugs at the one being drawn.
    if (!props.current.canDraw || !e.isPrimary) return;
    // isPrimary is per kind of pointer: a palm landing during a pen or mouse
    // drag is the primary touch. Leave a drag alone while it still holds its
    // pointer; one whose release was lost has let go of it.
    const busy = live.current?.pointerId ?? shaping.current?.pointerId;
    if (busy !== undefined && busy !== e.pointerId && e.currentTarget.hasPointerCapture?.(busy)) return;
    // A drag whose end never arrived is over now.
    flush();
    live.current = null;
    cancelShape();

    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const { tool, color: c, size: sz } = props.current;
    if (isShape(tool)) {
      const at = fractionAt(e, rect);
      shaping.current = {
        pointerId: e.pointerId, shape: tool, color: c, size: sz, from: at, to: at, constrain: e.shiftKey,
      };
      return;
    }
    const stroke = begin(pointAt(e, rect), { tool, color: c, size: sz });
    live.current = stroke.tool === 'fill'
      ? null
      : { pointerId: e.pointerId, stroke, pending: [], lastFlush: performance.now() };
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!props.current.canDraw) return;
    const d = shaping.current;
    if (d) {
      if (e.pointerId !== d.pointerId) return;
      // Only where the pointer is now matters: no need for coalesced samples.
      d.to = fractionAt(e, e.currentTarget.getBoundingClientRect());
      d.constrain = e.shiftKey;
      reshape();
      return;
    }
    const l = live.current;
    if (!l || e.pointerId !== l.pointerId) return;
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
        // that starts where this one ended, in the same tool, colour and size.
        flush();
        const next = begin([px, py], cur.stroke);
        live.current = { pointerId: cur.pointerId, stroke: next, pending: [], lastFlush: performance.now() };
      }
      const target = live.current!;
      strokeStore.append(target.stroke.id, [x, y]);
      target.pending.push(x, y);
    }
    if (performance.now() - live.current!.lastFlush >= FLUSH_MS) flush();
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = shaping.current;
    if (d) {
      if (e.pointerId === d.pointerId) finishShape();
      return;
    }
    if (live.current?.pointerId !== e.pointerId) return;
    flush();
    live.current = null;
  };

  // The system took the pointer (a gesture, a call coming in): a stroke keeps
  // what was drawn, a shape not yet let go is dropped.
  const onCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = shaping.current;
    if (d) {
      if (e.pointerId === d.pointerId) cancelShape();
      return;
    }
    onUp(e);
  };

  return (
    <canvas
      ref={canvasRef}
      className={`canvas ${canDraw ? 'can-draw' : ''}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
    />
  );
});
