import { useEffect, useState, type ReactNode } from 'react';
import {
  DRAW_TIMES,
  MAX_PLAYERS,
  MAX_TEAMS,
  MIN_CUSTOM_WORDS,
  MIN_PLAYERS,
  MIN_TEAMS,
  TEAMS,
  WORD_PACKS,
  type GameMode,
  type Player,
  type Result,
  type RoomSettings,
  type WordDifficulty,
  type WordPackId,
} from '../generated/contract';

type Patch = Partial<Omit<RoomSettings, 'customWordCount'>>;

interface Props {
  settings: RoomSettings;
  /** Everyone in the room: the game-length estimate counts who is here. */
  players: Player[];
  isHost: boolean;
  busy: boolean;
  hostName: string | null;
  /** The host's custom list; null for everyone else. */
  hostWords: string[] | null;
  onSettings: (patch: Patch) => void;
  onCustomWords: (text: string) => Promise<Result<{ accepted: number; rejected: string[] }>>;
}

const DIFFICULTIES: { id: WordDifficulty; label: string; hint: string }[] = [
  { id: 'easy', label: 'Easy', hint: 'Words that draw themselves' },
  { id: 'mixed', label: 'Mixed', hint: 'Mostly easy, some trickier' },
  { id: 'hard', label: 'Hard', hint: 'Anything goes, even “synergy”' },
];

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** The most rounds a host can pick (the server's limit too). */
export const MAX_ROUNDS = 10;

/*
 * The game-length estimate uses typical phase lengths, not the maxima: about
 * 5 s to pick a word, a 4 s reveal, 5 s of scores between rounds. A classic
 * turn runs most of its draw time (it waits for everyone to guess); a team
 * turn about half (the first right answer ends it).
 */
const CHOOSE_S = 5;
const REVEAL_S = 4;
const SCORES_S = 5;
const DRAWN_SHARE: Record<GameMode, number> = { classic: 0.8, teams: 0.5 };
/** Past this, the host is nudged towards a shorter game. */
export const LONG_GAME_S = 30 * 60;
/** What turning teams on aims the rounds at: a good length for a party. */
const TEAM_GAME_TARGET_S = 15 * 60;
/** From this many players one round of teams already makes a long game. */
const ONE_ROUND_FROM = 20;
/** The server deals teams of up to about this many when teams are turned on. */
const PLAYERS_PER_TEAM = 8;

/** What the estimate depends on. */
export interface GameShape {
  mode: GameMode;
  rounds: number;
  drawSeconds: number;
  /** Players present: everyone draws once a round in a classic game. */
  players: number;
  teamCount: number;
  /** Players present in the biggest team: each team gets that many turns a round. */
  largestTeam: number;
}

/** The room as it stands, for the estimate. Never fewer than the two a game needs. */
export function gameShape(s: RoomSettings, players: Player[]): GameShape {
  const here = players.filter((p) => p.connected);
  const teamCount = Math.min(MAX_TEAMS, Math.max(MIN_TEAMS, s.teamCount ?? MIN_TEAMS));
  const sizes = TEAMS.slice(0, teamCount).map(
    (t) => here.filter((p) => (p.teamId ?? null) === t.id).length,
  );
  return {
    mode: s.mode === 'teams' ? 'teams' : 'classic',
    rounds: s.rounds,
    drawSeconds: s.drawSeconds,
    players: Math.max(MIN_PLAYERS, here.length),
    teamCount,
    largestTeam: Math.max(1, ...sizes),
  };
}

/** Turns each team gets in a team game: every round, as many as the largest team has players. */
export function turnsPerTeam(g: Pick<GameShape, 'rounds' | 'largestTeam'>): number {
  return g.rounds * Math.max(1, g.largestTeam);
}

/** Roughly how long a game takes, in seconds. */
export function gameSeconds(g: GameShape): number {
  const turns = g.mode === 'teams' ? g.teamCount * turnsPerTeam(g) : g.players * g.rounds;
  const turn = CHOOSE_S + DRAWN_SHARE[g.mode] * g.drawSeconds + REVEAL_S;
  return turns * turn + SCORES_S * g.rounds;
}

/** "About 15 minutes": a guess, so past half an hour it is rounded to 5 minutes. */
export function formatLength(seconds: number): string {
  let minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes > 30) minutes = Math.round(minutes / 5) * 5;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const mins = (n: number) => `${n} minute${n === 1 ? '' : 's'}`;
  if (!hours) return `About ${mins(rest)}`;
  return `About ${hours} hour${hours === 1 ? '' : 's'}${rest ? ` ${mins(rest)}` : ''}`;
}

