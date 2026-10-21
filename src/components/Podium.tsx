import type { CSSProperties } from 'react';
import { ordinal } from '../lib/results';
import { Avatar } from './Avatar';

/** A player's place at the end of a game, from the server's summary or worked out here. */
export interface Standing {
  id: string;
  name: string;
  avatar: number;
  score: number;
  /** Competition ranking: two players tied for first are both 1st, next is 3rd. */
  rank: number;
  /** No longer in the room. */
  left?: boolean;
}

const MEDAL = ['🥇', '🥈', '🥉'];

export const points = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;

/**
 * Who stands on the podium: the best three of those who scored. A block says
 * "1st", and nobody comes first with no points (a game nobody scored in has
 * no podium at all). `standings` is best first.
 */
export function onPodium(standings: Standing[]): Standing[] {
  return standings.filter((s) => s.score > 0).slice(0, 3);
}

/**
 * The end of a game: the top three on a podium, first in the middle and
 * tallest, second on the left, third on the right. Ties share a step and a
 * medal. In the page they come best first, as a screen reader should hear
 * them; CSS `order` puts them on their steps. The blocks rise third to first
 * (.finale .step).
 */
export function Podium({ standings, youId }: { standings: Standing[]; youId: string }) {
  const top = onPodium(standings);
  if (!top.length) return null;
  return (
    <div className="podium">
      <ol className="steps" aria-label="Podium">
        {top.map((s, i) => {
          const cls = [
            'step',
            `place-${Math.min(s.rank, 3)}`,
            s.id === youId && 'me',
            s.left && 'left',
          ].filter(Boolean).join(' ');
          // Visual order 2nd, 1st, 3rd.
          const order: CSSProperties = { order: [2, 1, 3][i] };
          return (
            <li key={s.id} className={cls} style={order}>
              <div className="who">
                {s.rank === 1 && <span className="crown-bob" aria-hidden="true">👑</span>}
                <Avatar i={s.avatar} size={s.rank === 1 ? 64 : 52} />
                <span className="pname">{s.name}</span>
                <span className="pts">
                  {points(s.score)}
                  {s.left ? ' · left' : ''}
                </span>
              </div>
              <div className="block">
                <span className="medal" aria-hidden="true">{MEDAL[s.rank - 1] ?? ''}</span>
                <span className="place">{ordinal(s.rank)}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
