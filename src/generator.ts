import './generator.css';
import type { WordPackId } from './generated/contract';
import { presetHref } from './lib/preset';
import { copyText } from './lib/share';
import { sfx, soundEnabled, toggleSound } from './lib/sound';
import { PACKS, type Word } from './lib/wordbank';
import {
  INTERACTIVE,
  Picker,
  ROOM_DIFFICULTY,
  TIMER_CHOICES,
  adjustScore,
  cleanPacks,
  cleanTeamName,
  isLevel,
  isNewWordKey,
  mix,
  mixKey,
  mixSummary,
  newScore,
  passTurn,
  pointsFor,
  readLinked,
  readOptions,
  readPicks,
  readScore,
  scoreTurn,
  stepIndex,
  wordCount,
  wordInfo,
  type GeneratorOptions,
  type LinkedOptions,
  type Score,
  type Team,
} from './lib/wordtools';

/**
 * The word generator (/pictionary-word-generator): a random word at a tap,
 * and what a table needs to play Pictionary with it on one phone. A turn
 * goes New word, then Got it! (or the clock runs out), then the other team's
 * New word; the word can arrive covered, for a phone passed round the
 * guessers, and two teams can keep score.
 *
 * The markup is in pictionary-word-generator.html, so the tool is on screen
 * before this arrives; this wires it up. Choices are remembered in
 * localStorage, and the evening's game (its score, the words it has had) in
 * sessionStorage, both optional: without storage everything works and is
 * simply forgotten. A link can open it on a mix of its own (LINK_PARAMS).
 */

const OPTIONS_KEY = 'drawdle:generator';
/** Per tab: a refresh mid-game keeps the score, next week's game starts at zero. */
const SCORE_KEY = 'drawdle:generator:score';
/** Per tab, as the score: the words the game has had, so a refresh doesn't deal them again. */
const SEEN_KEY = 'drawdle:generator:seen';
/** Per tab: the mix a link opened the page with, kept for a refresh until the options are changed here. */
const LINK_KEY = 'drawdle:generator:link';
/** How a link sets the mix: /pictionary-word-generator?packs=animals,food&level=easy. */
const LINK_PARAMS = ['packs', 'level'];
const RECENT_MAX = 8;
/** As in the game: the clock goes pink and pulses for the last ten seconds, and ticks for the last five. */
const HURRY_SECONDS = 10;
const TICK_SECONDS = 5;
/**
 * A button that has just changed what it does ignores taps for this long, so
 * a double tap on New word doesn't land on the Got it! that replaced it.
 */
const SETTLE_MS = 450;
/** Held this long before a hidden word shows: brushing the screen shouldn't flash it. */
const PEEK_DELAY_MS = 120;
const FEEDBACK_MS = 2000;
/** .gen-text's line-height in generator.css. */
const LINE_HEIGHT = 1.1;

type Phase = 'ready' | 'turn' | 'timeup';
type Action = 'new' | 'got' | 'skip' | 'missed' | 'next';

const LABELS: Record<Action, string> = {
  new: 'New word',
  got: 'Got it!',
  skip: 'Skip',
  missed: 'Missed',
  next: 'Next word',
};

