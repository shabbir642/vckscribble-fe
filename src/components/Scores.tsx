import { memo, type CSSProperties } from 'react';
import type { Player, TeamId } from '../generated/contract';
import { Avatar } from './Avatar';
import { KickButton } from './KickButton';

/** A team as the game screen shows it: the room's name and score on TEAMS' emoji and colour. */
export interface GameTeam {
  id: TeamId;
  name: string;
  /** The name without a leading "Team", for where there is room for one word ("Mango"). */
  short: string;
  emoji: string;
  colour: string;
  score: number;
}

/** The shared .team-chip's fill. A team's colour is never text: as text it fails contrast. */
const teamFill = (team: GameTeam) => ({ '--team': team.colour }) as CSSProperties;

/** A team's emoji and name on its colour, wherever a team is named. */
export function TeamChip({ team }: { team: GameTeam }) {
  return (
    <span className="team-chip" style={teamFill(team)}>
      <span className="team-emoji" aria-hidden="true">{team.emoji}</span>
      <span className="game-team-label">{team.name}</span>
    </span>
  );
}

/**
 * The teams' scores, in the game's team order so no chip ever jumps: the team
 * drawing now raised with a pencil, yours ringed and tagged. The stylesheet
 * places it: above the players on a wide screen, one line under the word strip
 * on a phone, where the players panel is too narrow for it.
 */
export const TeamBar = memo(function TeamBar({
  teams, upTeamId, myTeamId,
}: {
  teams: GameTeam[];
  /** The team whose turn it is, from the word choice to the reveal. */
  upTeamId: TeamId | null;
  myTeamId: TeamId | null;
}) {
  return (
    <ol className="game-team-bar" aria-label="Team scores">
      {teams.map((t) => {
        const up = t.id === upTeamId;
        const mine = t.id === myTeamId;
        const cls = ['game-team-item', up && 'game-team-up', mine && 'game-team-mine'].filter(Boolean).join(' ');
        return (
          <li key={t.id} className={cls}>
            <span className="team-chip game-team-chip" style={teamFill(t)} title={t.name}>
              <span className="team-emoji" aria-hidden="true">{t.emoji}</span>
              {/* One word on screen, dropped from a chip too narrow for it (a
                  phone with four teams); the whole name for a screen reader. */}
              <span className="game-team-name" aria-hidden="true">{t.short}</span>
              <span className="game-team-sr">{t.name}, </span>
              {/* Keyed by the score, so a new score pops in. */}
              <span key={t.score} className="game-team-score">
                {t.score}
                <span className="game-team-sr"> points</span>
              </span>
            </span>
            {/* Tags on the chip's corners, clear of the score however narrow it gets. */}
            {mine && <span className="game-team-you" aria-hidden="true">You</span>}
            {up && <span className="game-team-pen" aria-hidden="true">✏️</span>}
            {(mine || up) && (
              <span className="game-team-sr">
                {mine && ', your team'}
                {up && ', drawing now'}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
});

/**
 * The left-hand scoreboard: rank, avatar, name, points, and who is drawing. In
 * a team game, everyone under their team instead, and no points: the game is
 * scored by team (the team bar), and a row of zeros under a winning team only
 * said "you did nothing".
 */
export const Scores = memo(function Scores({
  players, drawerId, guessed, youId, isHost, onKick, teams = null,
}: {
  players: Player[];
  drawerId: string | null;
  guessed: string[];
  youId: string;
  isHost: boolean;
  onKick: (playerId: string) => void;
  /** A team game's teams, in order; null when everyone plays for themselves. */
  teams?: GameTeam[] | null;
}) {
  const present = players.filter((p) => p.connected).length;

  /** A player's row; `grouped` under a team, without the rank and the points. */
  const row = (p: Player, i: number, grouped: boolean, teamName?: string) => {
    const cls = [
      'player-row',
      grouped && 'game-team-row',
      p.id === youId && 'me',
      p.id === drawerId && 'drawing',
      guessed.includes(p.id) && 'guessed',
      !p.connected && 'away',
    ].filter(Boolean).join(' ');
    return (
      // Focusable so a tap on a phone (no hover) reveals the kick button.
      <div key={p.id} className={cls} tabIndex={p.id === youId ? undefined : 0}>
        {!grouped && <span className="rank">#{i + 1}</span>}
        <Avatar i={p.avatar} size={36} />
        <span className="who">
          <span className="pname">{p.name}</span>
          {grouped ? (
            !p.connected && <span className="pts">Away</span>
          ) : (
            <span className="pts">
              {p.connected ? `${p.score} points` : `${p.score} points (away)`}
            </span>
          )}
        </span>
        <span className="badge" aria-label={p.id === drawerId ? 'drawing' : guessed.includes(p.id) ? 'guessed it' : undefined}>
          {p.id === drawerId ? '✏️' : guessed.includes(p.id) ? '✅' : p.isHost ? '👑' : ''}
        </span>
        <span className={`kick-slot ${p.kickVotes.length ? 'live' : ''}`}>
          <KickButton
            player={p}
            youId={youId}
            isHost={isHost}
            present={present}
            onKick={onKick}
            compact
            teamName={teamName}
            teamVoted={p.kickVotes.some((id) => players.find((q) => q.id === id)?.teamId === p.teamId)}
          />
        </span>
      </div>
    );
  };

  if (!teams) {
    const ranked = [...players].sort((a, b) => b.score - a.score);
    return <div className="card players-panel">{ranked.map((p, i) => row(p, i, false))}</div>;
  }

  // Each team in join order: nobody climbs or drops mid-game.
  const ids = new Set<TeamId>(teams.map((t) => t.id));
  const loose = players.filter((p) => {
    const t = p.teamId ?? null;
    return t === null || !ids.has(t);
  });
  return (
    <div className="card players-panel">
      {teams.map((t) => {
        const members = players.filter((p) => (p.teamId ?? null) === t.id);
        return (
          <div key={t.id} className="game-team-group" style={teamFill(t)} role="group" aria-label={t.name}>
            <div className="game-team-head">
              <TeamChip team={t} />
            </div>
            {members.length > 0 ? (
              members.map((p, i) => row(p, i, true, t.name))
            ) : (
              // Whoever joins next lands here: it is the smallest team.
              <p className="game-team-empty">Nobody here right now</p>
            )}
          </div>
        );
      })}
      {/* The server deals everyone onto a team, but nobody may go missing from the list. */}
      {loose.length > 0 && (
        <div className="game-team-group" role="group" aria-label="Not on a team">
          <div className="game-team-head game-team-none">Not on a team</div>
          {loose.map((p, i) => row(p, i, true))}
        </div>
      )}
    </div>
  );
});
