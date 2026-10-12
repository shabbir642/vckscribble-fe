import { useMemo } from 'react';

const COLORS = ['#e8c15a', '#2f7d52', '#3f6fa8', '#b05a8e', '#e07a3f'];

/**
 * Pure CSS confetti: a handful of absolutely-positioned chips that fall once
 * and stop. Rendered only on the final scoreboard, so there is nothing to tear
 * down — the component unmounts with the podium.
 */
export function Confetti() {
  const chips = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        left: `${(i * 2.8 + (i % 5) * 3) % 100}%`,
        background: COLORS[i % COLORS.length]!,
        animationDelay: `${(i % 9) * 0.14}s`,
        transform: `rotate(${(i * 37) % 360}deg)`,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {chips.map((style, i) => (
        <i key={i} style={style} />
      ))}
    </div>
  );
}
