import './wordtool.css';
import type { WordDifficulty, WordPackId } from './generated/contract';
import { presetHref, stashCustomWords } from './lib/preset';
import { copyText } from './lib/share';
import { KIDS_BANDS, PACKS, type KidsBand, type ListKey } from './lib/wordbank';
import {
  LEVELS,
  LEVEL_FOR,
  LIST_PACKS,
  LIST_SIZES,
  LIST_WORD_MAX,
  Picker,
  ROOM_DIFFICULTY,
  bandName,
  buildList,
  cleanPacks,
  isDifficulty,
  isListKey,
  joinList,
  listWords,
  mix,
  stepIndex,
  wordCount,
  wordInfo,
  type Level,
} from './lib/wordtools';

/**
 * The word tools on the guide pages. A page asks for one with an empty
 *
 *   <div class="wordtool" data-list="hard" data-handoff="words"
 *        data-packs="everyday,animals,…" data-difficulty="hard" data-label="Hard words"></div>
 *
 * and gets: a random word from its list, the whole list copied for a custom
 * word box, and "Play these online", which starts the player's next room
 * with the page's packs and difficulty (data-handoff="packs") or with the
 * list itself (data-handoff="words"; data-packs and data-difficulty are then
 * what the room gets if this browser can't store the list). The kids list is
 * picked, copied and played one age band at a time. data-mode="builder"
 * makes the custom list builder instead.
 *
 * Without JavaScript the div stays empty, and the page, with every word
 * written into it, works as it is. Any button[data-print] on the page prints it.
 */

const FEEDBACK_MS = 2000;
/** The builder's first list: plenty for a game of skribbl.io or Drawdle without repeats. */
const BUILDER_SIZE = 100;

type Attrs = Record<string, string | number | boolean | undefined>;

/** An element with attributes (false and undefined left off) and children. */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    el.setAttribute(name, value === true ? '' : String(value));
  }
  el.append(...children);
  return el;
}

const emoji = (char: string) => h('span', { 'aria-hidden': 'true' }, char);

let uid = 0;
/** Ids for labels, unique however many tools a page has. */
const uniqueId = (name: string) => `wt-${name}-${++uid}`;

/** Restarts a CSS animation that runs when a class is added. */
function replay(el: HTMLElement, className: string): void {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

/** The room a Play link starts, as the page set it on the tool. */
interface Handoff {
  packs: WordPackId[];
  difficulty: WordDifficulty;
  label: string;
}

function readHandoff(el: HTMLElement, otherwise: readonly WordPackId[]): Handoff {
  const packs = cleanPacks((el.dataset.packs ?? '').split(','));
  const difficulty = el.dataset.difficulty;
  if (!packs.length || !isDifficulty(difficulty)) {
    // A room without them keeps the lobby's defaults, office slang and all.
    console.warn('wordtool: give every tool data-packs and data-difficulty', el);
  }
  return {
    packs: packs.length ? packs : [...otherwise],
    difficulty: isDifficulty(difficulty) ? difficulty : 'mixed',
    label: el.dataset.label?.trim() || 'Custom words',
  };
}

/**
 * Keeps a link's address up to date with a word list stashed for the game at
 * the moment it is followed: by a click, a middle click or "open in new tab"
 * (the stash is shared with the new tab). Until then it carries the packs and
 * difficulty, which is also what it falls back to without storage.
 */
function handOffWords(link: HTMLAnchorElement, stash: () => string): void {
  const arm = () => {
    link.href = stash();
  };
  link.addEventListener('click', arm);
  link.addEventListener('auxclick', arm);
  link.addEventListener('contextmenu', arm);
}

/** A segmented control of radios: click, or arrow keys, which move the choice as in a native radio group. */
function radios<T extends string>(
  labelledBy: string,
  choices: readonly { value: T; label: string; aria?: string }[],
  selected: T,
  onPick: (value: T) => void,
): HTMLDivElement {
  const group = h('div', {
    class: 'segmented cols',
    role: 'radiogroup',
    'aria-labelledby': labelledBy,
    style: `--n: ${choices.length}`,
  });
  const buttons = choices.map((c) => h('button', { type: 'button', role: 'radio', 'aria-label': c.aria }, c.label));
  const select = (at: number) =>
    buttons.forEach((b, i) => {
      b.classList.toggle('on', i === at);
      b.setAttribute('aria-checked', String(i === at));
      b.tabIndex = i === at ? 0 : -1;
    });
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => {
      const choice = choices[i];
      if (!choice) return;
      select(i);
      onPick(choice.value);
    });
    b.addEventListener('keydown', (e) => {
      const to = stepIndex(e.key, i, buttons.length);
      if (to === null) return;
      e.preventDefault();
      buttons[to]?.focus();
      buttons[to]?.click();
    });
  });
  select(Math.max(0, choices.findIndex((c) => c.value === selected)));
  group.append(...buttons);
  return group;
}

