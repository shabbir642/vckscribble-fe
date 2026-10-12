import type { Stroke } from '../generated/contract';

/**
 * Strokes carry normalized 0..1 coordinates; everything here converts to the
 * pixel size of the target surface, so the same log renders correctly at any
 * canvas size.
 */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  w: number,
  h: number,
): void {
  const pts = stroke.points;
  if (!pts.length) return;

  if (stroke.tool === 'fill') {
    const seed = pts[0]!;
    floodFill(ctx, Math.round(seed.x * w), Math.round(seed.y * h), w, h, stroke.color);
    return;
  }

  ctx.save();
  // Eraser cuts through the cached bitmap rather than painting background over
  // it — the canvas is transparent, so painting a colour would show as a patch
  // in the other theme.
  ctx.globalCompositeOperation =
    stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = Math.max(1, stroke.size * w);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (pts.length === 1) {
    const p = pts[0]!;
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0]!.x * w, pts[0]!.y * h);
  // Quadratic midpoints smooth the polyline without needing extra samples.
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    ctx.quadraticCurveTo(
      a.x * w,
      a.y * h,
      ((a.x + b.x) / 2) * w,
      ((a.y + b.y) / 2) * h,
    );
  }
  const last = pts[pts.length - 1]!;
  ctx.lineTo(last.x * w, last.y * h);
  ctx.stroke();
  ctx.restore();
}

export const PALETTE = [
  // greys
  '#1d1b16', '#4a463c', '#8a8577', '#c9c3b4', '#ffffff',
  // reds / oranges
  '#7a1f17', '#c2503f', '#e8705a', '#e07a3f', '#f0a868',
  // yellows / greens
  '#e8c15a', '#f5e06b', '#4a7a1f', '#2f6f4f', '#4a9d7e',
  '#7fc99a',
  // blues
  '#1b3d6b', '#3f6fa8', '#5fa8d3', '#8fd3e8',
  // purples / pinks
  '#4a2a6b', '#6b4fa0', '#a07fc9', '#b05a8e', '#e89ab8',
  // browns / skin
  '#5a3a24', '#8a6a4a', '#c99a6b', '#e8c9a8', '#f2ddc4',
];

export const SIZES = [0.006, 0.014, 0.032];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Tolerance for "same region", summed over RGBA. Antialiased stroke edges sit
 *  between the fill region and the line, so a strict equality test leaves a
 *  halo; too loose a one leaks through the line entirely. */
const FILL_TOLERANCE = 110;

/**
 * Scanline flood fill from the seed pixel, bounded by whatever is already on
 * the canvas.
 *
 * This runs against the live bitmap rather than being baked into the stroke,
 * which is what lets a vector stroke log stay the source of truth: replaying
 * the log in order reproduces the same enclosed regions, because each fill sees
 * exactly the strokes that preceded it. The canvas is transparent where nothing
 * is drawn, so an unenclosed fill floods the whole surface — same as the real
 * game, and the reason a gap in an outline "leaks".
 */
function floodFill(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  hex: string,
): void {
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return;

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const at = (x: number, y: number) => (y * w + x) * 4;

  const seed = at(x0, y0);
  const sr = d[seed]!, sg = d[seed + 1]!, sb = d[seed + 2]!, sa = d[seed + 3]!;
  const [fr, fg, fb] = hexToRgb(hex);

  // Filling a region with the colour it already has would spin forever, since
  // painted pixels would keep testing as "matching".
  if (Math.abs(sr - fr) + Math.abs(sg - fg) + Math.abs(sb - fb) + Math.abs(sa - 255) <= 8) {
    return;
  }

  const matches = (i: number) =>
    Math.abs(d[i]! - sr) +
      Math.abs(d[i + 1]! - sg) +
      Math.abs(d[i + 2]! - sb) +
      Math.abs(d[i + 3]! - sa) <=
    FILL_TOLERANCE;

  const paint = (i: number) => {
    d[i] = fr;
    d[i + 1] = fg;
    d[i + 2] = fb;
    d[i + 3] = 255;
  };

  // Spans rather than single pixels: one entry per horizontal run keeps the
  // stack small enough for a full-canvas fill at retina resolution.
  const stack: number[] = [x0, y0];
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    let left = x;
    while (left > 0 && matches(at(left - 1, y))) left--;
    let right = x;
    while (right < w - 1 && matches(at(right + 1, y))) right++;

    let spanAbove = false;
    let spanBelow = false;
    for (let i = left; i <= right; i++) {
      paint(at(i, y));
      if (y > 0) {
        const up = matches(at(i, y - 1));
        if (up && !spanAbove) {
          stack.push(i, y - 1);
          spanAbove = true;
        } else if (!up) spanAbove = false;
      }
      if (y < h - 1) {
        const down = matches(at(i, y + 1));
        if (down && !spanBelow) {
          stack.push(i, y + 1);
          spanBelow = true;
        } else if (!down) spanBelow = false;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
}
