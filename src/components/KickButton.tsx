import { useEffect, useState } from 'react';
import {
  MIN_PLAYERS_FOR_KICK_VOTE,
  kickVotesNeeded,
  type Player,
} from '../generated/contract';

/**
 * The host kicks outright (one tap to arm, a second to confirm); everyone
 * else votes, and a majority of the players present removes the player.
 * Tapping again withdraws your vote.
 */
export function KickButton({
  player, youId, isHost, present, onKick, compact = false,
}: {
  player: Player;
  youId: string;
  isHost: boolean;
  /** Players currently connected, which sets the votes needed. */
  present: number;
  onKick: (playerId: string) => void;
  /** Icon-only, for the in-game scoreboard rows. */
  compact?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  if (player.id === youId) return null;
  const votes = player.kickVotes.length;
  const needed = kickVotesNeeded(present);
  const tally = votes > 0 ? ` ${votes}/${needed}` : '';

  if (isHost) {
    return (
      <button
        type="button"
        className={`small kick ${armed ? 'armed' : ''} ${compact ? 'compact' : ''}`}
        onClick={() => {
          if (!armed) return setArmed(true);
          setArmed(false);
          onKick(player.id);
        }}
        title={armed ? `Tap again to kick ${player.name}` : `Kick ${player.name}`}
        aria-label={armed ? `Confirm kicking ${player.name}` : `Kick ${player.name}`}
      >
        {armed ? 'Kick?' : compact ? `🥾${tally}` : `🥾 Kick${tally}`}
      </button>
    );
  }

  const voted = player.kickVotes.includes(youId);
  const canVote = present >= MIN_PLAYERS_FOR_KICK_VOTE;
  return (
    <button
      type="button"
      className={`small kick ${voted ? 'voted' : ''} ${compact ? 'compact' : ''}`}
      disabled={!canVote && !voted}
      aria-pressed={voted}
      onClick={() => onKick(player.id)}
      title={
        !canVote ? `Vote kicks need ${MIN_PLAYERS_FOR_KICK_VOTE} players`
        : voted ? 'Tap to take back your vote'
        : `Vote to kick ${player.name} (${needed} votes needed)`
      }
      aria-label={voted ? `Take back vote to kick ${player.name}` : `Vote to kick ${player.name}`}
    >
      {compact ? `🥾${tally}` : `🥾 ${voted ? 'Voted' : 'Vote kick'}${tally}`}
    </button>
  );
}
