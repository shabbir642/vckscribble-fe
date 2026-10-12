import type { Player } from '../generated/contract';
import { Avatar } from './Avatar';

export function Scores({
  players, drawerId, guessed, youId,
}: {
  players: Player[];
  drawerId: string | null;
  guessed: string[];
  youId: string;
}) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  return (
    <div className="card">
      <h3>Scores</h3>
      <ul className="players">
        {ranked.map((p) => (
          <li key={p.id} className={p.connected ? '' : 'away'}>
            <Avatar i={p.avatar} size={22} />
            <span className="pname">{p.name}</span>
            {p.id === youId && <span className="tag">you</span>}
            {p.id === drawerId && <span className="tag">drawing</span>}
            {guessed.includes(p.id) && <span className="tag ok-tag">got it</span>}
            <span className="score">{p.score}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