function load(store: () => Storage, key: string): unknown {
  try {
    const raw = store().getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function save(store: () => Storage, key: string, value: unknown): void {
  try {
    store().setItem(key, JSON.stringify(value));
  } catch {
    /* not remembered; the page works the same */
  }
}

const local = () => localStorage;
const session = () => sessionStorage;

/**
 * The mix a link asked for (the kids page links to one): read from the
 * address, which is then tidied, as there it would win over every choice
 * made here at each refresh; or, after a refresh, from this tab's storage.
 */
function takeLinked(): LinkedOptions {
  const url = new URL(location.href);
  if (!LINK_PARAMS.some((k) => url.searchParams.has(k))) return readLinked(load(session, LINK_KEY));
  const linked = readLinked({ packs: url.searchParams.get('packs'), level: url.searchParams.get('level') });
  save(session, LINK_KEY, linked);
  for (const k of LINK_PARAMS) url.searchParams.delete(k);
  try {
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  } catch {
    /* the address keeps them: harmless, they were read */
  }
  return linked;
}

/** Writes only real changes: rewriting a live region with the same words can make it speak again. */
function setText(el: Element, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

function emoji(char: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.setAttribute('aria-hidden', 'true');
  span.textContent = char;
  return span;
}

/** Restarts a CSS animation that runs when a class is added. */
function replay(el: HTMLElement, className: string): void {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

/** A segmented control's radios: click, and arrow keys that move the choice, as in a native radio group. */
function wireRadios(group: HTMLElement, onPick: (value: string) => void): void {
  group.addEventListener('click', (e) => {
    const radio = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('[role="radio"]') : null;
    if (radio?.dataset.value !== undefined) onPick(radio.dataset.value);
  });
  group.addEventListener('keydown', (e) => {
    const all = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const at = all.findIndex((r) => r === e.target);
    const to = at < 0 ? null : stepIndex(e.key, at, all.length);
    if (to === null) return;
    e.preventDefault();
    const radio = all[to];
    radio?.focus();
    if (radio?.dataset.value !== undefined) onPick(radio.dataset.value);
  });
}

/** Marks the chosen radio. Only it is in the tab order, as in a native radio group. */
function setRadios(group: HTMLElement, value: string): void {
  for (const radio of group.querySelectorAll<HTMLButtonElement>('[role="radio"]')) {
    const on = radio.dataset.value === value;
    radio.classList.toggle('on', on);
    radio.setAttribute('aria-checked', String(on));
    radio.tabIndex = on ? 0 : -1;
  }
}

function mount(root: HTMLElement): void {
  const $ = <T extends HTMLElement = HTMLElement>(name: string): T => {
    const el = root.querySelector<T>(`[data-gen="${name}"]`);
    if (!el) throw new Error(`generator: the page has no [data-gen="${name}"]`);
    return el;
  };
  const card = $('card');
  const stage = card.querySelector<HTMLElement>('.gen-stage') ?? card;
  const text = $('text');
  const meta = $('meta');
  const secretBox = $<HTMLInputElement>('secret');
  const showBtn = $<HTMLButtonElement>('show');
  const copyBtn = $<HTMLButtonElement>('copy');
  const primary = $<HTMLButtonElement>('primary');
  const secondary = $<HTMLButtonElement>('secondary');
  const noteEl = $('note');
  const clockBtn = $<HTMLButtonElement>('clock');
  const clockText = $('clock-text');
  const timerGroup = $('timer');
  const soundBtn = $<HTMLButtonElement>('sound');
  const bar = $('bar');
  const fill = $('fill');
  const summary = $<HTMLButtonElement>('summary');
  const sumPacks = $('sum-packs');
  const sumRest = $('sum-rest');
  const panel = root.querySelector<HTMLElement>('.gen-panel') ?? summary;
  const packBox = $('packs');
  const levelGroup = $('level');
  const countEl = $('count');
  const scoreBox = $<HTMLInputElement>('score');
  const teamsEl = $('teams');
  const passBtn = $<HTMLButtonElement>('pass');
  const resetBtn = $<HTMLButtonElement>('reset');
  const recentRow = $('recent-row');
  const recentList = $('recent');
  const live = $('live');
  const playLink = document.querySelector<HTMLAnchorElement>('[data-gen="play"]');
  const tiles = [...teamsEl.querySelectorAll<HTMLElement>('.gen-team')].slice(0, 2);

  /* ------------------------------------------------------------ state */

  // A link's mix is for this visit: it is remembered for good only once
  // something is changed here, like any other choice on show.
  const linked = takeLinked();
  let linkKept = Object.keys(linked).length > 0;
  const options: GeneratorOptions = { ...readOptions(load(local, OPTIONS_KEY)), ...linked };
  // After a refresh the game carries on without dealing its words again; a
  // different mix starts afresh.
  const picks = readPicks(load(session, SEEN_KEY), mixKey(options.packs, options.level));
  const picker = new Picker(Math.random, picks ?? undefined);
  let phase: Phase = 'ready';
  let word: Word | null = null;
  let recent: Word[] = [];
  /** Show word is pressed: the hidden word stays in view. */
  let shown = false;
  /** The card is being held down. */
  let peeking = false;
  let score: Score = newScore();
  let scoring = false;
  const savedScore = load(session, SCORE_KEY);
  const restored = readScore(savedScore);
  if (restored) {
    score = restored;
    scoring = (savedScore as { on?: unknown }).on === true;
  }

  /** The turn's clock: when it runs out (running), or what was left (paused). */
  let clock: 'idle' | 'running' | 'paused' = 'idle';
  let endsAt = 0;
  let leftMs = 0;
  let ticker = 0;
  let lastSecond = 0;

  const currentMix = () => mix(options.packs, options.level);
  const saveOptions = () => {
    save(local, OPTIONS_KEY, options);
    // Remembered with the rest now, so a refresh needs the link's mix no more.
    if (linkKept) {
      save(session, LINK_KEY, null);
      linkKept = false;
    }
  };
  const saveScore = () => save(session, SCORE_KEY, { ...score, on: scoring });
  /** After each pick, and when the mix changes, so a refresh carries on with it. */
  const savePicks = () => save(session, SEEN_KEY, { mix: mixKey(options.packs, options.level), ...picker.picks() });
  /** In Secret mode a word is covered for its turn, unless Show word is pressed. */
  const wordHidden = () => options.secret && phase === 'turn' && word !== null && !shown;

  /* --------------------------------------------------------- feedback */

  let announceTimer = 0;
  /** Said by screen readers. Emptied first, so the same words twice are heard twice. */
  function announce(message: string): void {
    live.textContent = '';
    clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => (live.textContent = message), 60);
  }

  function note(message: string | null): void {
    noteEl.textContent = message ?? '';
    noteEl.hidden = !message;
  }

  /** Hides a control; one that had focus hands it to the main button, not to the page. */
  function setHidden(el: HTMLElement, hide: boolean): void {
    const focused = document.activeElement === el;
    el.hidden = hide;
    if (hide && focused) primary.focus({ preventScroll: true });
  }

  function setDisabled(el: HTMLButtonElement, off: boolean): void {
    const focused = document.activeElement === el;
    el.disabled = off;
    if (off && focused && el !== primary) primary.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------ the word card */

  /**
   * The biggest size at which the word fits the card on one or two lines,
   * found by trying: words run from "DJ" to "a meeting that could have been
   * an email", and the letters' widths vary too much to work it out.
   */
  function fitWord(): void {
    text.style.fontSize = '';
    if (!word) return;
    const max = parseFloat(getComputedStyle(text).fontSize);
    const fits = (px: number) => {
      text.style.fontSize = `${px}px`;
      return text.scrollWidth <= text.clientWidth + 1 && text.scrollHeight <= px * LINE_HEIGHT * 2 + 2;
    };
    if (!max || fits(max)) {
      text.style.fontSize = '';
      return;
    }
    let lo = 14;
    let hi = max;
    while (hi - lo > 0.5) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    text.style.fontSize = `${Math.floor(lo)}px`;
  }

  /** Puts the word (and its pack and rating) on the card. */
  function renderWord(): void {
    if (word) {
      const info = wordInfo(word, options.packs);
      text.textContent = word.text;
      meta.replaceChildren(...(info.emoji ? [emoji(info.emoji), ' '] : []), `${info.pack} · ${info.tier}`);
    }
    card.classList.toggle('empty', !word);
    fitWord();
  }

  function renderCard(): void {
    card.classList.toggle('secret', options.secret && word !== null);
    card.classList.toggle('covered', wordHidden() && !peeking);
    card.classList.toggle('peeking', peeking);
    card.classList.toggle('timeup', phase === 'timeup');
    secretBox.checked = options.secret;
    setHidden(showBtn, !(options.secret && word !== null && phase === 'turn'));
    showBtn.setAttribute('aria-pressed', String(shown));
    showBtn.classList.toggle('on', shown);
    // Copying is for a word on show; a hidden one stays on the phone.
    setHidden(copyBtn, word === null || options.secret);
  }

  /* ----------------------------------------------------------- buttons */

  const actions = (): { primary: Action; secondary: Action | null } => {
    if (phase === 'turn') return { primary: 'got', secondary: 'skip' };
    if (phase === 'timeup') return scoring ? { primary: 'got', secondary: 'missed' } : { primary: 'next', secondary: null };
    return { primary: 'new', secondary: null };
  };

  let primaryAction: Action = actions().primary;
  let secondaryAction: Action | null = actions().secondary;
  let primaryChanged = -Infinity;
  let secondaryChanged = -Infinity;

  function renderButtons(count: number): void {
    const now = performance.now();
    const a = actions();
    if (a.primary !== primaryAction) {
      primaryAction = a.primary;
      primaryChanged = now;
    }
    if (a.secondary !== secondaryAction) {
      secondaryAction = a.secondary;
      secondaryChanged = now;
    }
    // Once time is up the shout is over: "Got it", calmly.
    setText(primary, phase === 'timeup' && a.primary === 'got' ? 'Got it' : LABELS[a.primary]);
    primary.disabled = (a.primary === 'new' || a.primary === 'next') && count === 0;
    if (a.secondary) setText(secondary, LABELS[a.secondary]);
    setHidden(secondary, a.secondary === null);
  }

  function run(action: Action): void {
    switch (action) {
      case 'new':
      case 'next':
        return startTurn();
      case 'skip':
        return skip();
      case 'got':
        return endTurn(true);
      case 'missed':
        return endTurn(false);
    }
  }

  /* ------------------------------------------------------------- turns */

  /** The next word from the mix; false when nothing matches. */
  function pick(): boolean {
    const from = currentMix();
    const next = picker.next(from);
    if (!next) {
      note('No words match. Switch on another pack or pick Any.');
      return false;
    }
    savePicks();
    if (word) recent = [word, ...recent.filter((w) => w !== word)].slice(0, RECENT_MAX);
    word = next.word;
    shown = false;
    peeking = false;
    note(next.reshuffled ? `You've had all ${wordCount(from.length)} in this mix. Shuffling them for another round.` : null);
    return true;
  }

  /** A new word is on the card: size it, pop it in, and say it (or that it is hidden). */
  function present(): void {
    render();
    renderWord();
    replay(stage, 'pop');
    if (!word) return;
    const intro = noteEl.hidden ? '' : `${noteEl.textContent ?? ''} `;
    if (wordHidden()) {
      announce(`${intro}New word ready, hidden`);
    } else {
      const info = wordInfo(word, options.packs);
      announce(`${intro}${word.text}. ${info.pack}, ${info.tier}.`);
    }
  }

  function startTurn(): void {
    // iOS starts audio only inside a tap, so this tap readies the buzzer for later.
    sfx.unlock();
    if (!pick()) return render();
    phase = 'turn';
    card.classList.remove('flash');
    if (options.timer > 0) startClock(options.timer * 1000);
    else stopClock();
    present();
  }

  /** A different word for the same turn: the clock carries on. */
  function skip(): void {
    sfx.unlock();
    if (!pick()) return render();
    present();
  }

  function endTurn(got: boolean): void {
    if (!word) return;
    stopClock();
    const said = word.text;
    let message = got ? `Got it: ${said}.` : `Missed: ${said}.`;
    if (scoring) {
      const team = score.turn;
      if (got) {
        const points = pointsFor(word);
        score = scoreTurn(score, points);
        bump(team);
        message = `${score.names[team]} scores ${points} ${points === 1 ? 'point' : 'points'} for ${said}.`;
      } else {
        score = passTurn(score);
        message = `No points. The word was ${said}.`;
      }
      message += ` ${score.names[score.turn]}'s turn.`;
      saveScore();
    }
    phase = 'ready';
    shown = false;
    peeking = false;
    card.classList.remove('flash');
    render();
    announce(message);
  }

  function timeUp(): void {
    stopClock();
    phase = 'timeup';
    shown = false;
    peeking = false;
    sfx.timeUp();
    render();
    // For a phone on silent: the card flashes, then stays pink.
    replay(card, 'flash');
    announce(word ? `Time's up. The word was ${word.text}.` : "Time's up.");
  }

  /* ------------------------------------------------------------- clock */

  let wake: WakeLockSentinel | null = null;
  let wantAwake = false;
  let asking = false;

  /** The screen stays on while the clock runs, where the browser allows it. */
  async function takeWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator) || document.hidden || asking || (wake && !wake.released)) return;
    asking = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (wantAwake) wake = lock;
      else void lock.release().catch(() => undefined);
    } catch {
      /* refused (low battery, a policy): the clock runs anyway */
    } finally {
      asking = false;
    }
  }

  function keepAwake(on: boolean): void {
    wantAwake = on;
    if (on) {
      void takeWakeLock();
    } else if (wake) {
      void wake.release().catch(() => undefined);
      wake = null;
    }
  }

  // Browsers drop the lock when the page is hidden: take it again on return.
  document.addEventListener('visibilitychange', () => {
    if (wantAwake && !document.hidden) void takeWakeLock();
  });

  function startClock(ms: number): void {
    leftMs = ms;
    runClock();
  }

  function runClock(): void {
    clock = 'running';
    endsAt = performance.now() + leftMs;
    lastSecond = Math.ceil(leftMs / 1000);
    clearInterval(ticker);
    ticker = window.setInterval(tick, 200);
    keepAwake(true);
  }

  function pauseClock(): void {
    leftMs = Math.max(0, endsAt - performance.now());
    clock = 'paused';
    clearInterval(ticker);
    keepAwake(false);
  }

  function stopClock(): void {
    clock = 'idle';
    leftMs = 0;
    clearInterval(ticker);
    keepAwake(false);
  }

  function tick(): void {
    const ms = endsAt - performance.now();
    if (ms <= 0) return timeUp();
    const seconds = Math.ceil(ms / 1000);
    if (seconds !== lastSecond) {
      lastSecond = seconds;
      if (seconds <= TICK_SECONDS) sfx.tick();
      if (seconds === HURRY_SECONDS) announce('10 seconds left');
    }
    renderClock();
  }

  function renderClock(): void {
    const total = options.timer * 1000;
    const timed = total > 0;
    const counting = timed && phase === 'turn' && clock !== 'idle';
    const running = counting && clock === 'running';
    const msLeft = clock === 'running' ? Math.max(0, endsAt - performance.now()) : leftMs;
    const seconds = counting ? Math.ceil(msLeft / 1000) : phase === 'timeup' ? 0 : options.timer;
    setText(clockText, timed ? String(seconds) : '⏱');
    setDisabled(clockBtn, !counting);
    clockBtn.classList.toggle('idle', !running && !(timed && phase === 'timeup'));
    clockBtn.classList.toggle('running', running);
    clockBtn.classList.toggle('paused', counting && clock === 'paused');
    clockBtn.classList.toggle('done', timed && phase === 'timeup');
    clockBtn.classList.toggle('hurry', running && seconds <= HURRY_SECONDS);
    clockBtn.setAttribute(
      'aria-label',
      !timed
        ? 'Timer off'
        : running
          ? 'Pause the timer'
          : counting
            ? `Resume the timer, ${seconds} seconds left`
            : phase === 'timeup'
              ? "Time's up"
              : `Timer: ${options.timer} seconds a turn`,
    );
    clockBtn.title = running ? 'Pause' : counting ? 'Resume' : '';
    bar.classList.toggle('off', !timed);
    bar.classList.toggle('hurry', counting && seconds <= HURRY_SECONDS);
    const left = !timed || phase === 'timeup' ? 0 : counting ? msLeft / total : 1;
    fill.style.setProperty('--left', String(Math.min(1, Math.max(0, left))));
  }

  /* ----------------------------------------------------------- options */

  /** The chips, made once from the packs the game has: the page's copy may be out of date. */
  function buildPacks(): void {
    const existing = new Map(
      [...packBox.querySelectorAll<HTMLButtonElement>('[data-pack]')].map((b) => [b.dataset.pack, b]),
    );
    packBox.replaceChildren(
      ...PACKS.map((p) => {
        let chip = existing.get(p.id);
        if (!chip) {
          chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'chip';
        }
        chip.dataset.pack = p.id;
        chip.replaceChildren(emoji(p.emoji), ` ${p.label}`);
        return chip;
      }),
    );
  }

  /** In place, so a chip being pressed from the keyboard keeps its focus. */
  function renderPacks(): void {
    for (const chip of packBox.querySelectorAll<HTMLButtonElement>('[data-pack]')) {
      const on = options.packs.includes(chip.dataset.pack as WordPackId);
      chip.classList.toggle('on', on);
      chip.setAttribute('aria-pressed', String(on));
    }
  }

  function renderMix(count = currentMix().length): void {
    setText(countEl, count ? `${wordCount(count)} in the mix` : 'No words match. Switch on another pack or pick Any.');
    const s = mixSummary(options.packs, options.level, count);
    setText(sumPacks, s.packs);
    setText(sumRest, `· ${s.level} · ${s.count}`);
    if (playLink) playLink.href = presetHref({ packs: options.packs, difficulty: ROOM_DIFFICULTY[options.level] });
  }

  let countTimer = 0;
  /** A word about the options where the count goes, then the count again. */
  function countSays(message: string): void {
    setText(countEl, message);
    clearTimeout(countTimer);
    countTimer = window.setTimeout(() => renderMix(), FEEDBACK_MS);
  }

  /* ------------------------------------------------------------- score */

  const teamName = (t: Team) => score.names[t];

  function bump(t: Team): void {
    const el = tiles[t]?.querySelector<HTMLElement>('.gen-points');
    if (el) replay(el, 'pop');
  }

  function renderScore(): void {
    scoreBox.checked = scoring;
    teamsEl.hidden = !scoring;
    tiles.forEach((tile, i) => {
      const t = i as Team;
      const name = teamName(t);
      tile.classList.toggle('turn', score.turn === t);
      const input = tile.querySelector('input');
      if (input && document.activeElement !== input) input.value = name;
      const points = tile.querySelector('[data-points]');
      if (points) setText(points, String(score.points[t]));
      // Each name starts with what the button shows, so "click +1" works by voice.
      const minus = tile.querySelector<HTMLButtonElement>('[data-adjust="-1"]');
      if (minus) {
        minus.setAttribute('aria-label', `−1 for ${name}`);
        // Dimmed at nothing, not disabled: disabling the button that was
        // just pressed would drop keyboard focus to the page.
        minus.setAttribute('aria-disabled', String(score.points[t] === 0));
      }
      tile.querySelector('[data-adjust="1"]')?.setAttribute('aria-label', `+1 for ${name}`);
    });
  }

  /* ------------------------------------------------------------ recent */

  function renderRecent(): void {
    const words = recent.filter((w) => w !== word);
    // Not in Secret mode: the guessers are looking at this screen too.
    recentRow.hidden = options.secret || words.length === 0;
    recentList.replaceChildren(
      ...words.map((w) => {
        const li = document.createElement('li');
        li.textContent = w.text;
        return li;
      }),
    );
  }

  /* -------------------------------------------------------------- all */

  function renderSound(): void {
    const on = soundEnabled();
    soundBtn.textContent = on ? '🔊' : '🔇';
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.title = on ? 'Mute sounds' : 'Turn sounds on';
  }

  function render(): void {
    const count = currentMix().length;
    renderCard();
    renderButtons(count);
    renderClock();
    renderPacks();
    renderMix(count);
    renderScore();
    renderRecent();
  }

  /* ------------------------------------------------------------- input */

  /**
   * A click leaves the turn buttons without focus, so N works after it (N is
   * ignored on a focused control). Keys keep focus where it is: detail is 0
   * for Enter and Space, which then go on pressing the same button.
   */
  const letGo = (e: MouseEvent, button: HTMLButtonElement) => {
    if (e.detail > 0) button.blur();
  };
  primary.addEventListener('click', (e) => {
    letGo(e, primary);
    if (performance.now() - primaryChanged < SETTLE_MS) return;
    run(primaryAction);
  });
  secondary.addEventListener('click', (e) => {
    letGo(e, secondary);
    if (secondaryAction === null || performance.now() - secondaryChanged < SETTLE_MS) return;
    run(secondaryAction);
  });

  // N for a new word (mid-turn, a skip), unless a control has the key.
  document.addEventListener('keydown', (e) => {
    if (!isNewWordKey(e)) return;
    if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return;
    const action: Action | null = phase === 'turn' ? 'skip' : phase === 'ready' ? 'new' : scoring ? null : 'next';
    if (!action) return;
    e.preventDefault();
    run(action);
  });

  // Press and hold to peek at a hidden word.
  let peekTimer = 0;
  card.addEventListener('pointerdown', (e) => {
    if (!wordHidden() || !e.isPrimary || e.button !== 0) return;
    try {
      card.setPointerCapture(e.pointerId);
    } catch {
      /* letting go still ends the peek */
    }
    clearTimeout(peekTimer);
    peekTimer = window.setTimeout(() => {
      peeking = true;
      renderCard();
    }, PEEK_DELAY_MS);
  });
  const endPeek = () => {
    clearTimeout(peekTimer);
    if (!peeking) return;
    peeking = false;
    renderCard();
  };
  card.addEventListener('pointerup', endPeek);
  card.addEventListener('pointercancel', endPeek);
  card.addEventListener('lostpointercapture', endPeek);
  // A long press would open the browser's menu over the word.
  card.addEventListener('contextmenu', (e) => {
    if (card.classList.contains('secret')) e.preventDefault();
  });

  secretBox.addEventListener('change', () => {
    options.secret = secretBox.checked;
    shown = false;
    peeking = false;
    saveOptions();
    render();
  });

  showBtn.addEventListener('click', () => {
    shown = !shown;
    render();
    if (shown && word) announce(word.text);
  });

  let copyTimer = 0;
  copyBtn.addEventListener('click', () => {
    if (!word) return;
    void copyText(word.text).then((ok) => {
      copyBtn.textContent = ok ? 'Copied' : "Couldn't copy";
      announce(ok ? 'Copied' : "Couldn't copy the word");
      clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => (copyBtn.textContent = 'Copy word'), FEEDBACK_MS);
    });
  });

  clockBtn.addEventListener('click', () => {
    if (phase !== 'turn' || options.timer === 0) return;
    if (clock === 'running') {
      pauseClock();
      announce('Timer paused');
    } else if (clock === 'paused') {
      sfx.unlock();
      runClock();
      announce('Timer running');
    }
    render();
  });

  wireRadios(timerGroup, (value) => {
    const seconds = Number(value);
    if (!TIMER_CHOICES.includes(seconds)) return;
    setRadios(timerGroup, value);
    sfx.unlock();
    if (seconds === options.timer) return;
    options.timer = seconds;
    saveOptions();
    // Mid-turn the new length starts now; Off lets the turn run on untimed.
    if (phase === 'turn') {
      if (seconds > 0) startClock(seconds * 1000);
      else stopClock();
    }
    render();
  });

  soundBtn.addEventListener('click', () => {
    toggleSound();
    renderSound();
  });

  summary.addEventListener('click', () => {
    const open = summary.getAttribute('aria-expanded') !== 'true';
    summary.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('open', open);
  });

  packBox.addEventListener('click', (e) => {
    const chip = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('[data-pack]') : null;
    if (!chip) return;
    const id = chip.dataset.pack as WordPackId;
    const on = options.packs.includes(id);
    if (on && options.packs.length === 1) return countSays('Keep at least one pack on.');
    options.packs = cleanPacks(on ? options.packs.filter((p) => p !== id) : [...options.packs, id]);
    saveOptions();
    savePicks();
    render();
  });

  wireRadios(levelGroup, (value) => {
    if (!isLevel(value)) return;
    setRadios(levelGroup, value);
    if (value === options.level) return;
    options.level = value;
    saveOptions();
    savePicks();
    render();
  });

  scoreBox.addEventListener('change', () => {
    scoring = scoreBox.checked;
    saveScore();
    render();
  });

  tiles.forEach((tile, i) => {
    const t = i as Team;
    const input = tile.querySelector('input');
    if (input) {
      input.addEventListener('change', () => {
        const names: [string, string] = [score.names[0], score.names[1]];
        names[t] = cleanTeamName(input.value, t);
        score = { ...score, names };
        input.value = names[t];
        saveScore();
        renderScore();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
    }
    tile.addEventListener('click', (e) => {
      const btn = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('[data-adjust]') : null;
      if (!btn) return;
      const next = adjustScore(score, t, Number(btn.dataset.adjust));
      // −1 at nothing still takes a press (it keeps focus): say why nothing changed.
      if (next.points[t] === score.points[t]) return announce(`No points to take from ${teamName(t)}`);
      score = next;
      saveScore();
      renderScore();
      bump(t);
      announce(`${teamName(t)}: ${score.points[t]}`);
    });
  });

  passBtn.addEventListener('click', () => {
    score = passTurn(score);
    saveScore();
    renderScore();
    announce(`${teamName(score.turn)}'s turn`);
  });

  // Two taps, like the game's Restart: an evening's score is a lot to lose to one.
  let resetTimer = 0;
  const disarm = () => {
    clearTimeout(resetTimer);
    resetTimer = 0;
    resetBtn.textContent = 'Reset scores';
    resetBtn.classList.remove('accent');
    resetBtn.removeAttribute('aria-label');
  };
  resetBtn.addEventListener('click', () => {
    if (!resetTimer) {
      resetBtn.textContent = 'Sure? Reset';
      resetBtn.classList.add('accent');
      // Named as it reads, so saying "click Sure Reset" works by voice.
      resetBtn.setAttribute('aria-label', 'Sure? Reset scores');
      resetTimer = window.setTimeout(disarm, 3000);
      return;
    }
    disarm();
    score = newScore(score.names);
    saveScore();
    renderScore();
    announce(`Scores reset. ${teamName(score.turn)}'s turn.`);
  });

  // The word fits the card at whatever width it has, and again once the
  // display font arrives (until then it was measured in a fallback).
  let fittedWidth = 0;
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      if (Math.abs(width - fittedWidth) < 0.5) return;
      fittedWidth = width;
      fitWord();
    }).observe(stage);
  } else {
    window.addEventListener('resize', fitWord);
  }
  void document.fonts?.ready.then(fitWord);
  document.fonts?.addEventListener?.('loadingdone', fitWord);

  /* ------------------------------------------------------------- start */

  setRadios(timerGroup, String(options.timer));
  setRadios(levelGroup, options.level);
  buildPacks();
  renderSound();
  render();
  // Live from now on: the count changes with the options, not on arrival.
  countEl.setAttribute('aria-live', 'polite');
}

const root = document.querySelector<HTMLElement>('.gen');
if (root) mount(root);
