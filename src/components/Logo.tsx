const NAME = 'Drawdle';
const COLORS = ['#ffd23f', '#2bd46e', '#ff5fa2', '#8fe3ff', '#ff8a3d', '#ffffff'];
const TILTS = [-6, 4, -3, 7, -5, 3, -7, 5, -2, 6, -4, 5, -3];

/**
 * The game's mark: each letter in its own marker colour, slightly askew. A
 * space in the name becomes a real gap.
 */
export function Logo({ big = false }: { big?: boolean }) {
  let n = 0;
  return (
    <span className={`logo ${big ? 'big' : ''}`} role="img" aria-label={NAME}>
      {[...NAME].map((ch, i) => {
        if (ch === ' ') return <span key={i} className="logo-gap" aria-hidden="true" />;
        const k = n++;
        return (
          <span
            key={i}
            aria-hidden="true"
            style={{
              color: COLORS[k % COLORS.length],
              ['--tilt' as string]: `${TILTS[k % TILTS.length]}deg`,
              ['--i' as string]: k,
            }}
          >
            {ch}
          </span>
        );
      })}
    </span>
  );
}
