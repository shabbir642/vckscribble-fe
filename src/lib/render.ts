import { COORD_SCALE, type Stroke } from '../generated/contract';

/** Any 2D surface a stroke log can be painted on, on screen or off it. */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Strokes carry flat, quantized points — [x0, y0, x1, y1, ...] on a
 * 0..COORD_SCALE grid. Everything here converts to the pixel size of the
 * target surface, so the same log renders correctly at any canvas size.
 */
export function drawStroke(
  ctx: Ctx2D,
  stroke: Stroke,
  w: number,
  h: number,
): void {
  const p = stroke.points;
  const n = p.length >> 1;
  if (!n) return;
  const sx = w / COORD_SCALE;
  const sy = h / COORD_SCALE;

  if (stroke.tool === 'fill') {
    floodFill(ctx, Math.round(p[0]! * sx), Math.round(p[1]! * sy), w, h, stroke.color);
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

  if (n === 1) {
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    ctx.arc(p[0]! * sx, p[1]! * sy, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(p[0]! * sx, p[1]! * sy);
  // Quadratic midpoints smooth the polyline without needing extra samples.
  for (let i = 1; i < n - 1; i++) {
    const ax = p[2 * i]!, ay = p[2 * i + 1]!;
    const bx = p[2 * i + 2]!, by = p[2 * i + 3]!;
    ctx.quadraticCurveTo(ax * sx, ay * sy, ((ax + bx) / 2) * sx, ((ay + by) / 2) * sy);
  }
  ctx.lineTo(p[2 * n - 2]! * sx, p[2 * n - 1]! * sy);
  ctx.stroke();
  ctx.restore();
}

/**
 * How much work replaying a log for a picture may take in all before it is
 * given up. Each fill reads and writes the whole bitmap: a few take tens of
 * milliseconds on a laptop (several times that on a cheap phone), and the
 * hundreds a script could send would take minutes. The server already keeps
 * fill-heavy canvases out of the summary; this is the backstop.
 */
export const REPLAY_BUDGET_MS = 8000;

/**
 * A replay works in slices of about this long, then hands the page back, so
 * the results screen stays responsive while a drawing with fills replays.
 */
const REPLAY_SLICE_MS = 24;

const yieldToPage = () => new Promise<void>((next) => setTimeout(next, 0));

/**
 * A whole log replayed onto a detached canvas of exactly w×h pixels, for
 * pictures made after the fact: the results screen and the share card.
 *
 * Its own canvas, because fills flood against whatever is already painted and
 * the eraser cuts through everything beneath it, so a log replayed straight
 * onto a card would flood or erase the card. It stays transparent like the
 * live canvas, whose white comes from the page: a white base would change
 * which antialiased edges a fill leaks through. Composite it onto paper with
 * drawImage, and keep it 4:3, since x and y scale separately.
 *
 * Replayed in slices (see REPLAY_SLICE_MS). Only time spent drawing counts
 * towards `budgetMs`, not time the page spent elsewhere (a tab in the
 * background runs timers slowly); past it the replay is given up and there is
 * no picture (null).
 */
export async function renderDrawing(
  strokes: readonly Stroke[],
  w = 1200,
  h = 900,
  budgetMs = REPLAY_BUDGET_MS,
): Promise<HTMLCanvasElement | null> {
  // Fills use the width as their row stride, so it must be the bitmap's own.
  const width = Math.max(1, Math.round(w));
  const height = Math.max(1, Math.round(h));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // A fresh context: transparent, with the identity transform fills need (they
  // write raw pixels). Fills also read pixels back, which this keeps cheap.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // No context means the browser is out of canvas memory: a blank picture
  // beats a broken results screen.
  if (!ctx) return canvas;
  let busy = 0;
  let slice = performance.now();
  for (const s of strokes) {
    drawStroke(ctx, s, width, height);
    const now = performance.now();
    if (busy + (now - slice) > budgetMs) {
      // iOS keeps a canvas's memory until it is shrunk.
      canvas.width = 0;
      canvas.height = 0;
      return null;
    }
    if (now - slice > REPLAY_SLICE_MS) {
      busy += now - slice;
      await yieldToPage();
      slice = performance.now();
    }
  }
  return canvas;
}

/**
 * Two rows of fifteen: a dark and a light shade of every marker colour, so
 * shading is one row away. Bright on purpose — this is a party game.
 */
export const PALETTE = [
  // darks
  '#000000', '#5b5b66', '#c0142b', '#e8590c', '#f2b705', '#1a9c3e', '#0b7a75',
  '#1c4fd8', '#5b21b6', '#b5179e', '#7c3f12', '#9a3412', '#3f6212', '#155e75', '#1e1b4b',
  // lights
  '#ffffff', '#c4c4cc', '#ff4d5e', '#ff922b', '#ffe066', '#51cf66', '#38d9c4',
  '#4dabf7', '#9775fa', '#f783ac', '#c69466', '#ffc9a3', '#b2f2bb', '#a5d8ff', '#ffd6e7',
];

/**
 * Brush and eraser widths, as a fraction of the canvas width (the server takes
 * 0.001 to 0.2): from fine detail to a bold marker.
 */
export const SIZES = [0.004, 0.008, 0.014, 0.024, 0.04];
/** The middle one, which the toolbar starts on. */
export const DEFAULT_SIZE = 0.014;

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
  ctx: Ctx2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  hex: string,
): void {
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return;

  const [fr, fg, fb] = hexToRgb(hex);
  // Filling a region with the colour it already has would spin forever, since
  // painted pixels would keep testing as "matching". The seed pixel alone
  // says so: a repeated fill then costs a one-pixel read, not a whole bitmap.
  const [pr = 0, pg = 0, pb = 0, pa = 0] = ctx.getImageData(x0, y0, 1, 1).data;
  if (Math.abs(pr - fr) + Math.abs(pg - fg) + Math.abs(pb - fb) + Math.abs(pa - 255) <= 8) {
    return;
  }

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const at = (x: number, y: number) => (y * w + x) * 4;

  const seed = at(x0, y0);
  const sr = d[seed]!, sg = d[seed + 1]!, sb = d[seed + 2]!, sa = d[seed + 3]!;

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
