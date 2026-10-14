import { memo } from 'react';
import type { Player } from '../generated/contract';
import { Avatar } from './Avatar';
import { KickButton } from './KickButton';

/** The left-hand scoreboard: rank, avatar, name, points, and who is drawing. */
export const Scores = memo(function Scores({
  players, drawerId, guessed, youId, isHost, onKick,
}: {
  players: Player[];
  drawerId: string | null;
  guessed: string[];
  youId: string;
  isHost: boolean;
  onKick: (playerId: string) => void;
}) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  const present = players.filter((p) => p.connected).length;
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
          // Focusable so a tap on a phone (no hover) reveals the kick button.
          <div key={p.id} className={cls} tabIndex={p.id === youId ? undefined : 0}>
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
            <span className={`kick-slot ${p.kickVotes.length ? 'live' : ''}`}>
              <KickButton player={p} youId={youId} isHost={isHost} present={present} onKick={onKick} compact />
            </span>
          </div>
        );
      })}
    </div>
  );
});
