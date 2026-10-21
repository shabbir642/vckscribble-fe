import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import {
  MAX_TEAMS,
  MIN_TEAMS,
  MIN_TEAM_SIZE,
  TEAMS,
  TEAM_NAME_MAX,
  type Player,
  type Result,
  type RoomSettings,
  type Team,
  type TeamId,
} from '../generated/contract';
import { Avatar } from './Avatar';
import { KickButton } from './KickButton';
import { teamsFor, teamsOnPatch } from './RoomSettingsPanel';

type Patch = Partial<Omit<RoomSettings, 'customWordCount'>>;

/* ------------------------------------------------------------------ logic */

/** One of the game's teams, as the lobby shows it. */
export interface TeamView {
  id: TeamId;
  /** Its name now: the default, or a rename. */
  name: string;
  /** What an empty rename brings back. */
  defaultName: string;
  emoji: string;
  colour: string;
  /** Everyone on it, here or away, in the room's order. */
  members: Player[];
  /** Members here now: only they count towards a team that can play. */
  here: number;
}

/** The game's teams (the first teamCount of TEAMS), and who is on each. */
export function teamViews(players: Player[], settings: RoomSettings, teams: Team[]): TeamView[] {
  const count = Math.min(MAX_TEAMS, Math.max(MIN_TEAMS, settings.teamCount ?? MIN_TEAMS));
  return TEAMS.slice(0, count).map((t) => {
    const members = players.filter((p) => (p.teamId ?? null) === t.id);
    return {
      id: t.id,
      name: teams.find((x) => x.id === t.id)?.name ?? t.name,
      defaultName: t.name,
      emoji: t.emoji,
      colour: t.colour,
      members,
      here: members.filter((p) => p.connected).length,
    };
  });
}

/** A team short of players, and how many more it needs. */
export interface ShortTeam {
  team: TeamView;
  need: number;
}

/**
 * Whether a team game can start. Every team needs MIN_TEAM_SIZE players here
 * (someone to draw, someone to guess), which the server checks too. Uneven
 * teams may start, but they are worth a word: more guessers win more turns.
 */
export type Readiness =
  | { ready: true; sizes: number[]; uneven: boolean }
  | { ready: false; short: ShortTeam[] };

export function readiness(views: TeamView[]): Readiness {
  const short = views
    .filter((v) => v.here < MIN_TEAM_SIZE)
    .map((team) => ({ team, need: MIN_TEAM_SIZE - team.here }));
  if (short.length) return { ready: false, short };
  const sizes = views.map((v) => v.here);
  return { ready: true, sizes, uneven: Math.max(...sizes) - Math.min(...sizes) > 1 };
}

/** The most teams this many players can fill; fewer than MIN_TEAMS means none. */
export function teamsThatFit(present: number): number {
  return Math.min(MAX_TEAMS, Math.floor(present / MIN_TEAM_SIZE));
}

/** "Mango" for "Team Mango"; a team renamed to anything else keeps its whole name. */
export function shortName(name: string): string {
  return name.replace(/^team\s+/i, '') || name;
}

const morePlayers = (n: number) => `${n} more player${n === 1 ? '' : 's'}`;
/** "8", or "7 or 8": how big teams as even as they go come out. */
const ofSize = (lo: number, hi: number) => (lo === hi ? `${hi}` : `${lo} or ${hi}`);

/** "Ready: 2 teams of 8", "Ready, but uneven: Mango 9, Grape 6", "Team Kiwi needs 1 more player". */
export function readinessLine(views: TeamView[], r: Readiness): string {
  if (!r.ready) {
    const parts = r.short.map((s) => `${s.team.name} needs ${morePlayers(s.need)}`);
    const last = parts.pop() ?? '';
    return parts.length ? `${parts.join(', ')} and ${last}` : last;
  }
  if (r.uneven) return `Ready, but uneven: ${views.map((v) => `${shortName(v.name)} ${v.here}`).join(', ')}`;
  return `Ready: ${views.length} teams of ${ofSize(Math.min(...r.sizes), Math.max(...r.sizes))}`;
}

