import { useEffect, useState } from 'react';
import type { Stroke } from '../generated/contract';
import { PALETTE, SIZES } from '../lib/render';
import { Canvas } from './Canvas';

interface Props {
  strokes: Stroke[];
  generation: number;
  canDraw: boolean;
  onStroke: (s: Stroke) => void;
  onUndo: () => void;
  onClear: () => void;
}

type Tool = 'brush' | 'eraser' | 'fill';

export function Board({ strokes, generation, canDraw, onStroke, onUndo, onClear }: Props) {
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
    <div className="board">
      <div className="canvas-wrap">
        <Canvas
          strokes={strokes}
          generation={generation}
          canDraw={canDraw}
          tool={tool}
          color={color}
          size={size}
          onStroke={onStroke}
        />
      </div>

      {canDraw && (
        <div className="tools">
          <div className="swatches">
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`swatch ${c === color && tool !== 'eraser' ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => {
                  setColor(c);
                  setTool('brush');
                }}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>
          <div className="row">
            {SIZES.map((s, i) => (
              <button
                key={s}
                className={`sizer ${s === size ? 'on' : ''}`}
                onClick={() => setSize(s)}
                aria-label={`Brush size ${i + 1}`}
              >
                <span style={{ width: 4 + i * 6, height: 4 + i * 6 }} />
              </button>
            ))}
            <button className={tool === 'eraser' ? 'on' : ''} onClick={() => setTool('eraser')} title="Eraser (E)">
              Eraser
            </button>
            <button className={tool === 'fill' ? 'on' : ''} onClick={() => setTool('fill')} title="Fill enclosed area (F)">
              Fill
            </button>
            <button onClick={onUndo} title="Undo (Cmd/Ctrl+Z)">Undo</button>
            <button onClick={onClear}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
