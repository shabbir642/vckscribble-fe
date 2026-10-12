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
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = stroke.color;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
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
  '#1d1b16', '#ffffff', '#c2503f', '#e07a3f', '#e8c15a',
  '#2f6f4f', '#4a9d7e', '#3f6fa8', '#6b4fa0', '#b05a8e',
  '#8a6a4a', '#9a9382',
];

export const SIZES = [0.006, 0.014, 0.032];
