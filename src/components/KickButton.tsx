import { useEffect, useState } from 'react';
import {
  MIN_PLAYERS_FOR_KICK_VOTE,
  TEAMS,
  kickVotesNeeded,
  type Player,
} from '../generated/contract';

/**
 * The host kicks outright (one tap to arm, a second to confirm); everyone
 * else votes, and a majority of the players present removes the player.
 * Tapping again withdraws your vote. The host can't be kicked, so their row
 * has no button. In a team game a vote also needs one from the player's own
 * team, so one team can't throw out a rival on its own.
 */
export function KickButton({
  player, youId, isHost, present, onKick, compact = false,
  teamVote = (player.teamId ?? null) !== null, teamName, teamVoted,
}: {
  player: Player;
  youId: string;
  isHost: boolean;
  /** Players currently connected, which sets the votes needed. */
  present: number;
  onKick: (playerId: string) => void;
  /** Icon-only, for the in-game scoreboard rows. */
  compact?: boolean;
  /**
   * Votes need one from the player's own team. Read off the player where the
   * caller doesn't say: only a team game puts anyone on a team.
   */
  teamVote?: boolean;
  /** The player's team, to say whose vote is needed. */
  teamName?: string;
  /**
   * Whether anyone on the player's team has voted (the callers know the
   * teams). Without one a majority does nothing, which the button then says:
   * the reason is otherwise only in the chat and a tooltip a phone never shows.
   */
  teamVoted?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  if (player.id === youId || player.isHost) return null;
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
  const team = teamName ?? 'their team';
  const fromTeam = teamVote ? `, at least one from ${team}` : '';
  // The votes are in, but none from their own team: "🥾 3/3 + 🥭 vote".
  const waiting = teamVote && teamVoted === false && votes >= needed;
  const emoji = TEAMS.find((t) => t.id === player.teamId)?.emoji;
  const action = voted ? `Take back vote to kick ${player.name}` : `Vote to kick ${player.name}`;
  return (
    <button
      type="button"
      className={`small kick ${voted ? 'voted' : ''} ${compact ? 'compact' : ''}${waiting ? ' lobby-team-wait' : ''}`}
      disabled={!canVote && !voted}
      aria-pressed={voted}
      onClick={() => onKick(player.id)}
      title={
        !canVote ? `Vote kicks need ${MIN_PLAYERS_FOR_KICK_VOTE} players`
        : waiting ? `It needs a vote from ${team} too${voted ? '. Tap to take back yours' : ''}`
        : voted ? 'Tap to take back your vote'
        : `Vote to kick ${player.name} (${needed} votes needed${fromTeam})`
      }
      aria-label={waiting ? `${action}: ${votes} of ${needed} votes, but it needs a vote from ${team} too` : action}
    >
      {compact ? `🥾${tally}` : `🥾 ${voted ? 'Voted' : 'Vote kick'}${tally}`}
      {/* Its own piece, so a narrow chip folds the label here rather than spill. */}
      {waiting && (
        <>
          {' '}
          <span className="lobby-team-need">+ {emoji ?? '👥'} vote</span>
        </>
      )}
    </button>
  );
}
