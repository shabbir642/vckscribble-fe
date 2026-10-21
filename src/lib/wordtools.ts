import { WORD_PACKS, normalizeWord, type WordDifficulty, type WordPackId } from '../generated/contract';
import {
  KIDS_PACKS,
  NON_SLANG_PACKS,
  PACKS,
  TIER_LABELS,
  WORDS,
  inPack,
  kidsBand,
  list,
  type KidsBand,
  type ListKey,
  type Word,
} from './wordbank';

/**
 * What the word generator (src/generator.ts) and the word tools on the guide
 * pages (src/wordtool.ts) decide, kept apart from the page: which words are
 * in the mix, picking them without repeats, the lists they hand out, and the
 * score of a game around a table. No DOM and no styles, so it can be tested
 * on its own.
 */

/** 1190 -> "1,190", as the guide pages print counts (site/words.ts). */
export const formatCount = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "1 word", "1,190 words". */
export const wordCount = (n: number): string => `${formatCount(n)} ${n === 1 ? 'word' : 'words'}`;

/* ---------------------------------------------------------------- the mix */

/** How hard the words should be to draw, by each word's rating; Any is all of them. */
export type Level = 'easy' | 'medium' | 'hard' | 'any';

export const LEVELS: readonly { id: Level; label: string }[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
  { id: 'any', label: 'Any' },
];

const LEVEL_TIER: Record<Level, Word['tier'] | null> = { easy: 1, medium: 2, hard: 3, any: null };

export const isLevel = (v: unknown): v is Level => LEVELS.some((l) => l.id === v);

/**
 * The room difficulty that plays a level best. A room deals by odds, not by
 * one rating (Easy deals easy words only, Mixed easy and medium, Hard all
 * three), so Medium plays as Mixed and Any as Hard, which the lobby calls
 * "Anything goes".
 */
export const ROOM_DIFFICULTY: Record<Level, WordDifficulty> = {
  easy: 'easy',
  medium: 'mixed',
  hard: 'hard',
  any: 'hard',
};

/** The other way, for a tool a page sets up with a room difficulty: Mixed spans ratings, so Any. */
export const LEVEL_FOR: Record<WordDifficulty, Level> = { easy: 'easy', mixed: 'any', hard: 'hard' };

export const isDifficulty = (v: unknown): v is WordDifficulty => v === 'easy' || v === 'mixed' || v === 'hard';

/** Known pack ids only, each once, in the lobby's order: a page's or a saved list, made safe. */
export function cleanPacks(ids: readonly unknown[]): WordPackId[] {
  const asked = new Set(ids.filter((id): id is string => typeof id === 'string').map((id) => id.trim().toLowerCase()));
  return WORD_PACKS.map((p) => p.id).filter((id) => asked.has(id));
}

/** Every word the packs can deal at the level, second packs included, as the game counts them. */
export function mix(packs: readonly WordPackId[], level: Level, words: readonly Word[] = WORDS): Word[] {
  const tier = LEVEL_TIER[level];
  return words.filter((w) => (tier === null || w.tier === tier) && packs.some((p) => inPack(w, p)));
}

/**
 * The pack to name a word by, given the packs in play: its own, unless that
 * one is off and its second pack is on. Whale was filed under slang first,
 * but picked from Animals it is an animal.
 */
export function shownPack(w: Word, packs: readonly WordPackId[]): WordPackId {
  if (!packs.includes(w.pack) && w.alsoPack && packs.includes(w.alsoPack)) return w.alsoPack;
  return w.pack;
}

/** What goes under a picked word: its pack and how hard it is to draw. */
export function wordInfo(w: Word, packs: readonly WordPackId[]): { emoji: string; pack: string; tier: string } {
  const id = shownPack(w, packs);
  const p = PACKS.find((x) => x.id === id);
  return { emoji: p?.emoji ?? '', pack: p?.label ?? id, tier: TIER_LABELS[w.tier] };
}

/**
 * The mix in one line, for the button that opens the options on a phone,
 * in parts so the packs can be cut short and the rest never:
 * { packs: "🧦 Everyday +8", level: "Any", count: "1,190 words" }.
 */
export function mixSummary(
  packs: readonly WordPackId[],
  level: Level,
  count: number,
): { packs: string; level: string; count: string } {
  const first = PACKS.find((p) => packs.includes(p.id));
  const named = !first
    ? 'No packs'
    : packs.length === PACKS.length
      ? 'All packs'
      : // The first word of the name is enough here: "Everyday", "Food".
        `${first.emoji} ${first.label.split(' ')[0] ?? first.label}${packs.length > 1 ? ` +${packs.length - 1}` : ''}`;
  return { packs: named, level: LEVELS.find((l) => l.id === level)?.label ?? 'Any', count: wordCount(count) };
}

/* ------------------------------------------------------------ picking */

