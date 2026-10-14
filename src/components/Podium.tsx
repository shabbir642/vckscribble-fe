import type { Player } from '../generated/contract';
import { Avatar } from './Avatar';

interface Ranked {
  player: Player;
  /** Competition ranking: two players tied for first are both 1st, next is 3rd. */
  rank: number;
}

export function rankPlayers(players: Player[]): Ranked[] {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return sorted.map((player) => ({
    player,
    rank: sorted.findIndex((p) => p.score === player.score) + 1,
  }));
}

const MEDAL = ['🥇', '🥈', '🥉'];
const ORDINAL = ['1st', '2nd', '3rd'];

/**
 * The end of a game: the top three on a podium — first in the middle and
 * tallest, second on the left, third on the right — and everyone else ranked
 * below. Ties share a step and a medal.
 */
export function Podium({ players, youId }: { players: Player[]; youId: string }) {
  const ranked = rankPlayers(players);
  const top = ranked.slice(0, 3);
  const rest = ranked.slice(3);
  // Visual order: 2nd, 1st, 3rd.
  const steps = [top[1], top[0], top[2]].filter((x): x is Ranked => Boolean(x));

  return (
    <div className="podium">
      <div className="steps">
        {steps.map(({ player, rank }) => (
          <div
            key={player.id}
            className={`step place-${Math.min(rank, 3)} ${player.id === youId ? 'me' : ''}`}
          >
            <div className="who">
              {rank === 1 && <span className="crown-bob" aria-hidden="true">👑</span>}
              <Avatar i={player.avatar} size={rank === 1 ? 64 : 52} />
              <span className="pname">{player.name}</span>
              <span className="pts">{player.score} points</span>
            </div>
            <div className="block">
              <span className="medal" aria-hidden="true">{MEDAL[rank - 1] ?? ''}</span>
              <span className="place">{ORDINAL[rank - 1] ?? `${rank}th`}</span>
            </div>
          </div>
        ))}
      </div>

      {rest.length > 0 && (
        <ol className="ranks">
          {rest.map(({ player, rank }) => (
            <li key={player.id} className={player.id === youId ? 'me' : ''}>
              <span className="rank">#{rank}</span>
              <Avatar i={player.avatar} size={28} />
              <span className="pname">{player.name}</span>
              <span className="gain">{player.score}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