/** The teams for this many players here: one per 8 or so, as the server picks them. */
export function teamsFor(present: number): number {
  return Math.min(MAX_TEAMS, Math.max(MIN_TEAMS, Math.ceil(present / PLAYERS_PER_TEAM)));
}

/**
 * Rounds for a new team game of this many players: whichever comes nearest
 * a 15-minute game, and just one from 20 players. The teams are taken to be
 * dealt the way the server deals them (as even as they go).
 */
export function roundsForTeams(present: number, drawSeconds: number): number {
  if (present >= ONE_ROUND_FROM) return 1;
  const teamCount = teamsFor(present);
  const shape = {
    mode: 'teams' as const,
    drawSeconds,
    players: present,
    teamCount,
    largestTeam: Math.ceil(present / teamCount),
  };
  let best = 1;
  let bestGap = Infinity;
  for (let rounds = 1; rounds <= MAX_ROUNDS; rounds++) {
    const gap = Math.abs(gameSeconds({ ...shape, rounds }) - TEAM_GAME_TARGET_S);
    if (gap < bestGap) {
      best = rounds;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Turning teams on: the mode alone. The server deals the teams and picks how
 * many and the rounds for whoever is here, and the rounds follow the room
 * until the host sets them. Rounds sent from here stayed as the lobby was when
 * the switch flipped: a host on their own got 10 rounds for the 30 to come.
 */
export function teamsOnPatch(): Patch {
  return { mode: 'teams' };
}

/**
 * A long team game's fix: teams of about 8 and the rounds for about 15
 * minutes, for the players here. Null when the room has those already, or
 * when they wouldn't make the game any shorter (then the draw time is what
 * makes it long).
 */
export function shorterTeamGame(s: RoomSettings, players: Player[]): { teamCount: number; rounds: number } | null {
  const shape = gameShape(s, players);
  const teamCount = teamsFor(shape.players);
  const rounds = roundsForTeams(shape.players, s.drawSeconds);
  if (teamCount === shape.teamCount && rounds === shape.rounds) return null;
  // A new count is dealt afresh by the server, as even as it goes.
  const largestTeam = teamCount === shape.teamCount ? shape.largestTeam : Math.ceil(shape.players / teamCount);
  const shorter = gameSeconds({ ...shape, teamCount, rounds, largestTeam }) < gameSeconds(shape);
  return shorter ? { teamCount, rounds } : null;
}

/**
 * Room settings, skribbl-style: dropdowns, a difficulty switch, word packs
 * and the host's own words. Everyone sees them; only the host can change them.
 */
export function RoomSettingsPanel({
  settings: s, players, isHost, busy, hostName, hostWords, onSettings, onCustomWords,
}: Props) {
  const locked = !isHost || busy;
  const teams = s.mode === 'teams';
  const shape = gameShape(s, players);
  const seconds = gameSeconds(shape);
  const draws = turnsPerTeam(shape);
  // A long team game (Teams turned on before everyone came can leave 2 teams
  // of 15 playing 10 rounds) gets its fix in one tap, said as what it changes.
  const fix = teams && isHost && seconds > LONG_GAME_S ? shorterTeamGame(s, players) : null;
  const fixLabel = fix && [
    fix.teamCount !== shape.teamCount && `${fix.teamCount} teams`,
    fix.rounds !== shape.rounds && `${fix.rounds} round${fix.rounds === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' and ');
  const [draft, setDraft] = useState(() => (hostWords ?? []).join(', '));
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Follow the server's list unless the host is mid-edit.
  useEffect(() => {
    if (!dirty) setDraft((hostWords ?? []).join(', '));
  }, [hostWords, dirty]);

  const togglePack = (id: WordPackId) => {
    const on = s.wordPacks.includes(id);
    if (on && s.wordPacks.length === 1 && !s.customWordsOnly) return; // keep at least one
    onSettings({ wordPacks: on ? s.wordPacks.filter((p) => p !== id) : [...s.wordPacks, id] });
  };

  const saveWords = async () => {
    const r = await onCustomWords(draft);
    if (!r.ok) return;
    setDirty(false);
    setResult(
      `${r.accepted} word${r.accepted === 1 ? '' : 's'} saved.` +
        (r.rejected.length ? ` Skipped: ${r.rejected.slice(0, 6).join(', ')}${r.rejected.length > 6 ? '…' : ''}` : ''),
    );
  };

  const select = (
    label: ReactNode,
    value: number,
    options: number[],
    format: (n: number) => string,
    key: keyof Patch,
  ) => (
    <label className="field inline">
      <span>{label}</span>
      <select
        value={value}
        disabled={locked}
        onChange={(e) => onSettings({ [key]: Number(e.target.value) } as Patch)}
      >
        {options.map((n) => (
          <option key={n} value={n}>{format(n)}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="card settings">
      <h3>Game settings</h3>
      {!isHost && (
        <p className="muted small" style={{ marginBottom: 12 }}>
          {hostName ? `${hostName} picks the settings.` : 'The host picks the settings.'}
        </p>
      )}

      {select(
        teams ? <>Rounds <span className="lobby-team-aside">(everyone draws once a round)</span></> : 'Rounds',
        s.rounds,
        range(1, MAX_ROUNDS),
        String,
        'rounds',
      )}
      {select('Draw time', s.drawSeconds, DRAW_TIMES, (n) => `${n} seconds`, 'drawSeconds')}
      {select('Words to choose from', s.wordChoices, range(1, 5), String, 'wordChoices')}
      {select('Hints', s.hints, range(0, 5), (n) => (n === 0 ? 'No hints' : `Up to ${n} letter${n > 1 ? 's' : ''}`), 'hints')}
      {select('Max players', s.maxPlayers, range(MIN_PLAYERS, MAX_PLAYERS), String, 'maxPlayers')}

      {/* An honest guess, kept current as people come and go. */}
      <div className="field inline lobby-team-length">
        <span>Game length</span>
        <span className="lobby-team-length-value">
          {formatLength(seconds)}
          {teams && <small>{draws === 1 ? 'Each team draws once' : `Each team draws ${draws} times`}</small>}
        </span>
      </div>
      {isHost && seconds > LONG_GAME_S && (
        <p className="lobby-team-nudge">
          Long game:{' '}
          {!teams ? (
            <>
              <button
                type="button"
                className="link"
                disabled={busy}
                onClick={() => onSettings(teamsOnPatch())}
              >
                try Teams
              </button>
              , or fewer rounds
            </>
          ) : fix ? (
            <button type="button" className="link" disabled={busy} onClick={() => onSettings(fix)}>
              try {fixLabel}
            </button>
          ) : (
            'try a shorter draw time'
          )}
        </p>
      )}

      <div className="field">
        <span>Word difficulty</span>
        <div className="segmented" role="radiogroup" aria-label="Word difficulty">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={s.difficulty === d.id}
              className={s.difficulty === d.id ? 'on' : ''}
              disabled={locked}
              title={d.hint}
              onClick={() => onSettings({ difficulty: d.id })}
            >
              {d.label}
            </button>
          ))}
        </div>
        <span className="muted small">{DIFFICULTIES.find((d) => d.id === s.difficulty)?.hint}</span>
      </div>

      <div className={`field ${s.customWordsOnly ? 'dimmed' : ''}`}>
        <span>Word packs</span>
        <div className="chips">
          {WORD_PACKS.map((p) => {
            const on = s.wordPacks.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`chip ${on ? 'on' : ''}`}
                aria-pressed={on}
                disabled={locked}
                onClick={() => togglePack(p.id)}
              >
                <span aria-hidden="true">{p.emoji}</span> {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="field inline">
        <span>
          Drawers can write their own word
          {/* A team's drawer could write a word only their own team would get. */}
          {teams && <> <span className="lobby-team-aside">(everyone for themselves only)</span></>}
        </span>
        <input
          type="checkbox"
          disabled={locked}
          checked={s.allowCustomWords}
          onChange={(e) => onSettings({ allowCustomWords: e.target.checked })}
        />
      </label>

      <div className="field custom-words">
        <span>Your own words</span>
        {isHost ? (
          <>
            <textarea
              value={draft}
              rows={4}
              disabled={busy}
              placeholder="Comma-separated, like: pizza night, the office dog, grandma's cat"
              onChange={(e) => {
                setDraft(e.target.value);
                setDirty(true);
                setResult(null);
              }}
            />
            <div className="row-between">
              <span className="muted small">
                {result ?? `${s.customWordCount} saved. Only you can see this list.`}
              </span>
              <button className="small" disabled={busy || !dirty} onClick={() => void saveWords()}>
                Save words
              </button>
            </div>
            <label className="field inline" style={{ marginTop: 8, marginBottom: 0 }}>
              <span>Use only my words (at least {MIN_CUSTOM_WORDS})</span>
              <input
                type="checkbox"
                disabled={busy}
                checked={s.customWordsOnly}
                onChange={(e) => onSettings({ customWordsOnly: e.target.checked })}
              />
            </label>
          </>
        ) : (
          <span className="muted small">
            {s.customWordCount
              ? `${s.customWordCount} custom words added${s.customWordsOnly ? ', and only those will be used' : ''}.`
              : 'No custom words.'}
          </span>
        )}
      </div>
    </div>
  );
}
