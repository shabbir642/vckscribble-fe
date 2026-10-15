import { strokeStore } from './strokes';

/**
 * Smooth playback of other players' strokes.
 *
 * A drawer's points arrive in batches every ~40 ms. Painted as they land, a
 * watcher's line grows in visible hops, 25 times a second. Instead each batch
 * is fed to the canvas a little per animation frame, spread over about one
 * batch interval, so the line flows like a live pen at the display's own rate.
 * The cost is up to one interval (~40 ms) of extra delay.
 */
const SPREAD_MS = 40;
/** A backlog beyond this many points (a lag burst) is caught up at once. */
const MAX_BACKLOG = 30;

const pending = new Map<string, number[]>();
let raf = 0;
let last = 0;

function frame(now: number): void {
  raf = 0;
  const dt = last ? now - last : 16;
  last = now;
  for (const [id, q] of pending) {
    const pairs = q.length / 2;
    let take = Math.max(1, Math.ceil((pairs * dt) / SPREAD_MS));
    if (pairs - take > MAX_BACKLOG) take = pairs - MAX_BACKLOG;
    const known = strokeStore.append(id, q.splice(0, take * 2));
    if (!known || q.length === 0) pending.delete(id);
  }
  if (pending.size) raf = requestAnimationFrame(frame);
  else last = 0;
}

/** Queue a remote stroke's new points for smooth painting. */
export function playPoints(id: string, points: number[]): void {
  const q = pending.get(id);
  if (q) for (let i = 0; i < points.length; i++) q.push(points[i]!);
  else pending.set(id, points.slice());
  // A hidden tab gets no animation frames: paint straight into the store, so
  // the drawing is complete the moment the tab is looked at again.
  if (document.hidden) {
    flushPlayback();
    return;
  }
  if (!raf) raf = requestAnimationFrame(frame);
}

/** Paint everything still queued, now (before anything that reorders strokes). */
export function flushPlayback(): void {
  for (const [id, q] of pending) strokeStore.append(id, q);
  pending.clear();
}

/** Forget queued points: their stroke was undone, or the canvas cleared/replaced. */
export function dropPlayback(id?: string): void {
  if (id === undefined) pending.clear();
  else pending.delete(id);
}
