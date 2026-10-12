import { useEffect, useState } from 'react';
import { CONTRACT_VERSION, maskWord, normalizeWord } from './generated/contract';

interface Health {
  ok: boolean;
  contractVersion: number;
  enabledWords: number;
}

/**
 * M0/M1 shell: proves the FE builds against the vendored contract and can
 * reach the BE. Rooms arrive in M2, the canvas in M3.
 */
export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch((e: unknown) => setErr(String(e)));
  }, []);

  const sample = 'low hanging fruit';
  const revealed = new Set([0, 5, 12]);

  return (
    <div className="wrap">
      <h1>vckscribble</h1>
      <p className="sub">Corporate-slang drawing game — scaffold (M0/M1)</p>

      <div className="card">
        <div className="row">
          <span className={`dot ${health?.ok ? 'ok' : 'bad'}`} />
          <strong>Backend</strong>
          <span className="muted">
            {health
              ? `${health.enabledWords} words enabled · contract v${health.contractVersion}`
              : (err ?? 'checking…')}
          </span>
        </div>
        {health && health.contractVersion !== CONTRACT_VERSION && (
          <p className="muted">
            Contract mismatch: client v{CONTRACT_VERSION}, server v
            {health.contractVersion}. Run <code>pnpm contract:sync</code>.
          </p>
        )}
      </div>

      <div className="card">
        <span className="tag">phrase-aware masking</span>
        <p className="mono mask">{maskWord(sample, revealed)}</p>
        <p className="muted mono">
          normalizeWord("Low-Hanging Fruit!") → "{normalizeWord('Low-Hanging Fruit!')}"
        </p>
      </div>
    </div>
  );
}
