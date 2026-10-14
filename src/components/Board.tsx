import { memo, useEffect, useState, type ReactNode } from 'react';
import type { Stroke } from '../generated/contract';
import { PALETTE, SIZES } from '../lib/render';
import { Canvas } from './Canvas';

interface Props {
  canDraw: boolean;
  onDrawStart: (s: Stroke) => void;
  onDrawAppend: (id: string, points: number[]) => void;
  onUndo: () => void;
  onClear: () => void;
  /** Shown over the canvas: word choice, "the word was…", scores. */
  overlay?: ReactNode;
}

type Tool = 'brush' | 'eraser' | 'fill';

const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: 'brush', icon: '✏️', label: 'Brush', key: 'B' },
  { id: 'eraser', icon: '🧽', label: 'Eraser', key: 'E' },
  { id: 'fill', icon: '🪣', label: 'Fill', key: 'F' },
];

/** Memoized: it should re-render for tool changes, never for drawing traffic. */
export const Board = memo(function Board({
  canDraw, onDrawStart, onDrawAppend, onUndo, onClear, overlay,
}: Props) {
  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState(PALETTE[0]!);
  const [size, setSize] = useState(SIZES[1]!);

  useEffect(() => {
    if (!canDraw) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        onUndo();
      } else if (e.key === 'b') setTool('brush');
      else if (e.key === 'e') setTool('eraser');
      else if (e.key === 'f') setTool('fill');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canDraw, onUndo]);

  return (
    <>
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

      {canDraw && (
        <div className="tools">
          <span
            className="current-color"
            style={{ background: tool === 'eraser' ? '#ffffff' : color }}
            title={tool === 'eraser' ? 'Eraser' : `Colour ${color}`}
          />
          <div className="swatches">
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`swatch ${c === color && tool !== 'eraser' ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => {
                  setColor(c);
                  if (tool === 'eraser') setTool('brush');
                }}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>
          <div className="group">
            {SIZES.map((s, i) => (
              <button
                key={s}
                className={`sizer ${s === size ? 'on' : ''}`}
                onClick={() => setSize(s)}
                aria-label={`Brush size ${i + 1}`}
                aria-pressed={s === size}
              >
                <span style={{ width: 5 + i * 7, height: 5 + i * 7 }} />
              </button>
            ))}
          </div>
          <div className="group">
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
