import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Stroke } from '../generated/contract';
import { DEFAULT_SIZE, PALETTE, SIZES } from '../lib/render';
import { Canvas, type CanvasTool } from './Canvas';
import { DRAW_TOOLS, DrawToolMenu, ToolIcon, isDrawTool, toolTitle, type DrawTool } from './DrawTools';

interface Props {
  canDraw: boolean;
  onDrawStart: (s: Stroke) => void;
  onDrawAppend: (id: string, points: number[]) => void;
  onUndo: () => void;
  onClear: () => void;
  /** Shown over the canvas: word choice, "the word was…", scores. */
  overlay?: ReactNode;
}

type Tool = CanvasTool;

const TOOLS: { id: 'eraser' | 'fill'; icon: string; label: string; key: string }[] = [
  { id: 'eraser', icon: '🧽', label: 'Eraser', key: 'E' },
  { id: 'fill', icon: '🪣', label: 'Fill', key: 'F' },
];

/** Desktop shortcuts: a letter per tool, as each button's title says. */
const KEYS = new Map<string, Tool>([...DRAW_TOOLS, ...TOOLS].map((t) => [t.key.toLowerCase(), t.id]));

/**
 * A size's dot in the picker: the bigger the brush, the bigger the dot. On a
 * square-root scale, so the finest still shows and the boldest still fits a
 * phone's toolbar button.
 */
function dot(size: number) {
  const lo = Math.sqrt(SIZES[0]!);
  const hi = Math.sqrt(SIZES[SIZES.length - 1]!);
  const px = Math.round(4 + ((Math.sqrt(size) - lo) / (hi - lo)) * 16);
  return { width: px, height: px };
}

/** Keys typed into a field are words, not shortcuts. */
const typing = (t: EventTarget | null) =>
  t instanceof HTMLInputElement ||
  t instanceof HTMLTextAreaElement ||
  t instanceof HTMLSelectElement ||
  (t instanceof HTMLElement && t.isContentEditable);

/** Memoized: it should re-render for tool changes, never for drawing traffic. */
export const Board = memo(function Board({
  canDraw, onDrawStart, onDrawAppend, onUndo, onClear, overlay,
}: Props) {
  const [tool, setTool] = useState<Tool>('brush');
  // The drawing tool to go back to from the eraser or the fill.
  const [drawTool, setDrawTool] = useState<DrawTool>('brush');
  const [color, setColor] = useState(PALETTE[0]!);
  const [size, setSize] = useState(DEFAULT_SIZE);
  // Small screens: the palette is a pop-up behind the colour button, so the
  // toolbar is one row and the canvas keeps the height (see .tools in CSS).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!paletteOpen) return;
    const away = (e: PointerEvent) => {
      if (!toolsRef.current?.contains(e.target as Node)) setPaletteOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPaletteOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [paletteOpen]);
  // The toolbar goes when the pen does; the palette must not pop open with it
  // at the next turn.
  useEffect(() => {
    if (!canDraw) setPaletteOpen(false);
  }, [canDraw]);
  const sizeIndex = Math.max(0, SIZES.indexOf(size));

  const pick = (t: Tool) => {
    setTool(t);
    if (isDrawTool(t)) setDrawTool(t);
  };

  useEffect(() => {
    if (!canDraw) return;
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        onUndo();
        return;
      }
      // Shift is left alone: it shapes the shape being drawn.
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (e.key === '[' || e.key === ']') {
        const d = e.key === '[' ? -1 : 1;
        setSize((s) => SIZES[Math.min(SIZES.length - 1, Math.max(0, SIZES.indexOf(s) + d))]!);
        return;
      }
      const t = KEYS.get(e.key.toLowerCase());
      if (t) {
        setTool(t);
        if (isDrawTool(t)) setDrawTool(t);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canDraw, onUndo]);

  const sizeTitle = (i: number) => `Brush size ${i + 1} of ${SIZES.length} ([ smaller, ] bigger)`;

  return (
    <>
      {/* The box is the space the canvas may fill; the canvas keeps 4:3 inside it. */}
      <div className="canvas-box">
        <div className="canvas-wrap">
          <Canvas
            canDraw={canDraw}
            tool={tool}
            color={color}
            size={size}
            onStart={onDrawStart}
            onAppend={onDrawAppend}
          />
          {overlay}
        </div>
      </div>

      {canDraw && (
        <div className="tools" ref={toolsRef}>
          <button
            className="current-color"
            style={{ background: tool === 'eraser' ? '#ffffff' : color }}
            title={tool === 'eraser' ? 'Eraser' : `Colour ${color}`}
            aria-label="Choose a colour"
            aria-expanded={paletteOpen}
            onClick={() => setPaletteOpen((o) => !o)}
          />
          <div className={`swatches ${paletteOpen ? 'open' : ''}`}>
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`swatch ${c === color && tool !== 'eraser' ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => {
                  setColor(c);
                  if (tool === 'eraser') setTool(drawTool);
                  setPaletteOpen(false);
                }}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>
          {/* Small screens: one button stepping through the sizes. */}
          <button
            className="sizer size-cycle"
            onClick={() => setSize(SIZES[(sizeIndex + 1) % SIZES.length]!)}
            title={sizeTitle(sizeIndex)}
            aria-label={`Brush size ${sizeIndex + 1} of ${SIZES.length}; tap for the next`}
          >
            <span style={dot(size)} />
          </button>
          <div className="group sizes">
            {SIZES.map((s, i) => (
              <button
                key={s}
                className={`sizer ${s === size ? 'on' : ''}`}
                onClick={() => setSize(s)}
                title={sizeTitle(i)}
                aria-label={`Brush size ${i + 1}`}
                aria-pressed={s === size}
              >
                <span style={dot(s)} />
              </button>
            ))}
          </div>
          <div className="group">
            {/* Wide screens: every drawing tool in the row (see .draw-inline in CSS). */}
            {DRAW_TOOLS.map((t) => (
              <button
                key={t.id}
                className={`icon draw-inline ${tool === t.id ? 'on' : ''}`}
                onClick={() => pick(t.id)}
                title={toolTitle(t)}
                aria-label={t.label}
                aria-pressed={tool === t.id}
              >
                <ToolIcon tool={t.id} />
              </button>
            ))}
            {/* Everywhere else: one button for them all. */}
            <DrawToolMenu
              current={drawTool}
              active={isDrawTool(tool)}
              onPick={pick}
              onOpen={() => setPaletteOpen(false)}
            />
            {TOOLS.map((t) => (
              <button
                key={t.id}
                className={`icon ${tool === t.id ? 'on' : ''}`}
                onClick={() => setTool(t.id)}
                title={`${t.label} (${t.key})`}
                aria-label={t.label}
                aria-pressed={tool === t.id}
              >
                {t.icon}
              </button>
            ))}
            <button className="icon" onClick={onUndo} title="Undo (Cmd/Ctrl+Z)" aria-label="Undo">↩️</button>
            <button className="icon" onClick={onClear} title="Clear the canvas" aria-label="Clear the canvas">🗑️</button>
          </div>
        </div>
      )}
    </>
  );
});
