import { useCallback, useEffect, useRef } from 'react';
import type { Point, Stroke } from '../generated/contract';
import { drawStroke } from '../lib/render';

interface Props {
  strokes: Stroke[];
  /** Bumped by the parent on undo/clear, which invalidate the whole cache. */
  generation: number;
  canDraw: boolean;
  tool: 'brush' | 'eraser' | 'fill';
  color: string;
  size: number;
  onStroke: (stroke: Stroke) => void;
}

const STREAM_MS = 60;

export function Canvas({
  strokes, generation, canDraw, tool, color, size, onStroke,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Committed strokes live here so a live drag doesn't redraw the whole log. */
  const cacheRef = useRef<HTMLCanvasElement | null>(null);
  const cachedCount = useRef(0);
  const cachedGen = useRef(generation);
  const live = useRef<Stroke | null>(null);
  const lastSent = useRef(0);
  const frame = useRef(0);

  const sizeToBox = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      const cache = cacheRef.current ?? document.createElement('canvas');
      cache.width = w;
      cache.height = h;
      cacheRef.current = cache;
      // Resolution changed, so the cached bitmap is stale at any count.
      cachedCount.current = 0;
    }
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const cache = cacheRef.current;
    if (!canvas || !cache) return;
    const ctx = canvas.getContext('2d');
    const cctx = cache.getContext('2d');
    if (!ctx || !cctx) return;
    const { width: w, height: h } = canvas;

    // Undo/clear/resize rewind the cache; otherwise only new strokes are added.
    if (generation !== cachedGen.current || strokes.length < cachedCount.current) {
      cctx.clearRect(0, 0, w, h);
      cachedCount.current = 0;
      cachedGen.current = generation;
    }
    // The newest stroke stays uncached: it may still be growing.
    const commitTo = Math.max(0, strokes.length - 1);
    for (let i = cachedCount.current; i < commitTo; i++) {
      drawStroke(cctx, strokes[i]!, w, h);
    }
    cachedCount.current = commitTo;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(cache, 0, 0);
    const tail = strokes[strokes.length - 1];
    if (tail) drawStroke(ctx, tail, w, h);
    if (live.current) drawStroke(ctx, live.current, w, h);
  }, [strokes, generation]);

  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      render();
    });
  }, [render]);

  useEffect(() => {
    sizeToBox();
    render();
    const ro = new ResizeObserver(() => {
      sizeToBox();
      render();
    });
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [sizeToBox, render]);

  useEffect(() => {
    schedule();
  }, [strokes, generation, schedule]);

  const pointAt = (e: React.PointerEvent): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const stroke: Stroke = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      drawerId: 'me', // server overwrites with the authenticated seat
      tool,
      color,
      size,
      points: [pointAt(e)],
    };
    live.current = stroke;
    lastSent.current = 0;
    if (tool === 'fill') {
      live.current = null;
      onStroke(stroke);
      return;
    }
    schedule();
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = live.current;
    if (!s || !canDraw) return;
    const p = pointAt(e);
    const prev = s.points[s.points.length - 1]!;
    // Drop sub-pixel jitter; it inflates the payload without changing the line.
    if (Math.hypot(p.x - prev.x, p.y - prev.y) < 0.002) return;
    s.points.push(p);
    const now = performance.now();
    if (now - lastSent.current > STREAM_MS) {
      lastSent.current = now;
      onStroke({ ...s, points: [...s.points] });
    }
    schedule();
  };

  const onUp = () => {
    const s = live.current;
    live.current = null;
    if (s) onStroke({ ...s, points: [...s.points] });
    schedule();
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
}
