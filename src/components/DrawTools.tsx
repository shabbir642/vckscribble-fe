import { useEffect, useId, useRef, useState } from 'react';
import { isShape, type Shape } from '../lib/shapes';

/** The tools that put down ink: the brush and the shapes. */
export type DrawTool = 'brush' | Shape;

export const isDrawTool = (v: unknown): v is DrawTool => v === 'brush' || isShape(v);

/** In toolbar order. `key` is the desktop shortcut; `hint` says what Shift does. */
export const DRAW_TOOLS: { id: DrawTool; label: string; key: string; hint?: string }[] = [
  { id: 'brush', label: 'Brush', key: 'B' },
  { id: 'line', label: 'Straight line', key: 'L', hint: 'Hold Shift for level, upright or 45° lines' },
  { id: 'rectangle', label: 'Rectangle', key: 'R', hint: 'Hold Shift for a square' },
  { id: 'circle', label: 'Circle', key: 'C', hint: 'Hold Shift for a perfect circle' },
];

export const toolTitle = (t: { label: string; key: string; hint?: string }) =>
  `${t.label} (${t.key})${t.hint ? `. ${t.hint}` : ''}`;

/**
 * The brush keeps its pencil; the shapes are drawn in ink, as outlines, the
 * way they come out on the canvas.
 */
export function ToolIcon({ tool }: { tool: DrawTool }) {
  if (tool === 'brush') return <span aria-hidden="true">✏️</span>;
  return (
    <svg
      className="tool-svg"
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {tool === 'line' && <path d="M4 16 16 4" />}
      {tool === 'rectangle' && <rect x="3" y="5" width="14" height="10" rx="1" />}
      {tool === 'circle' && <circle cx="10" cy="10" r="7" />}
    </svg>
  );
}

interface MenuProps {
  /** The drawing tool the button shows: the one in use, or the last one used. */
  current: DrawTool;
  /** Whether a drawing tool is in use (not the eraser or the fill). */
  active: boolean;
  onPick: (tool: DrawTool) => void;
  /** Called as the pop-up opens, so the toolbar can close the palette. */
  onOpen: () => void;
}

/**
 * One toolbar button for all the drawing tools, so the phone toolbar stays a
 * single row. Back from the eraser or the fill, one tap is drawing again; on
 * the drawing tool already, a tap opens the others (the corner mark says so).
 */
export function DrawToolMenu({ current, active, onPick, onOpen }: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const popId = useId();

  // Closing with focus inside the pop-up puts it back on the button, so a
  // keyboard user is not dropped at the top of the page.
  const close = () => {
    const el = document.activeElement;
    if (el !== toggleRef.current && wrapRef.current?.contains(el)) toggleRef.current?.focus({ preventScroll: true });
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const shown = DRAW_TOOLS.find((t) => t.id === current) ?? DRAW_TOOLS[0]!;
  return (
    <div className="draw-menu" ref={wrapRef}>
      <button
        ref={toggleRef}
        className={`icon draw-toggle ${active ? 'on' : ''}`}
        onClick={() => {
          if (!active) {
            onPick(current);
            return;
          }
          if (!open) onOpen();
          setOpen(!open);
        }}
        title={active ? 'Choose a drawing tool' : toolTitle(shown)}
        aria-label={`Drawing tool: ${shown.label}`}
        aria-pressed={active}
        aria-expanded={open}
        aria-controls={popId}
      >
        <ToolIcon tool={current} />
      </button>
      <div id={popId} className={`tool-pop ${open ? 'open' : ''}`} role="group" aria-label="Drawing tools">
        {DRAW_TOOLS.map((t) => {
          const on = active && t.id === current;
          return (
            <button
              key={t.id}
              className={`icon ${on ? 'on' : ''}`}
              onClick={() => {
                onPick(t.id);
                close();
              }}
              title={toolTitle(t)}
              aria-label={t.label}
              aria-pressed={on}
            >
              <ToolIcon tool={t.id} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
