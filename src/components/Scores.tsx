import { memo } from 'react';
import type { Player } from '../generated/contract';
import { Avatar } from './Avatar';

/** The left-hand scoreboard: rank, avatar, name, points, and who is drawing. */
export const Scores = memo(function Scores({
  players, drawerId, guessed, youId,
}: {
  players: Player[];
  drawerId: string | null;
  guessed: string[];
  youId: string;
}) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  return (
    <div className="card players-panel">
      {ranked.map((p, i) => {
        const cls = [
          'player-row',
          p.id === youId && 'me',
          p.id === drawerId && 'drawing',
          guessed.includes(p.id) && 'guessed',
          !p.connected && 'away',
        ].filter(Boolean).join(' ');
        return (
          <div key={p.id} className={cls}>
            <span className="rank">#{i + 1}</span>
            <Avatar i={p.avatar} size={36} />
            <span className="who">
              <span className="pname">{p.name}</span>
              <span className="pts">
                {p.connected ? `${p.score} points` : `${p.score} points (away)`}
              </span>
            </span>
            <span className="badge" aria-label={p.id === drawerId ? 'drawing' : guessed.includes(p.id) ? 'guessed it' : undefined}>
              {p.id === drawerId ? '✏️' : guessed.includes(p.id) ? '✅' : p.isHost ? '👑' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
});
