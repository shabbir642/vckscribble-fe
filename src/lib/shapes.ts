import { COORD_SCALE } from '../generated/contract';

/**
 * Straight lines, rectangles and circles, dragged out from one corner to the
 * other. A shape is sent and kept as one ordinary brush stroke: points the
 * renderer already joins up. So every player, every replay and the share card
 * draw it (older clients too), the fill tool floods inside it like any
 * outline, and undo takes it away whole.
 *
 * Pure: positions on screen in, points on the grid out.
 */
export type Shape = 'line' | 'rectangle' | 'circle';

export const isShape = (v: unknown): v is Shape => v === 'line' || v === 'rectangle' || v === 'circle';

/** A position on the canvas in CSS pixels, from its top-left corner. */
export interface Point {
  x: number;
  y: number;
}

/** A drag shorter than this (CSS pixels) is a tap, not a shape: it draws nothing. */
export const MIN_SHAPE_PX = 6;

/**
 * How far (grid units) either side of a rectangle's corner its flanking
 * points sit. The renderer curves through the midpoints between points, so a
 * corner given as one point would be rounded off across half of each side.
 * Flanked this closely, the rounding stays within a fraction of a pixel at
 * any canvas size and the sides between stay straight.
 */
const CORNER = 12;

/** Points around a circle: a smooth curve at any size, under a kilobyte on the wire. */
const RING = 72;

/**
 * The renderer's curve runs through the midpoints of the sides between the
 * points, just inside the points themselves. Set out by this much, the points
 * put that curve on the true ellipse, touching the dragged box.
 */
const RING_OUT = 1 / Math.cos(Math.PI / RING);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Where a constrained drag (Shift held) ends: a line turned to the nearest
 * 45°, a rectangle or circle given a square box.
 *
 * Worked out in screen pixels, not grid units: the canvas is 4:3, so equal
 * steps on the grid across and down are not equal on screen, and only equal
 * pixels look square to the person drawing. Both points are on the canvas
 * (0..w, 0..h) and the end stays there: a square that would run off the edge
 * stops growing at it rather than being flattened against it.
 */
export function constrainEnd(shape: Shape, a: Point, b: Point, w: number, h: number): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Which way the box grows on each axis. A drag straight along one axis
  // grows it on the other towards the side with more room.
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : a.x <= w / 2 ? 1 : -1;
  const sy = dy > 0 ? 1 : dy < 0 ? -1 : a.y <= h / 2 ? 1 : -1;
  const roomX = sx > 0 ? w - a.x : a.x;
  const roomY = sy > 0 ? h - a.y : a.y;

  if (shape === 'line') {
    // 0: level, 1: diagonal, 2: upright.
    const step = Math.round(Math.atan2(Math.abs(dy), Math.abs(dx)) / (Math.PI / 4));
    if (step === 0) return { x: b.x, y: a.y };
    if (step === 2) return { x: a.x, y: b.y };
    const s = Math.min((Math.abs(dx) + Math.abs(dy)) / 2, roomX, roomY);
    return { x: a.x + sx * s, y: a.y + sy * s };
  }
  const s = Math.min(Math.max(Math.abs(dx), Math.abs(dy)), roomX, roomY);
  return { x: a.x + sx * s, y: a.y + sy * s };
}

/**
 * The shape dragged from `from` to `to` on a canvas shown `w`×`h` CSS pixels,
 * as a stroke's flat points on the 0..COORD_SCALE grid, or null for a drag too
 * short to mean a shape.
 *
 * Computed on screen, then put on the grid with x and y scaled separately, so
 * a circle drawn round is round for everyone (every canvas is 4:3).
 * Rectangles and circles end where they start: closed, so a fill stays inside.
 */
export function shapePoints(
  shape: Shape,
  from: Point,
  to: Point,
  w: number,
  h: number,
  constrain = false,
): number[] | null {
  if (!(w > 0) || !(h > 0)) return null;
  const a = { x: clamp(from.x, 0, w), y: clamp(from.y, 0, h) };
  let b = { x: clamp(to.x, 0, w), y: clamp(to.y, 0, h) };
  if (constrain) b = constrainEnd(shape, a, b, w, h);
  // (Written so that a position that is not a number draws nothing too.)
  if (!(Math.hypot(b.x - a.x, b.y - a.y) >= MIN_SHAPE_PX)) return null;

  const gx = (x: number) => clamp(Math.round((x / w) * COORD_SCALE), 0, COORD_SCALE);
  const gy = (y: number) => clamp(Math.round((y / h) * COORD_SCALE), 0, COORD_SCALE);

  if (shape === 'line') return [gx(a.x), gy(a.y), gx(b.x), gy(b.y)];

  if (shape === 'rectangle') {
    const x0 = gx(Math.min(a.x, b.x));
    const x1 = gx(Math.max(a.x, b.x));
    const y0 = gy(Math.min(a.y, b.y));
    const y1 = gy(Math.max(a.y, b.y));
    // Never past the middle of a side, or a thin box's flanking points would cross.
    const cx = Math.min(CORNER, Math.floor((x1 - x0) / 2));
    const cy = Math.min(CORNER, Math.floor((y1 - y0) / 2));
    // Clockwise from just right of the top-left corner, ending where it began.
    return [
      x0 + cx, y0,
      x1 - cx, y0, x1, y0, x1, y0 + cy,
      x1, y1 - cy, x1, y1, x1 - cx, y1,
      x0 + cx, y1, x0, y1, x0, y1 - cy,
      x0, y0 + cy, x0, y0, x0 + cx, y0,
    ];
  }

  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = (Math.abs(b.x - a.x) / 2) * RING_OUT;
  const ry = (Math.abs(b.y - a.y) / 2) * RING_OUT;
  const ring: number[] = [];
  for (let i = 0; i < RING; i++) {
    const t = (2 * Math.PI * i) / RING;
    ring.push(gx(cx + rx * Math.cos(t)), gy(cy + ry * Math.sin(t)));
  }
  // Start and end halfway along the last side rather than on a point: the
  // renderer curves through midpoints, so the seam is as smooth as the rest.
  const mx = Math.round((ring[0]! + ring[2 * RING - 2]!) / 2);
  const my = Math.round((ring[1]! + ring[2 * RING - 1]!) / 2);
  return [mx, my, ...ring, mx, my];
}