/** "With 30 players, 4 teams of 7 or 8 play best". */
export function moreTeamsLine(present: number, teams: number): string {
  const size = ofSize(Math.floor(present / teams), Math.ceil(present / teams));
  return `With ${present} players, ${teams} teams of ${size} play best`;
}

/** What the host's Start button says while a team is short. */
export function notReadyLabel(short: ShortTeam[]): string {
  const [only] = short;
  return short.length === 1 && only ? `${only.team.name} needs ${morePlayers(only.need)}` : `${short.length} teams need more players`;
}

/** "9 v 6", in team order. */
export const versus = (sizes: number[]) => sizes.join(' v ');

/* ------------------------------------------------------------ mode switch */

const TEAM_COUNTS = Array.from({ length: MAX_TEAMS - MIN_TEAMS + 1 }, (_, i) => MIN_TEAMS + i);

/**
 * How the room plays, at the top of the players card: everyone for
 * themselves or in teams, then how many teams. The host picks; everyone else
 * sees what was picked.
 */
export function ModeSwitch({
  settings: s, isHost, busy, onSettings,
}: {
  settings: RoomSettings;
  isHost: boolean;
  busy: boolean;
  onSettings: (patch: Patch) => void;
}) {
  const locked = !isHost || busy;
  const teams = s.mode === 'teams';
  return (
    <div className="lobby-team-mode">
      <div className="segmented" role="radiogroup" aria-label="How to play">
        <button
          type="button"
          role="radio"
          aria-checked={!teams}
          className={teams ? '' : 'on'}
          disabled={locked}
          onClick={() => teams && onSettings({ mode: 'classic' })}
        >
          Everyone for themselves
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={teams}
          className={teams ? 'on' : ''}
          disabled={locked}
          onClick={() => !teams && onSettings(teamsOnPatch())}
        >
          Teams
        </button>
      </div>
      {teams && (
        <div className="segmented" role="radiogroup" aria-label="Number of teams">
          {TEAM_COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={s.teamCount === n}
              className={s.teamCount === n ? 'on' : ''}
              disabled={locked}
              onClick={() => s.teamCount !== n && onSettings({ teamCount: n })}
            >
              {n} teams
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- readiness */

/**
 * Whether the teams can start, for everyone, with the quickest fix to hand:
 * the host can cut the number of teams or shuffle; anyone on a team that can
 * spare them can move to a short one. The host also hears when more teams
 * would play better.
 */
export function TeamStatus({
  views, status, youId, isHost, busy, present, onJoin, onSettings, onShuffle,
}: {
  views: TeamView[];
  status: Readiness;
  youId: string;
  isHost: boolean;
  busy: boolean;
  /** Players here now. */
  present: number;
  onJoin: (teamId: TeamId) => void;
  onSettings: (patch: Patch) => void;
  onShuffle: () => void;
}) {
  const tone = !status.ready ? 'short' : status.uneven ? 'uneven' : 'ready';
  // Fewer teams, when there aren't the players for this many.
  const fit = teamsThatFit(present);
  const fewer = isHost && !status.ready && fit >= MIN_TEAMS && fit < views.length ? fit : null;
  // A short team you could fill without leaving your own team short.
  const mine = views.find((v) => v.members.some((p) => p.id === youId));
  const join =
    !isHost && !status.ready && (!mine || mine.here - 1 >= MIN_TEAM_SIZE)
      ? (status.short.find((s) => s.team.id !== mine?.id)?.team ?? null)
      : null;
  // More teams, when the room has outgrown these (a host who turned Teams on
  // before everyone came): teams of 15 leave most of a team watching the
  // fastest typist.
  const best = teamsFor(present);
  const more = isHost && best > views.length ? best : null;
  return (
    <div className={`lobby-team-status ${tone}`}>
      <p className="lobby-team-line" role="status">
        <span aria-hidden="true">{tone === 'short' ? '⏳' : tone === 'uneven' ? '⚖️' : '✅'}</span>{' '}
        {readinessLine(views, status)}
      </p>
      {(fewer !== null || join || isHost) && (
        <div className="lobby-team-fixes">
          {fewer !== null && (
            <button className="small" disabled={busy} onClick={() => onSettings({ teamCount: fewer })}>
              Use {fewer} teams
            </button>
          )}
          {join && (
            <button className="small primary" disabled={busy} onClick={() => onJoin(join.id)}>
              Join {join.name}
            </button>
          )}
          {isHost && (
            <button className="small" disabled={busy || present < 2} onClick={onShuffle}>
              Shuffle teams
            </button>
          )}
        </div>
      )}
      {more !== null && (
        <div className="lobby-team-tip">
          <p>
            <span aria-hidden="true">💡</span> {moreTeamsLine(present, more)}
          </p>
          <button className="small" disabled={busy} onClick={() => onSettings({ teamCount: more })}>
            Use {more} teams
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

interface CardProps {
  youId: string;
  isHost: boolean;
  busy: boolean;
  /** Players here now, which sets the votes a kick needs. */
  present: number;
  /** A big room: one-line chips. */
  compact: boolean;
  onJoin: (teamId: TeamId) => void;
  onRename: (teamId: TeamId, name: string) => Promise<Result>;
  onKick: (playerId: string) => void;
}

/**
 * The team cards, in place of the player grid in a team game: each team's
 * colour, emoji and name (renamed in place by the host or its members), who
 * is on it, and a one-tap Join on the others.
 */
export function TeamCards({ views, ...rest }: CardProps & { views: TeamView[] }) {
  return (
    // At most two across (four teams make two rows of two), three for three
    // teams; fewer where the cards would get too narrow for their names.
    <div className="lobby-team-cards" style={{ '--cols': views.length === 3 ? 3 : 2 } as CSSProperties}>
      {views.map((v) => (
        <TeamCard key={v.id} view={v} {...rest} />
      ))}
    </div>
  );
}

function TeamCard({
  view: v, youId, isHost, busy, present, compact, onJoin, onRename, onKick,
}: CardProps & { view: TeamView }) {
  const headingId = useId();
  const mine = v.members.some((p) => p.id === youId);
  const away = v.members.length - v.here;
  const canRename = isHost || mine;
  /** The name being typed, while renaming. */
  const [draft, setDraft] = useState<string | null>(null);
  const renaming = draft !== null;
  const nameInput = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  /** Set as the box closes: focus goes back to ✏️ rather than the page. */
  const refocus = useRef(false);

  useEffect(() => {
    if (renaming) {
      // The old name, selected: type over it, or tweak it.
      nameInput.current?.select();
      return;
    }
    if (!refocus.current) return;
    refocus.current = false;
    editButton.current?.focus();
  }, [renaming]);

  // Moved to another team mid-rename (a shuffle): the name isn't yours to change now.
  useEffect(() => {
    if (!canRename) setDraft(null);
  }, [canRename]);

  const close = () => {
    refocus.current = true;
    setDraft(null);
  };
  const save = async () => {
    if (draft === null) return;
    const name = draft.trim();
    // Empty brings back the default: nothing to send if that is the name already.
    if ((name || v.defaultName) === v.name) return close();
    const r = await onRename(v.id, name);
    if (r.ok) close();
  };

  return (
    <section
      className={`lobby-team-card ${mine ? 'mine' : ''}`}
      style={{ '--team': v.colour } as CSSProperties}
      aria-labelledby={headingId}
    >
      <div className={`lobby-team-head ${renaming ? 'renaming' : ''}`}>
        <span className="lobby-team-emoji" aria-hidden="true">{v.emoji}</span>
        <div className="lobby-team-title">
          <h4 id={headingId} className={`lobby-team-name ${renaming ? 'lobby-team-sr' : ''}`}>{v.name}</h4>
          {renaming ? (
            <form
              className="lobby-team-rename"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
              // From the box or from either button.
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  close();
                }
              }}
            >
              <input
                ref={nameInput}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={TEAM_NAME_MAX}
                placeholder={v.defaultName}
                aria-label={`New name for ${v.name}`}
                enterKeyHint="done"
                autoFocus
              />
              {/* Together, so on a narrow card they drop below the box as a pair. */}
              <span className="lobby-team-rename-actions">
                <button type="submit" className="small" disabled={busy}>Save</button>
                <button type="button" className="small" onClick={close}>Cancel</button>
              </span>
            </form>
          ) : (
            canRename && (
              <button
                ref={editButton}
                type="button"
                className="lobby-team-edit"
                onClick={() => setDraft(v.name)}
                aria-label={`Rename ${v.name}`}
                title={`Rename ${v.name}`}
              >
                ✏️
              </button>
            )
          )}
        </div>
        <span className="lobby-team-count">
          {v.here} player{v.here === 1 ? '' : 's'}
          {away > 0 && `, ${away} away`}
        </span>
        {!renaming && (
          <span className="lobby-team-action">
            {mine ? (
              <span className="lobby-team-yours">Your team</span>
            ) : (
              <button className="small" disabled={busy} onClick={() => onJoin(v.id)} aria-label={`Join ${v.name}`}>
                Join
              </button>
            )}
          </span>
        )}
      </div>
      {v.members.length ? (
        <ul className={`lobby-team-members ${compact ? 'compact' : ''}`}>
          {v.members.map((p) => (
            <PlayerChip
              key={p.id}
              player={p}
              youId={youId}
              isHost={isHost}
              present={present}
              compact={compact}
              teamName={v.name}
              teamVoted={p.kickVotes.some((id) => v.members.some((m) => m.id === id))}
              onKick={onKick}
            />
          ))}
        </ul>
      ) : (
        <p className="lobby-team-empty">Nobody yet</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- chip */

/**
 * A player in a team card, or in the compact roster of a big room: a small
 * avatar and a one-line name, keeping everything the big tiles show (the
 * host's crown, You, Away, the kick button). The kick button waits under a
 * hover or a tap, or shows while a vote is on, so it never crowds the name.
 */
export function PlayerChip({
  player: p, youId, isHost, present, compact, teamName, teamVoted, onKick,
}: {
  player: Player;
  youId: string;
  isHost: boolean;
  present: number;
  /** One line: the notes go to screen readers; the crown and the shading stay. */
  compact: boolean;
  /** Their team, in a team game: a vote to kick them needs one from it. */
  teamName?: string;
  /** Whether anyone on their team has voted to kick them. */
  teamVoted?: boolean;
  onKick: (playerId: string) => void;
}) {
  const you = p.id === youId;
  const notes = [you && 'You', p.isHost && 'Host', !p.connected && 'Away'].filter(Boolean).join(' · ');
  const kickable = !you && !p.isHost;
  return (
    <li
      className={`lobby-team-member ${you ? 'me' : ''} ${p.connected ? '' : 'away'}`}
      // A tap focuses it, which brings up the kick button on a phone (no hover).
      tabIndex={kickable ? -1 : undefined}
    >
      <span className="lobby-team-face">
        <Avatar i={p.avatar} size={28} />
        {p.isHost && <span className="lobby-team-crown" aria-hidden="true">👑</span>}
      </span>
      <span className="lobby-team-who">
        <span className="lobby-team-pname" title={p.name}>{p.name}</span>
        {notes && <span className={compact ? 'lobby-team-sr' : 'lobby-team-note'}>{notes}</span>}
      </span>
      {kickable && (
        <span className={`lobby-team-kick ${p.kickVotes.length ? 'live' : ''}`}>
          <KickButton
            player={p}
            youId={youId}
            isHost={isHost}
            present={present}
            onKick={onKick}
            compact
            teamVote={teamName !== undefined}
            teamName={teamName}
            teamVoted={teamVoted}
          />
        </span>
      )}
    </li>
  );
}