/** The page's row of calls to action after the tool, where its Play link belongs beside the others. */
function ctaRowAfter(el: Element): HTMLElement | null {
  for (let next = el.nextElementSibling; next; next = next.nextElementSibling) {
    if (next instanceof HTMLElement && next.matches('.cta-row')) return next;
  }
  return null;
}

/* -------------------------------------------------------- list tools */

function mountList(el: HTMLElement, key: ListKey): void {
  const handoff = readHandoff(el, LIST_PACKS[key]);
  const kids = key === 'kids';
  let band: KidsBand = KIDS_BANDS[0]?.id ?? '4-6';
  const words = () => listWords(key, kids ? band : undefined);
  const picker = new Picker();

  const text = h('span', { class: 'wt-text' });
  const meta = h('span', { class: 'wt-meta' });
  const shown = h('div', { class: 'wt-word', 'aria-live': 'polite', 'aria-atomic': 'true' }, text, meta);
  const pickBtn = h('button', { type: 'button', class: 'primary big wt-pick' }, 'Pick a random word');
  const copyBtn = h('button', { type: 'button', class: 'wt-copy' });
  const status = h('div', { class: 'wt-status', role: 'status' });
  const manual = h('textarea', {
    class: 'wt-manual',
    readonly: true,
    rows: 4,
    hidden: true,
    'aria-label': 'Every word on the list, comma-separated',
  });
  const play = h('a', { class: 'cta wt-play', href: presetHref(handoff) }, 'Play these online');

  const say = (message: string) => {
    status.textContent = message;
  };
  const copyLabel = () => `Copy all ${wordCount(words().length)}`;
  const blank = () => {
    text.textContent = 'Your word appears here';
    meta.textContent = '';
    shown.classList.add('empty');
  };

  pickBtn.addEventListener('click', () => {
    const next = picker.next(words());
    if (!next) return;
    const info = wordInfo(next.word, LIST_PACKS[key]);
    text.textContent = next.word.text;
    meta.replaceChildren(...(info.emoji ? [emoji(info.emoji), ' '] : []), `${info.pack} · ${info.tier}`);
    shown.classList.remove('empty');
    replay(shown, 'pop');
    say(next.reshuffled ? "That's every word on this list, so they start again." : '');
  });

  let copyTimer = 0;
  copyBtn.addEventListener('click', () => {
    const all = words();
    const list = joinList(all.map((w) => w.text));
    void copyText(list).then((ok) => {
      clearTimeout(copyTimer);
      if (ok) {
        manual.hidden = true;
        copyBtn.textContent = 'Copied';
        say(`Copied ${wordCount(all.length)}, separated by commas.`);
        copyTimer = window.setTimeout(() => (copyBtn.textContent = copyLabel()), FEEDBACK_MS);
      } else {
        // Here the browser said no: the list, selected, to copy by hand.
        manual.value = list;
        manual.hidden = false;
        manual.focus();
        manual.setSelectionRange(0, list.length);
        say("This browser won't copy from here. The list is below, selected: copy it from there.");
      }
    });
  });

  if (el.dataset.handoff === 'words') {
    handOffWords(play, () =>
      stashCustomWords(
        words().map((w) => w.text),
        kids ? `${handoff.label}, ages ${bandName(band)}` : handoff.label,
        handoff,
      ),
    );
  }

  const parts: HTMLElement[] = [];
  if (kids) {
    const labelId = uniqueId('ages');
    const group = radios(
      labelId,
      KIDS_BANDS.map((b) => ({ value: b.id, label: bandName(b.id), aria: b.label })),
      band,
      (b) => {
        band = b;
        blank();
        copyBtn.textContent = copyLabel();
        manual.hidden = true;
        say('');
      },
    );
    parts.push(h('div', { class: 'wt-band' }, h('span', { class: 'wt-label', id: labelId }, 'Ages'), group));
  }
  parts.push(h('div', { class: 'wt-pick-row' }, pickBtn, shown));
  const foot = h(
    'div',
    { class: 'wt-foot' },
    copyBtn,
    h('span', { class: 'wt-hint' }, 'Comma-separated, for a custom word list'),
  );
  parts.push(foot, status, manual);

  const row = ctaRowAfter(el);
  if (row) row.prepend(play);
  else foot.append(play);

  blank();
  copyBtn.textContent = copyLabel();
  el.replaceChildren(h('div', { class: 'wt-card' }, ...parts));
}

/* ------------------------------------------------------------ builder */

