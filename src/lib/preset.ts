import {
  MAX_CUSTOM_WORDS,
  WORD_MAX,
  WORD_MIN,
  WORD_PACKS,
  normalizeWord,
  type WordDifficulty,
  type WordPackId,
} from '../generated/contract';

/**
 * The handoff from a guide page into a new room. "Play these online" opens
 * the game with the page's packs and difficulty in the address
 * (/?packs=animals,food&difficulty=easy), or with its word list waiting in
 * this browser's storage (/?preset=words), and the next room the player
 * creates starts with them (App.tsx). Nothing reaches the server before then,
 * and joining someone else's room never uses it.
 *
 * No React: the word tools on the guide pages use it too.
 */
export interface RoomPreset {
  packs?: WordPackId[];
  difficulty?: WordDifficulty;
  customWords?: string[];
  /** What the words are, as the home screen names them: "Hard words". */
  label?: string;
}

const STASH_KEY = 'drawdle:preset';
/** Plenty for a slow page load; an old list left behind never turns up later. */
const STASH_MAX_AGE_MS = 30 * 60_000;
const PARAMS = ['packs', 'difficulty', 'preset'];
/** As the lobby names them (RoomSettingsPanel). */
const DIFFICULTY_LABELS: Record<WordDifficulty, string> = { easy: 'Easy', mixed: 'Mixed', hard: 'Hard' };

const isDifficulty = (v: unknown): v is WordDifficulty => v === 'easy' || v === 'mixed' || v === 'hard';

/** Known packs only, each once, in the lobby's order. */
function cleanPacks(ids: readonly string[]): WordPackId[] {
  const asked = new Set(ids.map((id) => id.trim().toLowerCase()));
  return WORD_PACKS.map((p) => p.id).filter((id) => asked.has(id));
}

/** Trimmed, one of each as the server counts them, and no more than a room takes. */
function cleanWords(words: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of words) {
    const text = raw.replace(/\s+/g, ' ').trim();
    const key = normalizeWord(text);
    // The server refuses these (WORD_TOO_SHORT / WORD_TOO_LONG); leaving them
    // out keeps the count on the home screen true.
    if (key.length < WORD_MIN || text.length > WORD_MAX || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === MAX_CUSTOM_WORDS) break;
  }
  return out;
}

function query(p: { packs: WordPackId[]; difficulty: WordDifficulty }): string {
  const packs = cleanPacks(p.packs);
  // Commas as they are, so the link reads as what it does.
  return [
    ...(packs.length ? [`packs=${packs.join(',')}`] : []),
    ...(isDifficulty(p.difficulty) ? [`difficulty=${p.difficulty}`] : []),
  ].join('&');
}

/** A link to the game that starts the next room with these packs: '/?packs=animals,food&difficulty=easy'. */
export function presetHref(p: { packs: WordPackId[]; difficulty: WordDifficulty }): string {
  const q = query(p);
  return q ? `/?${q}` : '/';
}

/**
 * Leaves a word list for the game to pick up and returns the link to open
 * it: a list is too long for an address, so the link only says where to
 * look. The link carries the fallback packs and difficulty as well, so a room
 * still gets those if storage is off (private windows) or the list has gone
 * by the time the game loads.
 */
export function stashCustomWords(
  words: string[],
  label: string,
  fallback: { packs: WordPackId[]; difficulty: WordDifficulty },
): string {
  const list = cleanWords(words);
  if (!list.length) return presetHref(fallback);
  try {
    localStorage.setItem(STASH_KEY, JSON.stringify({ at: Date.now(), words: list, label }));
  } catch {
    return presetHref(fallback);
  }
  const q = query(fallback);
  return `/?preset=words${q ? `&${q}` : ''}`;
}

function readStash(): { words: string[]; label: string } | null {
  try {
    const raw = localStorage.getItem(STASH_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: unknown; words?: unknown; label?: unknown } | null;
    if (typeof v?.at !== 'number' || Math.abs(Date.now() - v.at) > STASH_MAX_AGE_MS) return null;
    const words = Array.isArray(v.words)
      ? cleanWords(v.words.filter((w): w is string => typeof w === 'string'))
      : [];
    if (!words.length) return null;
    const label = typeof v.label === 'string' && v.label.trim() ? v.label.trim() : 'Custom words';
    return { words, label };
  } catch {
    return null;
  }
}

/**
 * What the page was opened with, if anything: packs and difficulty from the
 * address, and the stashed words when it says ?preset=words. Only reads;
 * clearPresetParams() is the one that tidies up.
 */
export function readPreset(): RoomPreset | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(location.search);
  } catch {
    return null;
  }
  const preset: RoomPreset = {};
  const packs = cleanPacks((params.get('packs') ?? '').split(','));
  if (packs.length) preset.packs = packs;
  const difficulty = params.get('difficulty');
  if (isDifficulty(difficulty)) preset.difficulty = difficulty;
  if (params.get('preset') === 'words') {
    const stash = readStash();
    if (stash) {
      preset.customWords = stash.words;
      preset.label = stash.label;
    }
  }
  return preset.packs || preset.difficulty || preset.customWords ? preset : null;
}

/**
 * Takes the handoff out of the address bar (an invite's ?room stays) and out
 * of storage, so a refresh or a copied link doesn't bring it back.
 */
export function clearPresetParams(): void {
  try {
    const url = new URL(location.href);
    if (PARAMS.some((k) => url.searchParams.has(k))) {
      for (const k of PARAMS) url.searchParams.delete(k);
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }
  } catch {
    /* the address keeps them: harmless, the preset was already read */
  }
  try {
    localStorage.removeItem(STASH_KEY);
  } catch {
    /* nothing was stored */
  }
}

/** "🐼 Animals, 🍕 Food & drink +3 more · Easy", or "Hard words (242)" for a word list. */
export function describePreset(p: RoomPreset): string {
  if (p.customWords?.length) return `${p.label ?? 'Custom words'} (${p.customWords.length})`;
  const packs = cleanPacks(p.packs ?? []);
  const parts: string[] = [];
  if (packs.length === WORD_PACKS.length) {
    parts.push('All word packs');
  } else if (packs.length) {
    const named = WORD_PACKS.filter((w) => packs.slice(0, 2).includes(w.id)).map((w) => `${w.emoji} ${w.label}`);
    parts.push(named.join(', ') + (packs.length > 2 ? ` +${packs.length - 2} more` : ''));
  }
  if (p.difficulty) {
    const label = DIFFICULTY_LABELS[p.difficulty];
    parts.push(parts.length ? label : `${label} words`);
  }
  return parts.join(' · ');
}
