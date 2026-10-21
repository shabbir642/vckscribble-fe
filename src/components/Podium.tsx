import type { CSSProperties } from 'react';
import type { TeamId } from '../generated/contract';
import { ordinal, teamLook } from '../lib/results';
import { AVATARS, Avatar, BACKDROPS, avatarSlot } from './Avatar';

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

/** A team at the end of a team game, with who played for it. */
export interface TeamStanding {
  id: TeamId;
  name: string;
  score: number;
  /** Competition ranking, as for players. */
  rank: number;
  /** Who played for it, best first, and you first of all on your own team. */
  members: Standing[];
  /** Your team. */
  mine: boolean;
}

/** Faces on a team's step: a few, then how many more. */
const FACES = 3;

/**
 * A team game's podium: the best three teams (both, in a two-team game),
 * second on the left, first in the middle and tallest, crowned. Each step is
 * in its team's colour, with a few of its players standing on it. Only a team
 * that scored gets a medal, and nobody is crowned in a game nobody scored in:
 * then there is no podium at all (the teams are listed below it).
 */
export function TeamPodium({ teams }: { teams: TeamStanding[] }) {
  if (!teams.some((t) => t.score > 0)) return null;
  // Stable, so the server's order settles equal ranks.
  const top = [...teams].sort((a, b) => a.rank - b.rank).slice(0, 3);
  return (
    <div className="podium">
      <ol className="steps" aria-label="Podium">
        {top.map((t, i) => {
          const look = teamLook(t.id);
          const scored = t.score > 0;
          const shown = t.members.slice(0, FACES);
          const more = t.members.length - shown.length;
          // Visual order 2nd, 1st, 3rd; the colour fills the step, never the writing.
          const style = { order: [2, 1, 3][i], '--team': look.colour } as CSSProperties;
          return (
            <li key={t.id} className={`step place-${Math.min(t.rank, 3)} results-team-step`} style={style}>
              <div className="who">
                {t.rank === 1 && scored && <span className="crown-bob" aria-hidden="true">👑</span>}
                {t.members.length > 0 && (
                  <span className="results-team-faces" aria-hidden="true">
                    {shown.map((m) => {
                      const k = avatarSlot(m.avatar);
                      return (
                        <span key={m.id} className="results-team-face" style={{ background: BACKDROPS[k] }}>
                          {AVATARS[k]}
                        </span>
                      );
                    })}
                    {more > 0 && <span className="results-team-more">+{more}</span>}
                  </span>
                )}
                <span className="results-team-name">
                  <span aria-hidden="true">{look.emoji}</span> {t.name}
                </span>
                <span className="visually-hidden">
                  {t.members.length} {t.members.length === 1 ? 'player' : 'players'}
                </span>
                <span className="pts">{points(t.score)}</span>
                {t.mine && <span className="results-team-you">Your team</span>}
              </div>
              <div className="block">
                {scored && <span className="medal" aria-hidden="true">{MEDAL[t.rank - 1] ?? ''}</span>}
                <span className="place">{ordinal(t.rank)}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