/** The custom list builder: packs, difficulty and size in, a comma-separated list out. */
function mountBuilder(el: HTMLElement): void {
  const handoff = readHandoff(el, PACKS.map((p) => p.id));
  let packs = [...handoff.packs];
  let level: Level = LEVEL_FOR[handoff.difficulty];
  let size = LIST_SIZES.includes(BUILDER_SIZE) ? BUILDER_SIZE : (LIST_SIZES[0] ?? BUILDER_SIZE);
  let list: string[] = [];

  const ids = { packs: uniqueId('packs'), level: uniqueId('level'), size: uniqueId('size'), list: uniqueId('list') };
  const status = h('div', { class: 'wt-status', id: uniqueId('status'), role: 'status' });
  const area = h('textarea', {
    class: 'wt-list',
    id: ids.list,
    readonly: true,
    rows: 6,
    spellcheck: 'false',
    'aria-describedby': status.id,
  });
  const copyBtn = h('button', { type: 'button', class: 'primary big' }, 'Copy list');
  const shuffleBtn = h('button', { type: 'button', class: 'big' }, 'Shuffle');
  const play = h('a', { class: 'cta secondary wt-play' }, 'Play these on Drawdle');
  const say = (message: string) => {
    status.textContent = message;
  };
  const fallback = () => ({ packs, difficulty: ROOM_DIFFICULTY[level] });

  const chips = new Map<WordPackId, HTMLButtonElement>();
  const chipRow = h('div', { class: 'chips', role: 'group', 'aria-labelledby': ids.packs });
  const renderChips = () => {
    for (const [id, chip] of chips) {
      const on = packs.includes(id);
      chip.classList.toggle('on', on);
      chip.setAttribute('aria-pressed', String(on));
    }
  };

  const regenerate = () => {
    list = buildList(mix(packs, level), size);
    area.value = joinList(list);
    area.scrollTop = 0;
    copyBtn.disabled = list.length === 0;
    const n = list.length;
    say(
      n === 0
        ? 'No words match. Switch on another pack or pick Any.'
        : n < size
          ? `Only ${wordCount(n)} ${n === 1 ? 'matches' : 'match'}, so the list has ${n === 1 ? 'it' : 'all of them'}.`
          : `${wordCount(n)} in random order, none longer than ${LIST_WORD_MAX} characters.`,
    );
    play.href = presetHref(fallback());
  };

  for (const p of PACKS) {
    const chip = h('button', { type: 'button', class: 'chip' }, emoji(p.emoji), ` ${p.label}`);
    chip.addEventListener('click', () => {
      const on = packs.includes(p.id);
      if (on && packs.length === 1) return say('Keep at least one pack on.');
      packs = cleanPacks(on ? packs.filter((x) => x !== p.id) : [...packs, p.id]);
      renderChips();
      regenerate();
    });
    chips.set(p.id, chip);
    chipRow.append(chip);
  }

  const levels = radios(
    ids.level,
    LEVELS.map((l) => ({ value: l.id, label: l.label })),
    level,
    (v) => {
      level = v;
      regenerate();
    },
  );
  const sizes = radios(
    ids.size,
    LIST_SIZES.map((n) => ({ value: String(n), label: String(n), aria: `${n} words` })),
    String(size),
    (v) => {
      size = Number(v);
      regenerate();
    },
  );

  // Selected on focus, ready to copy by hand (iOS needs the range set).
  area.addEventListener('focus', () => {
    area.select();
    area.setSelectionRange(0, area.value.length);
  });

  let copyTimer = 0;
  copyBtn.addEventListener('click', () => {
    const n = list.length;
    void copyText(area.value).then((ok) => {
      clearTimeout(copyTimer);
      if (ok) {
        copyBtn.textContent = 'Copied';
        say(`Copied ${wordCount(n)}, separated by commas.`);
        copyTimer = window.setTimeout(() => (copyBtn.textContent = 'Copy list'), FEEDBACK_MS);
      } else {
        area.focus();
        say("This browser won't copy from here. The list is selected: copy it from the box.");
      }
    });
  });
  shuffleBtn.addEventListener('click', regenerate);
  handOffWords(play, () => stashCustomWords(list, handoff.label, fallback()));

  const field = (labelId: string, label: string, control: HTMLElement) =>
    h('div', { class: 'field' }, h('span', { id: labelId }, label), control);

  el.replaceChildren(
    h(
      'div',
      { class: 'wt-card wt-builder' },
      field(ids.packs, 'Word packs', chipRow),
      h(
        'div',
        { class: 'wt-pair' },
        field(ids.level, 'Difficulty', levels),
        field(ids.size, 'How many words', sizes),
      ),
      h('div', { class: 'field wt-out' }, h('label', { for: ids.list }, 'Your list'), area, status),
      h('div', { class: 'wt-actions' }, copyBtn, shuffleBtn, play),
    ),
  );
  renderChips();
  regenerate();
}

/* -------------------------------------------------------------- start */

for (const el of document.querySelectorAll<HTMLElement>('.wordtool')) {
  const key = el.dataset.list;
  if (el.dataset.mode === 'builder') mountBuilder(el);
  else if (isListKey(key)) mountList(el, key);
  else console.error(`wordtool: data-list="${key ?? ''}" is not a list; use all, easy, hard, kids, office, desi or diwali`, el);
}

for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-print]')) {
  button.addEventListener('click', () => window.print());
}