/** What a Picker has dealt: the words already out this round, and the last one. */
export interface Picks {
  seen: string[];
  last: string | null;
}

/**
 * Picks words at random without repeats: every word in the mix comes up
 * once before any comes up again. The mix may change between picks (a pack
 * switched on or off) and a word already shown stays shown. When the whole
 * mix has come up it starts over, but never with the word just shown.
 * It can start from saved picks, so a reload carries on where it was.
 */
export class Picker {
  private readonly seen: Set<string>;
  private last: string | null;

  constructor(
    private readonly random: () => number = Math.random,
    from?: Picks,
  ) {
    this.seen = new Set(from?.seen);
    this.last = from?.last ?? null;
  }

  /** What it has dealt so far, to save. */
  picks(): Picks {
    return { seen: [...this.seen], last: this.last };
  }

  next(from: readonly Word[]): { word: Word; reshuffled: boolean } | null {
    if (!from.length) return null;
    let fresh = from.filter((w) => !this.seen.has(w.text));
    let reshuffled = false;
    if (!fresh.length) {
      for (const w of from) this.seen.delete(w.text);
      fresh = from.length > 1 ? from.filter((w) => w.text !== this.last) : [...from];
      reshuffled = true;
    }
    const word = fresh[Math.min(fresh.length - 1, Math.floor(this.random() * fresh.length))]!;
    this.seen.add(word.text);
    this.last = word.text;
    return { word, reshuffled };
  }
}

/** Which mix saved picks belong to: its level and packs. */
export const mixKey = (packs: readonly WordPackId[], level: Level): string => `${level}:${cleanPacks(packs).join(',')}`;

/**
 * Saved picks, or null when they aren't any or were dealt from another mix
 * than `key` names: a different mix starts afresh.
 */
export function readPicks(raw: unknown, key: string): Picks | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = raw as { mix?: unknown; seen?: unknown; last?: unknown };
  if (v.mix !== key || !Array.isArray(v.seen)) return null;
  return {
    seen: v.seen.filter((t): t is string => typeof t === 'string'),
    last: typeof v.last === 'string' ? v.last : null,
  };
}

/** A shuffled copy (Fisher-Yates). */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/* ------------------------------------------------- word tools and lists */

export const LIST_KEYS: readonly ListKey[] = ['all', 'easy', 'hard', 'kids', 'office', 'desi'];
export const isListKey = (v: unknown): v is ListKey => LIST_KEYS.some((k) => k === v);

const ALL_PACKS: readonly WordPackId[] = WORD_PACKS.map((p) => p.id);

/** The packs each list's words come from, which is what a picked word is named by. */
export const LIST_PACKS: Record<ListKey, readonly WordPackId[]> = {
  all: ALL_PACKS,
  easy: NON_SLANG_PACKS,
  hard: ALL_PACKS,
  kids: KIDS_PACKS,
  office: ['office', 'slang'],
  desi: ['desi'],
};

/** A list's words, or one age band of the kids list. */
export function listWords(key: ListKey, band?: KidsBand): Word[] {
  const words = list(key);
  return key === 'kids' && band ? words.filter((w) => kidsBand(w) === band) : words;
}

/** "4 to 6": a band as the page says it, and as a room's word list is named. */
export const bandName = (b: KidsBand): string => b.replace('-', ' to ');

/** skribbl.io turns away longer words; a Drawdle room takes up to WORD_MAX (40). */
export const LIST_WORD_MAX = 30;
export const LIST_SIZES: readonly number[] = [25, 50, 100, 250, 500];

/**
 * A custom word list for skribbl.io or a Drawdle room: up to `size` words
 * from the mix in random order, each once as the game compares them, none
 * longer than LIST_WORD_MAX and none with a comma, which would split it in two.
 */
