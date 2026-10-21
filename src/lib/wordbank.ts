import { WORD_PACKS, normalizeWord, type WordPackId } from '../generated/contract';
import { packRows } from '../generated/packs.seed';
import { SEED_WORDS } from '../generated/words.seed';

/**
 * The game's word list, as the game itself deals it: the backend's seed files
 * (vendored by scripts/sync-words.mjs) read the way BE src/db/seed.ts loads
 * them. Slang goes in first; a word listed twice keeps its first pack and
 * rating and joins at most one other pack. So "samosa", listed by Food and by
 * Desi, comes up in either pack, at the rating Food gave it.
 *
 * Browser-safe on purpose: the word generator bundles it, and the guide pages
 * read it at build time (site/words.ts) to print the lists and their counts.
 * The live database can drift from the seeds (hand-edited ratings, disabled
 * rows), but nothing a page says depends on that.
 */
export interface Word {
  text: string;
  pack: WordPackId;
  alsoPack?: WordPackId;
  /** How hard it is to draw: 1 draws itself, 3 is abstract. */
  tier: 1 | 2 | 3;
  /** Slang only: the group it is filed under in words.seed.ts. */
  category?: string;
}

function load(): Word[] {
  const words: Word[] = [];
  const seen = new Map<string, Word>();
  const add = (raw: string, pack: WordPackId, tier: 1 | 2 | 3, category?: string) => {
    // As packRows() does: the seed lists wrap lines mid-phrase.
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) return;
    const key = normalizeWord(text);
    const first = seen.get(key);
    if (first) {
      if (first.pack !== pack && first.alsoPack === undefined) first.alsoPack = pack;
      return;
    }
    const word: Word = category === undefined ? { text, pack, tier } : { text, pack, tier, category };
    seen.set(key, word);
    words.push(word);
  };
  for (const [text, category, tier] of SEED_WORDS) add(text, 'slang', tier, category);
  for (const [text, pack, tier] of packRows()) add(text, pack, tier);
  return words;
}

export const WORDS: readonly Word[] = load();

export const inPack = (w: Word, p: WordPackId): boolean => w.pack === p || w.alsoPack === p;
const inAny = (w: Word, packs: readonly WordPackId[]) => packs.some((p) => inPack(w, p));

/** Every pack in the lobby's order, with how many words it can deal. */
export const PACKS: readonly { id: WordPackId; label: string; emoji: string; count: number }[] =
  WORD_PACKS.map(({ id, label, emoji }) => ({
    id,
    label,
    emoji,
    count: WORDS.filter((w) => inPack(w, id)).length,
  }));

export const NON_SLANG_PACKS: readonly WordPackId[] = WORD_PACKS.map((p) => p.id).filter(
  (id) => id !== 'slang',
);

export const TIER_LABELS: Record<Word['tier'], string> = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };

/* ---------------------------------------------------------------- kids */

/**
 * Everything but the office and its slang, and Diwali: the kids lists are for
 * any day of the year, and the Diwali words children know best (diya,
 * rangoli, ladoo, sparkler) are on them already, from Desi.
 */
export const KIDS_PACKS: readonly WordPackId[] = [
  'everyday', 'animals', 'food', 'actions', 'places', 'nature', 'sports', 'tech', 'jobs', 'fantasy', 'desi',
];
/** Where the youngest start: things they can point at, and dragons. */
const FIRST_PACKS: readonly WordPackId[] = ['animals', 'food', 'everyday', 'nature', 'fantasy'];
const FAMILIAR_PACKS: readonly WordPackId[] = ['animals', 'food', 'everyday'];

export type KidsBand = '4-6' | '7-9' | '10-12';
export const KIDS_BANDS: readonly { id: KidsBand; label: string }[] = [
  { id: '4-6', label: 'Ages 4 to 6' },
  { id: '7-9', label: 'Ages 7 to 9' },
  { id: '10-12', label: 'Ages 10 to 12' },
];

/**
 * Easy words about familiar things for the youngest; the rest of the easy
 * words and the medium ones about familiar things next; the other medium
 * words last. Each band stays within a room's custom word limit (500), so a
 * whole band can be handed to a room as its word list.
 */
export function kidsBand(w: Word): KidsBand {
  if (w.tier === 1) return inAny(w, FIRST_PACKS) ? '4-6' : '7-9';
  if (w.tier === 2 && inAny(w, FAMILIAR_PACKS)) return '7-9';
  return '10-12';
}

/**
 * Normalized words never on a kids list, picked by reading every easy and
 * medium word in the kids packs: blades and weapons, death and crime, horror
 * beyond the friendly kind, and grown-up Bollywood and paan. The spooky
 * classics stay (ghost, monster, skeleton, vampire, haunted house), and so
 * does the toilet. The last group is rated hard today, so off the lists
 * anyway; it is here in case a rating is corrected.
 */
export const KID_UNSUITABLE: ReadonlySet<string> = new Set([
  'knife', 'razor', 'slingshot',
  'prison', 'graveyard', 'butcher',
  'zombie apocalypse', 'alien invasion', 'haunted mirror',
  'paan', 'item song', 'rain dance',
  'binge watch', 'doomscroll', 'gossip', 'dark web', 'phishing', 'cryptocurrency', 'curse',
  'arranged marriage',
]);

/* -------------------------------------------------------------- slang */

/** The slang categories in words.seed.ts, in the order a reader meets them. */
export const SLANG_GROUPS: readonly { category: string; label: string }[] = [
  { category: 'meeting', label: 'Meetings' },
  { category: 'buzzword', label: 'Buzzwords' },
  { category: 'idiom', label: 'Office idioms' },
  { category: 'process', label: 'Process and projects' },
  { category: 'people', label: 'People and culture' },
  { category: 'metrics', label: 'Numbers and metrics' },
  { category: 'strategy', label: 'Strategy' },
];

/* -------------------------------------------------------------- lists */

/** The lists the guide pages print and hand to a room. */
export type ListKey = 'all' | 'easy' | 'hard' | 'kids' | 'office' | 'desi' | 'diwali';

const LISTS: Record<ListKey, (w: Word) => boolean> = {
  all: () => true,
  // No slang, but a word slang shares with another pack stays: unicorn and
  // whale are what the game deals from Fantasy and Animals at Easy.
  easy: (w) => w.tier === 1 && inAny(w, NON_SLANG_PACKS),
  hard: (w) => w.tier === 3,
  kids: (w) => w.tier <= 2 && inAny(w, KIDS_PACKS) && !KID_UNSUITABLE.has(normalizeWord(w.text)),
  office: (w) => inPack(w, 'office') || inPack(w, 'slang'),
  desi: (w) => inPack(w, 'desi'),
  diwali: (w) => inPack(w, 'diwali'),
};

/** A fresh array each call, in seed order: callers sort and shuffle it freely. */
export function list(key: ListKey): Word[] {
  return WORDS.filter(LISTS[key]);
}
