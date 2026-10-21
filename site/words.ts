import type { WordPackId } from '../src/generated/contract';
import {
  KIDS_BANDS,
  KIDS_PACKS,
  NON_SLANG_PACKS,
  PACKS,
  SLANG_GROUPS,
  TIER_LABELS,
  inPack,
  kidsBand,
  list,
  type ListKey,
  type Word,
} from '../src/lib/wordbank';

/**
 * The word lists on the guide pages, written into the HTML at build time from
 * the game's own words (src/lib/wordbank.ts): every word is in the page as
 * text, for search engines, for printing, and for anyone without JavaScript.
 *
 * A page asks for them with placeholders:
 *   <!--words:KEY-->       the list, as cards of word stickers
 *   <!--packnav:all-->     a row of links to each pack's card on the full list
 *   {{count:KEY}}          how many words the list has: "1,686"
 *   {{count:KEY:floor}}    the same rounded down to a multiple of 50, for "1,650+"
 * where KEY is all, easy, hard, kids, office, desi or diwali. Counts work anywhere,
 * <title> and meta tags included, so no page claims a number its list doesn't
 * have. Anything unknown or left over throws: the build fails rather than
 * ship a title that says {{count:…}}.
 */

const KEYS: readonly ListKey[] = ['all', 'easy', 'hard', 'kids', 'office', 'desi', 'diwali'];

/** Where the pages put their sections; keeps the page source readable. */
const IN = '      ';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** 1686 -> "1,686", whatever the machine's locale. */
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const collator = new Intl.Collator('en');
const alphabetical = (words: Word[]) => [...words].sort((a, b) => collator.compare(a.text, b.text));

/**
 * The pack a word is listed under on a page that shows only `packs`: its own,
 * else the second pack it joined. Whale was filed under slang first, and on
 * the easy list it is an animal.
 */
function shownIn(w: Word, packs: readonly WordPackId[]): WordPackId | undefined {
  if (packs.includes(w.pack)) return w.pack;
  return w.alsoPack && packs.includes(w.alsoPack) ? w.alsoPack : undefined;
}

interface Card {
  heading: string;
  emoji?: string;
  id?: string;
  /** One unlabelled row, or a labelled row per rating. */
  rows: { label?: string; words: Word[] }[];
}

const chips = (words: Word[]) =>
  `<ul class="words">\n${words.map((w) => `${IN}    <li>${esc(w.text)}</li>`).join('\n')}\n${IN}  </ul>`;

function card({ heading, emoji, id, rows }: Card): string {
  const filled = rows.filter((r) => r.words.length);
  const total = filled.reduce((n, r) => n + r.words.length, 0);
  const icon = emoji ? `<span aria-hidden="true">${emoji}</span> ` : '';
  const body = filled.map((r) =>
    r.label
      ? `<h3 class="tier">${esc(r.label)} <span class="count">${thousands(r.words.length)}</span></h3>\n${IN}  ${chips(r.words)}`
      : chips(r.words),
  );
  return [
    `<section class="card word-group"${id ? ` id="${id}"` : ''}>`,
    `  <h2>${icon}${esc(heading)} <span class="count">${thousands(total)} ${total === 1 ? 'word' : 'words'}</span></h2>`,
    ...body.map((b) => `  ${b}`),
    '</section>',
  ].join(`\n${IN}`);
}

/** One card per pack, each word under the first of its packs the list covers. */
function byPack(words: Word[], packs: readonly WordPackId[]): Card[] {
  return PACKS.filter((p) => packs.includes(p.id)).map((p) => ({
    heading: p.label,
    emoji: p.emoji,
    rows: [{ words: alphabetical(words.filter((w) => shownIn(w, packs) === p.id)) }],
  }));
}

const packOrder = (w: Word, packs: readonly WordPackId[]) =>
  PACKS.findIndex((p) => p.id === shownIn(w, packs));

/** A labelled row per rating, Easy first. */
const byTier = (words: Word[]): Card['rows'] =>
  ([1, 2, 3] as const).map((t) => ({
    label: TIER_LABELS[t],
    words: alphabetical(words.filter((w) => w.tier === t)),
  }));