export function buildList(from: readonly Word[], size: number, random: () => number = Math.random): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of shuffle(from, random)) {
    if (out.length >= size) break;
    const text = w.text.replace(/\s+/g, ' ').trim();
    const key = normalizeWord(text);
    if (!key || seen.has(key) || text.length > LIST_WORD_MAX || text.includes(',')) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** As custom word boxes take them, skribbl.io's and a Drawdle room's alike. */
export const joinList = (words: readonly string[]): string => words.join(', ');

/* ------------------------------------------------------- the generator */

export const TIMER_CHOICES: readonly number[] = [0, 30, 60, 90];

export interface GeneratorOptions {
  packs: WordPackId[];
  level: Level;
  /** Seconds a turn lasts; 0 is no timer. */
  timer: number;
  /** New words arrive covered, for a phone passed round the guessers. */
  secret: boolean;
}

/**
 * A first visit: the packs a family or a group of friends gets, without the
 * office and its slang, which someone looking for Pictionary words mostly
 * didn't come for.
 */
export const GENERATOR_DEFAULTS: GeneratorOptions = {
  packs: cleanPacks(['everyday', 'animals', 'food', 'actions', 'places', 'nature', 'sports', 'fantasy', 'desi']),
  level: 'any',
  timer: 0,
  secret: false,
};

/** Saved options, field by field: whatever is missing or no longer valid falls back to the default. */
export function readOptions(raw: unknown): GeneratorOptions {
  const v = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof GeneratorOptions, unknown>>;
  const packs = Array.isArray(v.packs) ? cleanPacks(v.packs) : [];
  return {
    packs: packs.length ? packs : [...GENERATOR_DEFAULTS.packs],
    level: isLevel(v.level) ? v.level : GENERATOR_DEFAULTS.level,
    timer: TIMER_CHOICES.includes(v.timer as number) ? (v.timer as number) : GENERATOR_DEFAULTS.timer,
    secret: typeof v.secret === 'boolean' ? v.secret : GENERATOR_DEFAULTS.secret,
  };
}

/** The mix a link opens the generator with. */
export type LinkedOptions = Partial<Pick<GeneratorOptions, 'packs' | 'level'>>;

/**
 * What a link asks of the generator, as the address has it
 * (/pictionary-word-generator?packs=animals,food&level=easy) or as kept
 * since: known packs and a level. Whatever is missing or not valid is left
 * out, for the saved choices to fill.
 */
export function readLinked(raw: unknown): LinkedOptions {
  const v = (typeof raw === 'object' && raw !== null ? raw : {}) as { packs?: unknown; level?: unknown };
  const out: LinkedOptions = {};
  const packs = cleanPacks(typeof v.packs === 'string' ? v.packs.split(',') : Array.isArray(v.packs) ? v.packs : []);
  if (packs.length) out.packs = packs;
  const level = typeof v.level === 'string' ? v.level.trim().toLowerCase() : null;
  if (isLevel(level)) out.level = level;
  return out;
}

/* -------------------------------------------------------------- scores */

export type Team = 0 | 1;

export interface Score {
  names: [string, string];
  points: [number, number];
  /** The team drawing and guessing now. */
  turn: Team;
}

export const TEAM_NAME_MAX = 20;
export const defaultTeamName = (t: Team): string => `Team ${t + 1}`;
export const otherTeam = (t: Team): Team => (t === 0 ? 1 : 0);

export const newScore = (names: [string, string] = [defaultTeamName(0), defaultTeamName(1)]): Score => ({
  names: [names[0], names[1]],
  points: [0, 0],
  turn: 0,
});

/** A name as typed, tidied; an empty one goes back to "Team 1". */
export function cleanTeamName(raw: string, t: Team): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, TEAM_NAME_MAX).trim() || defaultTeamName(t);
}

/** A right guess is worth what the word was to draw: Easy 1, Medium 2, Hard 3. */
export const pointsFor = (w: Word): number => w.tier;

/** The team whose turn it is scores, and the turn passes. */
export function scoreTurn(s: Score, points: number): Score {
  const p: [number, number] = [s.points[0], s.points[1]];
  p[s.turn] += points;
  return { ...s, points: p, turn: otherTeam(s.turn) };
}

export const passTurn = (s: Score): Score => ({ ...s, turn: otherTeam(s.turn) });

/** A correction by hand. Nobody goes below nothing. */
export function adjustScore(s: Score, t: Team, delta: number): Score {
  const p: [number, number] = [s.points[0], s.points[1]];
  p[t] = Math.max(0, p[t] + delta);
  return { ...s, points: p };
}

/** A saved score, or null when it isn't one. */
export function readScore(raw: unknown): Score | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = raw as Partial<Record<keyof Score, unknown>>;
  const pts = Array.isArray(v.points) ? v.points : [];
  const names = Array.isArray(v.names) ? v.names : [];
  const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : null);
  const p0 = count(pts[0]);
  const p1 = count(pts[1]);
  if (p0 === null || p1 === null || (v.turn !== 0 && v.turn !== 1)) return null;
  const name = (n: unknown, t: Team) => cleanTeamName(typeof n === 'string' ? n : '', t);
  return { names: [name(names[0], 0), name(names[1], 1)], points: [p0, p1], turn: v.turn };
}

/* ------------------------------------------------------------ keyboard */

/**
 * Where a key belongs to the control that has focus: N typed into a team
 * name, or pressed on a chip, is not a request for a new word.
 */
export const INTERACTIVE =
  'button, a, input, select, textarea, summary, [contenteditable], ' +
  '[role="button"], [role="radio"], [role="switch"], [role="checkbox"]';

/** N, with no modifier but Shift (that's how a capital comes), and not a held key repeating. */
export function isNewWordKey(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  isComposing?: boolean;
}): boolean {
  return (e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !e.isComposing;
}

/** Arrow keys within a radio group: the option to move to, or null for any other key. */
export function stepIndex(key: string, index: number, count: number): number | null {
  if (count < 1) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
