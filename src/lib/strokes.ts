import type { Stroke } from '../generated/contract';

/**
 * The stroke log, held outside React.
 *
 * Strokes used to live in React state at the app root, so every incoming point
 * batch — dozens a second while someone draws — re-rendered the whole tree,
 * chat and scoreboard included. The canvas is the only consumer, and it paints
 * imperatively, so the log is a plain mutable store it subscribes to.
 *
 * `rebuild` tells the canvas its cached bitmap is stale (undo, clear, sync, or
 * a change to a stroke it already committed); otherwise it only paints what is
 * new.
 */
export class StrokeStore {
  strokes: Stroke[] = [];
  private index = new Map<string, Stroke>();
  /** Bumped on any change that invalidates already-painted strokes. */
  rebuild = 0;
  private listeners = new Set<(touchedId?: string) => void>();

  /** `touchedId` is set when an existing stroke grew in place. */
  subscribe(fn: (touchedId?: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(touchedId?: string): void {
    for (const fn of this.listeners) fn(touchedId);
  }

  /** Start (or replace) a stroke. */
  put(stroke: Stroke): void {
    const existing = this.index.get(stroke.id);
    if (existing) {
      this.strokes[this.strokes.indexOf(existing)] = stroke;
      this.rebuild++;
    } else {
      this.strokes.push(stroke);
    }
    this.index.set(stroke.id, stroke);
    this.changed();
  }

  /** Grow a stroke in place. Returns false if the stroke is unknown. */
  append(id: string, points: number[]): boolean {
    const s = this.index.get(id);
    if (!s) return false;
    for (let i = 0; i < points.length; i++) s.points.push(points[i]!);
    this.changed(id);
    return true;
  }

  remove(id: string): void {
    const s = this.index.get(id);
    if (!s) return;
    this.strokes.splice(this.strokes.indexOf(s), 1);
    this.index.delete(id);
    this.rebuild++;
    this.changed();
  }

  replaceAll(strokes: Stroke[]): void {
    this.strokes = strokes;
    this.index = new Map(strokes.map((s) => [s.id, s]));
    this.rebuild++;
    this.changed();
  }

  clear(): void {
    this.replaceAll([]);
  }
}

/** One canvas, one log, for the whole app. */
export const strokeStore = new StrokeStore();