const CARDS: Record<ListKey, () => Card[]> = {
  // The whole library pack by pack, as the lobby offers it: a word in two
  // packs is on both cards, and each card's count is its pack's.
  all: () =>
    PACKS.map((p) => ({
      heading: p.label,
      emoji: p.emoji,
      id: `pack-${p.id}`,
      rows: byTier(list('all').filter((w) => inPack(w, p.id))),
    })),
  easy: () => byPack(list('easy'), NON_SLANG_PACKS),
  hard: () => byPack(list('hard'), PACKS.map((p) => p.id)),
  // By age, and within an age the animals together, then the food, and so on.
  kids: () => {
    const words = list('kids');
    return KIDS_BANDS.map((band) => ({
      heading: band.label,
      id: `ages-${band.id}`,
      rows: [
        {
          words: alphabetical(words.filter((w) => kidsBand(w) === band.id)).sort(
            (a, b) => packOrder(a, KIDS_PACKS) - packOrder(b, KIDS_PACKS),
          ),
        },
      ],
    }));
  },
  office: () => {
    const words = list('office');
    const office = PACKS.find((p) => p.id === 'office')!;
    const slang = words.filter((w) => w.pack === 'slang');
    // A new category in the backend's slang would otherwise drop its words
    // from the page without a sound.
    const unfiled = slang.find((w) => !SLANG_GROUPS.some((g) => g.category === w.category));
    if (unfiled) {
      throw new Error(
        `site/words.ts: the slang word "${unfiled.text}" is filed under "${unfiled.category}", ` +
          'which has no label in SLANG_GROUPS (src/lib/wordbank.ts)',
      );
    }
    return [
      {
        heading: office.label,
        emoji: office.emoji,
        rows: [{ words: alphabetical(words.filter((w) => w.pack !== 'slang')) }],
      },
      ...SLANG_GROUPS.map((g) => ({
        heading: g.label,
        rows: [{ words: alphabetical(slang.filter((w) => w.category === g.category)) }],
      })),
    ];
  },
  desi: () => {
    const desi = PACKS.find((p) => p.id === 'desi')!;
    return [{ heading: desi.label, emoji: desi.emoji, rows: [{ words: alphabetical(list('desi')) }] }];
  },
  // Rated, as on the full list: a host picking a difficulty for the family
  // or the office can see what each one deals.
  diwali: () => {
    const diwali = PACKS.find((p) => p.id === 'diwali')!;
    return [{ heading: diwali.label, emoji: diwali.emoji, rows: byTier(list('diwali')) }];
  },
};

// The dev server fills pages on every request: render each list once.
const rendered = new Map<ListKey, string>();
function wordCards(key: ListKey): string {
  let html = rendered.get(key);
  if (html === undefined) {
    html = CARDS[key]()
      .filter((c) => c.rows.some((r) => r.words.length))
      .map(card)
      .join(`\n\n${IN}`);
    rendered.set(key, html);
  }
  return html;
}

const packnav = () =>
  [
    '<nav class="packnav" aria-label="Word packs">',
    ...PACKS.map((p) => `  <a href="#pack-${p.id}"><span aria-hidden="true">${p.emoji}</span> ${esc(p.label)}</a>`),
    '</nav>',
  ].join(`\n${IN}`);

function listKey(raw: string, page: string): ListKey {
  const key = KEYS.find((k) => k === raw.trim());
  if (!key) {
    throw new Error(`site/words.ts: unknown word list "${raw}" in ${page}; use one of ${KEYS.join(', ')}`);
  }
  return key;
}

/** Fills a page's word lists and counts; throws on anything it can't fill. */
export function renderWordTokens(html: string, page: string): string {
  const out = html
    .replace(/<!--words:([^>]*?)-->/g, (_m, key: string) => wordCards(listKey(key, page)))
    .replace(/<!--packnav:([^>]*?)-->/g, (_m, key: string) => {
      // Only the full list has a card per pack to jump to.
      if (key.trim() !== 'all') {
        throw new Error(`site/words.ts: <!--packnav:${key}--> in ${page}; only <!--packnav:all--> exists`);
      }
      return packnav();
    })
    .replace(/\{\{count:([^}]*)\}\}/g, (_m, spec: string) => {
      const [key = '', mode, ...extra] = spec.split(':');
      if (extra.length || (mode !== undefined && mode !== 'floor')) {
        throw new Error(`site/words.ts: {{count:${spec}}} in ${page}; write {{count:KEY}} or {{count:KEY:floor}}`);
      }
      const n = list(listKey(key, page)).length;
      return thousands(mode === 'floor' ? Math.floor(n / 50) * 50 : n);
    });
  for (const token of ['{{count:', '<!--words:', '<!--packnav:']) {
    if (out.includes(token)) {
      throw new Error(`site/words.ts: a malformed ${token}… placeholder is left in ${page}`);
    }
  }
  return out;
}
