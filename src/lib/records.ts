import type { GameSummary } from '../generated/contract';
import { FALLBACK_ID, formatSeconds } from './results';

/**
 * Your personal records, kept in this browser: a reason to come back ("Game 7
 * · 3 wins · fastest guess 2.1s") and the milestones the results screen
 * celebrates (a first win, a new best). Counted from the server's game
 * summary, once per game however often it is re-sent (a refresh, a reconnect).
 */
export interface Records {
  games: number;
  wins: number;
  podiums: number;
  bestScore: number;
  /** Words guessed right, all games together. */
  guessed: number;
  fastestMs: number | null;
  /** Turns drawn, all games together. */
  drawings: number;
  lastGameId: string | null;
}

export type Milestone = { id: 'first-win' | 'best-score' | 'fastest' | 'games'; label: string };

const KEY = 'drawdle:records';
/** Recent games already counted, beyond the last one: a re-send in another tab, say. */
const SEEN_MAX = 20;
const GAME_MILESTONES = [5, 10, 25, 50, 100];

interface Stored extends Records {
  /** Games that ran to the end. A best score needs one before it to beat. */
  completed: number;
  seen: string[];
}

const EMPTY: Stored = {
  games: 0,
  wins: 0,
  podiums: 0,
  bestScore: 0,
  guessed: 0,
  fastestMs: null,
  drawings: 0,
  lastGameId: null,
  completed: 0,
  seen: [],
};

/** Where records live when storage is blocked: this page, until it closes. */
let memory: Stored | null = null;

const tally = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;

/** Whatever is stored, made safe: hand edits and old shapes come back as zeros. */
function parse(raw: string): Stored {
  const v: unknown = JSON.parse(raw);
  if (typeof v !== 'object' || v === null) return EMPTY;
  const o = v as Partial<Record<keyof Stored, unknown>>;
  return {
    games: tally(o.games),
    wins: tally(o.wins),
    podiums: tally(o.podiums),
    bestScore: tally(o.bestScore),
    guessed: tally(o.guessed),
    fastestMs:
      typeof o.fastestMs === 'number' && Number.isFinite(o.fastestMs) && o.fastestMs >= 0
        ? o.fastestMs
        : null,
    drawings: tally(o.drawings),
    lastGameId: typeof o.lastGameId === 'string' ? o.lastGameId : null,
    completed: tally(o.completed),
    seen: Array.isArray(o.seen)
      ? o.seen.filter((id): id is string => typeof id === 'string').slice(-SEEN_MAX)
      : [],
  };
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parse(raw) : (memory ?? EMPTY);
  } catch {
    return memory ?? EMPTY;
  }
}

function save(s: Stored): void {
  memory = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* kept in memory instead, for as long as the page is open */
  }
}

/** The records without the bookkeeping. */
const shown = (s: Stored): Records => ({
  games: s.games,
  wins: s.wins,
  podiums: s.podiums,
  bestScore: s.bestScore,
  guessed: s.guessed,
  fastestMs: s.fastestMs,
  drawings: s.drawings,
  lastGameId: s.lastGameId,
});

export function loadRecords(): Records {
  return shown(load());
}

/** "Game 7 · 3 wins · fastest guess 2.1s"; null until a game has counted. */
export function recordLine(r: Records): string | null {
  if (r.games === 0) return null;
  const parts = [`Game ${r.games}`];
  if (r.wins > 0) parts.push(r.wins === 1 ? '1 win' : `${r.wins} wins`);
  if (r.fastestMs !== null) parts.push(`fastest guess ${formatSeconds(r.fastestMs)}`);
  else if (r.bestScore > 0) parts.push(`best score ${r.bestScore}`);
  return parts.join(' · ');
}

/**
 * Count a finished game for `youId`. Only real games count: never the
 * client's stand-in summary, a game you had no part in, one where nothing was
 * drawn, or a game already counted. A game that ended early adds to the games
 * played and nothing else: winning alone after everyone left is no win.
 */
export function recordGame(
  summary: GameSummary,
  youId: string,
): { records: Records; milestones: Milestone[]; counted: boolean } {
  const before = load();
  const you = summary.players.find((p) => p.id === youId);
  if (
    summary.id === FALLBACK_ID ||
    !you ||
    summary.turns === 0 ||
    before.lastGameId === summary.id ||
    before.seen.includes(summary.id)
  ) {
    return { records: shown(before), milestones: [], counted: false };
  }

  const after: Stored = {
    ...before,
    games: before.games + 1,
    lastGameId: summary.id,
    seen: [...before.seen, summary.id].slice(-SEEN_MAX),
  };
  const milestones: Milestone[] = [];
  if (!summary.abandoned) {
    // A first place nobody scored in (0 to 0) is no win.
    const won = you.rank === 1 && you.score > 0;
    after.completed += 1;
    if (won) after.wins += 1;
    if (you.rank <= 3 && you.score > 0) after.podiums += 1;
    after.bestScore = Math.max(before.bestScore, you.score);
    after.guessed += you.guessed;
    after.drawings += you.drew;
    if (you.fastestMs !== null) {
      after.fastestMs =
        before.fastestMs === null ? you.fastestMs : Math.min(before.fastestMs, you.fastestMs);
    }

    if (won && before.wins === 0) milestones.push({ id: 'first-win', label: 'First win!' });
    // Not on the very first game: beating nothing is no personal best.
    if (before.completed > 0 && you.score > before.bestScore) {
      milestones.push({ id: 'best-score', label: `New best score: ${you.score}` });
    }
    // Faster by enough to show: 2.1s after 2.1s would read as no change.
    if (
      before.fastestMs !== null &&
      you.fastestMs !== null &&
      Math.round(you.fastestMs / 100) < Math.round(before.fastestMs / 100)
    ) {
      milestones.push({ id: 'fastest', label: `New fastest guess: ${formatSeconds(you.fastestMs)}` });
    }
    if (GAME_MILESTONES.includes(after.games)) {
      milestones.push({ id: 'games', label: `${after.games} games played!` });
    }
  }
  save(after);
  return { records: shown(after), milestones, counted: true };
}
