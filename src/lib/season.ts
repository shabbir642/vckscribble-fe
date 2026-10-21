/**
 * Festivals a finished game is dressed up for: the results screen greets
 * everyone, and the picture and its message wish whoever sees them well. A
 * game is festive during the festival itself, whatever it was played with,
 * and in the weeks around it when it was played with the festival's word
 * pack. Only then: a room started with every pack on (the word lists'
 * "every theme" link) must not wish everyone Happy Diwali in March.
 * No DOM and no assets, so the results, the share card and a plain node test
 * all ask the same question.
 */

/** The festival a game is dressed for, if any. */
export type Festive = 'diwali' | null;

/** What each festival wishes everyone, on the results, the picture and the message. */
export const GREETINGS: Record<NonNullable<Festive>, string> = {
  diwali: 'Happy Diwali!',
};

/**
 * Diwali as India keeps it, as dates in India, all days included: `from`
 * just before Dhanteras to `to`, the day after Bhai Dooj, when every game is
 * festive; and the season around it, `season` to `until`, when a game played
 * with the Diwali pack is. The festival follows the lunar calendar, so its
 * dates move every year: add next year's here before its season starts (in
 * 2027 Diwali falls in late October).
 */
const DIWALI_DAYS: readonly { season: string; from: string; to: string; until: string }[] = [
  // Dhanteras 6 November, Diwali 8 November, Bhai Dooj 10 November.
  { season: '2026-10-01', from: '2026-11-04', to: '2026-11-11', until: '2026-11-30' },
];

/** India keeps one time all year: UTC+5:30, no daylight saving. */
const INDIA_OFFSET_MS = (5 * 60 + 30) * 60_000;

/** The date in India at `at`, as YYYY-MM-DD (which compares as text); null for no date at all. */
function dateInIndia(at: Date): string | null {
  const india = new Date(at.getTime() + INDIA_OFFSET_MS);
  return Number.isNaN(india.getTime()) ? null : india.toISOString().slice(0, 10);
}

/**
 * The festival a game played with these packs, and finished `now`, is
 * dressed for. `wordPacks` is what the game drew its words from: none when
 * it played only the host's own words.
 */
export function festiveFor(opts: { wordPacks: readonly string[]; now?: Date }): Festive {
  const day = dateInIndia(opts.now ?? new Date());
  if (day === null) return null;
  const pack = opts.wordPacks.includes('diwali');
  const festive = DIWALI_DAYS.some(
    (d) => (day >= d.from && day <= d.to) || (pack && day >= d.season && day <= d.until),
  );
  return festive ? 'diwali' : null;
}
