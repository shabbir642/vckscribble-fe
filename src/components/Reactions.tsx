import type { Reaction } from '../generated/contract';

interface Props {
  likes: number;
  dislikes: number;
  /** Reactions just made: each floats up over the canvas once. */
  feed: { id: number; reaction: Reaction; name: string }[];
  /** Null for the drawer, who can't rate their own drawing. */
  mine: Reaction | null;
  canReact: boolean;
  onReact: (r: Reaction) => void;
}

const EMOJI: Record<Reaction, string> = { up: '👍', down: '👎' };

/**
 * Laid over the canvas while someone draws: the vote buttons for guessers,
 * the running tally for everyone, and each new vote floating up from the
 * corner. The layer itself lets every pointer event through to the canvas,
 * so it can never get in the drawer's way.
 */
export function Reactions({ likes, dislikes, feed, mine, canReact, onReact }: Props) {
  return (
    <div className="reactions" aria-live="polite">
      {feed.map((f, i) => (
        <span
          key={f.id}
          className={`float ${f.reaction}`}
          style={{ ['--x' as string]: `${(f.id * 37) % 60}px`, ['--d' as string]: `${i % 3}` }}
          aria-label={`${f.name} ${f.reaction === 'up' ? 'liked' : 'disliked'} the drawing`}
        >
          {EMOJI[f.reaction]}
          <small>{f.name}</small>
        </span>
      ))}

      <div className="react-bar">
        {canReact ? (
          (['up', 'down'] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={`react ${mine === r ? 'on' : ''}`}
              onClick={() => onReact(r)}
              aria-pressed={mine === r}
              aria-label={r === 'up' ? 'Like this drawing' : 'Dislike this drawing'}
              title={r === 'up' ? 'Like this drawing' : 'Dislike this drawing'}
            >
              {EMOJI[r]} <span>{r === 'up' ? likes : dislikes}</span>
            </button>
          ))
        ) : (
          <span className="tally" title="What the others think so far">
            👍 {likes} &nbsp; 👎 {dislikes}
          </span>
        )}
      </div>
    </div>
  );
}
