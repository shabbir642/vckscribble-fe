import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  MAX_TEAMS,
  MIN_TEAMS,
  TEAMS,
  guessKey,
  type ChatMessage,
  type GameSummary,
  type Player,
  type Reaction,
  type Stroke,
  type Team,
  type TeamId,
} from '../generated/contract';
import type { RoomSnapshot } from '../hooks/useRoom';
import { callAttention } from '../lib/attention';
import { sfx } from '../lib/sound';
import { Avatar } from './Avatar';
import { Board } from './Board';
import { Chat } from './Chat';
import { Finale, type GameResults } from './Finale';
import { InviteLink } from './InviteLink';
import { Reactions } from './Reactions';
import { Scores, TeamBar, TeamChip, type GameTeam } from './Scores';
import { ShareSheet } from './ShareSheet';
import { WordPicker } from './WordPicker';

interface Props {
  room: RoomSnapshot;
  /** False while reconnecting: drawing and guessing pause until the seat is back. */
  online: boolean;
  messages: ChatMessage[];
  wordOptions: { choices: { id: number; text: string; drawability: 1 | 2 | 3 }[]; allowCustom: boolean } | null;
  assignedWord: string | null;
  secondsLeft: number;
  closeHint: string | null;
  /** Set once the game's final scores are in (the final scoreboard, then the end). */
  finalScores: Player[] | null;
  /** The server's summary of the game just ended. */
  summary: GameSummary | null;
  /** The last game's results, kept (by App, through the lobby) until the next summary. */
  results: GameResults | null;
  busy: boolean;
  onChoose: (id: number) => void;
  onCustom: (text: string) => void;
  onGuess: (text: string) => void;
  onReport: () => void;
  onDrawStart: (s: Stroke) => void;
  onDrawAppend: (id: string, points: number[]) => void;
  onUndo: () => void;
  onClear: () => void;
  onLeave: () => void;
  isHost: boolean;
  onPlayAgain: () => void;
  /** Host: back to the lobby, mid-game or from the podium. */
  onRestart: () => void;
  reactionFeed: { id: number; reaction: Reaction; name: string }[];
  myReaction: Reaction | null;
  onReact: (r: Reaction) => void;
  onKick: (playerId: string) => void;
}

/** Letter counts per word of a masked phrase: "_ _ _   _ _" -> "3, 2". */
function wordLengths(masked: string): string {
  return masked
    .split(/\s{3,}/)
    .map((w) => w.replace(/\s/g, '').length)
    .join(', ');
}

/**
 * A word or phrase for the strip, one unbreakable span per word: a long phrase
 * wraps between its words on a narrow screen instead of running off the edge
 * (a masked word is a run of spaced blanks, which would otherwise never wrap).
 */
function Words({ text, masked = false }: { text: string; masked?: boolean }) {
  const words = masked ? text.split(/\s{3,}/) : text.split(/\s+/);
  return (
    <>
      {words.map((w, i) => (
        <span key={i} className="mask-word">{w}</span>
      ))}
    </>
  );
}

const ranked = (players: Player[]) => [...players].sort((a, b) => b.score - a.score);

/** Messages newer than `id` (all of them if it has scrolled out of the kept 200). */
function countAfter(messages: ChatMessage[], id: string | null): number {
  const i = id === null ? -1 : messages.findIndex((m) => m.id === id);
  return i === -1 ? messages.length : messages.length - 1 - i;
}

/**
 * A ranked list on the canvas: past five players, two columns read top to
 * bottom (1–5, then 6–10), so a full room fits on the drawing without scrolling.
 */
function listProps(n: number): { className?: string; style?: CSSProperties } {
  return n > 5 ? { className: 'cols', style: { '--rows': Math.ceil(n / 2) } as CSSProperties } : {};
}

/**
 * Past this many players present, a classic reveal lists only who scored (and
 * you): thirty rows of zeros buried the news in the four seconds it is up.
 * Rooms this big didn't exist before, so smaller ones keep every row.
 */
const BIG_ROOM = 16;

/* ----------------------------------------------------------------- teams */

/** "Team Mango" -> "Mango", for where there is room for one word. */
const shortName = (name: string) => name.replace(/^team\s+/i, '') || name;

/**
 * The game's teams as the screen shows them, in TEAMS order: the room's names
 * and scores on TEAMS' emoji and colours. The room's list always comes with
 * its state; the count from the settings only keeps a server that sent none
 * (one from before teams) from showing no teams at all.
 */
function gameTeams(teams: Team[], teamCount: number): GameTeam[] {
  const known = new Map(teams.map((t) => [t.id, t]));
  const count = Math.min(MAX_TEAMS, Math.max(MIN_TEAMS, teamCount ?? MIN_TEAMS));
  return TEAMS.filter((def, i) => (known.size ? known.has(def.id) : i < count)).map((def) => {
    const name = known.get(def.id)?.name ?? def.name;
    return {
      id: def.id,
      name,
      short: shortName(name),
      emoji: def.emoji,
      colour: def.colour,
      score: known.get(def.id)?.score ?? 0,
    };
  });
}

/** Best first, each with its place: equal scores share one (1, 1, 3). */
function standings(teams: GameTeam[]): { team: GameTeam; rank: number }[] {
  const best = [...teams].sort((a, b) => b.score - a.score);
  return best.map((team) => ({ team, rank: 1 + best.filter((t) => t.score > team.score).length }));
}

/** The server's line as the host starts a game: whoever saw it was there from the start. */
const isGameStart = (m: ChatMessage) => m.channel === 'system' && m.text.startsWith('Game starting');

/** How a team's turn ended. */
type TurnEnd = 'got' | 'time' | 'left' | 'alone';

/** The server's line as a team's turn ends, each way it can ("Time's up! Nobody on Team Mango got “samosa”."). */
const TURN_END_LINES: [TurnEnd, RegExp][] = [
  ['time', /^Time's up! Nobody on .+ got “.+”\.$/],
  ['left', /^The drawer left\. The word was “.+”\.$/],
  ['alone', /^Nobody on .+ is left to guess\.(?: The word was “.+”\.)?$/],
  ['got', /^.+ got it! The word was “.+”\.$/],
];

/**
 * How the server says this turn ended: the newest of its turn-end lines, if
 * it is this turn's (it names this turn's word, or this team when the turn
 * ended before a word was chosen). Null until the line comes, a moment after
 * the reveal, and for a turn it has none for (the drawer left while choosing).
 */
function serverTurnEnd(messages: ChatMessage[], team: string, word: string | null): TurnEnd | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.channel !== 'system') continue;
    const end = TURN_END_LINES.find(([, line]) => line.test(m.text))?.[0];
    if (!end) continue;
    const thisTurn =
      word === null ? m.text === `Nobody on ${team} is left to guess.` : m.text.endsWith(`“${word}”.`);
    return thisTurn ? end : null;
  }
  return null;
}

/** A combining accent, as NFD splits it off a letter ("é" is "e" and U+0301). */
const isMark = (ch: string) => /[\u0300-\u036f]/.test(ch);

/**
 * A message with the word starred out, matched as a guess is (guessKey):
 * "Ice-cream", "ICECREAM" and "ice  cream" all go, and so does a plural. Whole
 * words only, so "cat" leaves "concatenate" alone. For a watcher whose screen
 * keeps the word covered: on a shared screen, the drawing team may be reading.
 */
function starOut(text: string, word: string): string {
  const target = guessKey(word);
  if (!target) return text;
  const chars = [...text];
  // Each character's share of the guess key: one letter or digit, or nothing.
  const keys = chars.map((ch) =>
    ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''),
  );
  // Runs of letters and digits (with their accents): the words to match on.
  const runs: { from: number; to: number; key: string }[] = [];
  let open = false;
  chars.forEach((ch, i) => {
    const last = runs[runs.length - 1];
    if (keys[i]) {
      if (open && last) {
        last.to = i + 1;
        last.key += keys[i];
      } else runs.push({ from: i, to: i + 1, key: keys[i]! });
      open = true;
    } else if (open && last && isMark(ch)) {
      last.to = i + 1;
    } else open = false;
  });
  // The word may run over several of them: "ice cream" is two, "icecream" one.
  const hits: [number, number][] = [];
  for (let i = 0; i < runs.length; i++) {
    let key = '';
    for (let j = i; j < runs.length; j++) {
      key += runs[j]!.key;
      if (key === target || key === `${target}s` || key === `${target}es`) {
        hits.push([runs[i]!.from, runs[j]!.to]);
        i = j;
        break;
      }
      if (!target.startsWith(key)) break;
    }
  }
  if (!hits.length) return text;
  const out = chars.slice();
  for (const [from, to] of hits) {
    for (let k = from; k < to; k++) out[k] = keys[k] ? '*' : isMark(chars[k]!) ? '' : chars[k]!;
  }
  return out.join('');
}

/** Ending everyone's game is one click too many to leave unconfirmed. */
function RestartButton({ onRestart }: { onRestart: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`small ${armed ? 'accent' : ''}`}
      onClick={() => (armed ? onRestart() : setArmed(true))}
      title="End this game for everyone and go back to the lobby"
      aria-label={armed ? 'Confirm restart' : 'Restart the game'}
    >
      {armed ? 'Sure? Restart' : <>↺ <span className="btn-label">Restart</span></>}
    </button>
  );
}

export function Game(p: Props) {
  const { room } = p;
  const phase = room.round.phase;
  const isDrawer = room.round.drawerId === room.youId;
  const drawer = room.players.find((x) => x.id === room.round.drawerId);
  const youGuessed = room.round.guessedPlayerIds.includes(room.youId);

  /* ---------------------------------------------------------------- teams */
  const teamMode = room.settings.mode === 'teams';
  const teams = useMemo(
    () => (teamMode ? gameTeams(room.teams, room.settings.teamCount) : null),
    [teamMode, room.teams, room.settings.teamCount],
  );
  const me = room.players.find((x) => x.id === room.youId);
  const myTeam = teams?.find((t) => t.id === (me?.teamId ?? null)) ?? null;
  // Whose turn it is, from the word choice to the reveal. The round says; the
  // drawer's own team stands in for a round that doesn't.
  const turnPhase = phase === 'selecting' || phase === 'drawing' || phase === 'reveal';
  const upTeamId: TeamId | null = turnPhase ? (room.round.teamId ?? drawer?.teamId ?? null) : null;
  const upTeam = teams?.find((t) => t.id === upTeamId) ?? null;
  /** On the team whose turn it is: the drawer's teammates are the guessers. */
  const onUpTeam = upTeam !== null && myTeam?.id === upTeam.id;
  /** Everyone else in a team game: they get the word, and keep it secret. */
  const watcher = upTeam !== null && !onUpTeam && !isDrawer;
  // A watcher's word starts covered, and every turn covers it again: a screen
  // shared on a call, or a laptop on the meeting-room TV, must not hand the
  // drawing team the answer. Shown for one drawing only, named by when it ends
  // (a page that slept through a turn wakes to the next one covered).
  const drawingTurn = phase === 'drawing' ? `${room.round.round}:${room.round.drawerId}:${room.round.endsAt}` : null;
  const [shownTurn, setShownTurn] = useState<string | null>(null);
  const wordShown = drawingTurn !== null && shownTurn === drawingTurn;

  // Phones: the strip's buttons fold into a menu, leaving the width to the word.
  const [menuOpen, setMenuOpen] = useState(false);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const menuToggle = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: PointerEvent) => {
      if (!stripRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [menuOpen]);

  const canDraw = isDrawer && phase === 'drawing' && p.online;
  // After the game the box is plain chat, as the server treats it outside a
  // live turn: the "gg" and "one more?" that get the next game going.
  const canGuess = p.online && (phase === 'drawing' ? !isDrawer : phase === 'finished');

  /* -------------------------------------------------------------- results */
  const { results } = p;
  // The results open with every game's end, whatever they were left as last
  // time, and over a closed menu.
  const [finaleOpen, setFinaleOpen] = useState(true);
  const [seenPhase, setSeenPhase] = useState(phase);
  // When a reveal came, for how long a team's turn took (see teamStart).
  const [revealedAt, setRevealedAt] = useState<number | null>(null);
  if (seenPhase !== phase) {
    setSeenPhase(phase);
    if (phase === 'reveal') setRevealedAt(Date.now());
    if (phase === 'finished') {
      setFinaleOpen(true);
      setMenuOpen(false);
    }
  }
  // So do another game's results arriving while these are up (a page that
  // slept through a whole game comes back to its end): opened, and afresh, not
  // calm or minimised as these were. Not a first summary, though: the results
  // opened with the phase, and starting them over would replay the opening.
  const summaryId = p.summary?.id ?? null;
  const [seenSummary, setSeenSummary] = useState(summaryId);
  const [finaleKey, setFinaleKey] = useState(0);
  if (seenSummary !== summaryId) {
    setSeenSummary(summaryId);
    if (phase === 'finished' && seenSummary !== null && summaryId !== null) {
      setFinaleOpen(true);
      setMenuOpen(false);
      setFinaleKey((k) => k + 1);
    }
  }
  const finaleShown = phase === 'finished' && finaleOpen;
  /** The last game's share sheet, opened from the strip during the next game. */
  const [lastSheet, setLastSheet] = useState(false);
  const lastShareable =
    phase !== 'finished' && results !== null && results.summary.players.some((x) => x.id === room.youId);

  // It goes when that game's results are replaced, when this game ends, and
  // when it's your turn to draw (it would hide the word choice).
  const resultsId = results?.summary.id;
  useEffect(() => setLastSheet(false), [resultsId]);
  useEffect(() => {
    if (phase === 'finished' || p.wordOptions) setLastSheet(false);
  }, [phase, p.wordOptions]);

  // Everything under a dialog is out of reach: no Tab into it, no screen
  // reader wandering behind. Only the game: the toasts must still be heard.
  const gameRef = useRef<HTMLDivElement | null>(null);
  const blocked = finaleShown || (lastSheet && lastShareable);
  useEffect(() => {
    const el = gameRef.current;
    if (!el) return;
    el.inert = blocked;
    return () => {
      el.inert = false;
    };
  }, [blocked]);

  // The chat badge: messages that arrived while the results covered the chat.
  const lastMessageId = p.messages[p.messages.length - 1]?.id ?? null;
  const readUpTo = useRef(lastMessageId);
  useEffect(() => {
    if (!finaleShown) readUpTo.current = lastMessageId;
  });
  const unread = finaleShown ? countAfter(p.messages, readUpTo.current) : 0;

  // Off to the chat. With a keyboard, straight into the box; on a touch
  // screen that would throw up the keyboard, so onto the way back instead.
  const resultsButton = useRef<HTMLButtonElement | null>(null);
  const focusOnClose = useRef(false);
  const minimise = useCallback(() => {
    focusOnClose.current = true;
    setFinaleOpen(false);
  }, []);
  useEffect(() => {
    if (finaleShown || !focusOnClose.current) return;
    focusOnClose.current = false;
    const typing = window.matchMedia?.('(pointer: fine)').matches
      ? gameRef.current?.querySelector<HTMLInputElement>('.chat input:not(:disabled)')
      : null;
    (typing ?? resultsButton.current)?.focus({ preventScroll: true });
  }, [finaleShown]);

  // Scores as the turn began, so the reveal can show what each player won.
  const turnStart = useRef(new Map<string, number>());
  // A team game's reveal says what the turn won and how fast ("+210 in 9s"):
  // the team's score as the drawing began, and when this page saw it begin.
  // The time is this page's own clock from the drawing's start to its reveal
  // (the server's ticks are whole seconds, and run a second or two behind). A
  // page that missed the start (it arrived mid-turn) or lost its connection
  // on the way leaves the time out rather than show a wrong one.
  const teamStart = useRef<{ drawerId: string | null; teamId: TeamId; score: number; at: number | null } | null>(null);
  const phaseBefore = useRef<string | null>(null);
  useEffect(() => {
    const before = phaseBefore.current;
    phaseBefore.current = phase;
    if (phase === 'drawing') {
      turnStart.current = new Map(room.players.map((x) => [x.id, x.score]));
      teamStart.current = upTeam
        ? {
            drawerId: room.round.drawerId,
            teamId: upTeam.id,
            score: upTeam.score,
            at: p.online && before === 'selecting' ? Date.now() : null,
          }
        : null;
    }
    // Only on entering the drawing phase: score changes mid-turn are the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  useEffect(() => {
    if (!p.online && teamStart.current) teamStart.current.at = null;
  }, [p.online]);

  // "Your team is up!": the sound the drawer gets, for their teammates, as the
  // word is being chosen, and the tab title blinks for anyone off on the call.
  // The first right answer ends the turn, so a teammate who looks up late has
  // missed it. Once a turn: a reconnect mid-choice doesn't sound it again.
  const cuedTurn = useRef<string | null>(null);
  const upEmoji = upTeam?.emoji;
  useEffect(() => {
    if (phase !== 'selecting' || !onUpTeam || isDrawer || !upEmoji || !p.online) return;
    const turn = `${room.round.round}:${room.round.drawerId}:${room.round.endsAt}`;
    if (cuedTurn.current === turn) return;
    cuedTurn.current = turn;
    sfx.yourTurn();
    callAttention(`${upEmoji} Your team is up!`);
  }, [phase, onUpTeam, isDrawer, upEmoji, p.online, room.round.round, room.round.drawerId, room.round.endsAt]);

  // Someone who joins a team game mid-way is told their team, once. Whether
  // they did is settled as the screen first appears: everyone who was in the
  // room when the game began has its "Game starting…" line, a page back from
  // a refresh is still offline (its seat isn't back yet), and anyone joining
  // between games hears of their team on the results.
  const [joinedMidGame] = useState(
    () => p.online && phase !== 'finished' && !p.messages.some(isGameStart),
  );
  const [joinedTeam, setJoinedTeam] = useState<GameTeam | null>(null);
  const toldTeam = useRef(false);
  useEffect(() => {
    if (!joinedMidGame || !myTeam || toldTeam.current) return;
    toldTeam.current = true;
    setJoinedTeam(myTeam);
  }, [joinedMidGame, myTeam]);
  useEffect(() => {
    if (!joinedTeam) return;
    const t = setTimeout(() => setJoinedTeam(null), 5000);
    return () => clearTimeout(t);
  }, [joinedTeam]);

  // While a watcher's word is covered, so is the word in the watchers' chat on
  // this screen.
  const covering = watcher && phase === 'drawing' && !wordShown ? p.assignedWord : null;
  const messages = useMemo(() => {
    if (!covering) return p.messages;
    return p.messages.map((m) => {
      if (m.channel !== 'watchers') return m;
      const text = starOut(m.text, covering);
      return text === m.text ? m : { ...m, text };
    });
  }, [p.messages, covering]);

  // Short: on a phone the guess box is half the screen's width.
  const placeholder = !p.online
    ? 'Reconnecting…'
    : canDraw
      ? 'No chat while drawing'
      : phase === 'finished'
        ? 'Say gg, or ask for a rematch'
        : watcher && upTeam && phase === 'drawing'
          ? `${upTeam.short} can’t see this 👀`
          : watcher && phase === 'selecting'
            ? 'You can chat once they start drawing'
            : youGuessed
              ? 'Chat with the solvers'
              : phase === 'drawing'
                ? 'Type your guess…'
                : 'Guessing starts soon';

  /* ---------------------------------------------------------- word strip */
  let center: ReactNode = null;
  if (phase === 'drawing' && isDrawer && p.assignedWord) {
    // On a call the drawer could simply say it.
    center = (
      <>
        <div className="hint-label">{teamMode ? 'Draw it, don’t say it' : 'Draw this'}</div>
        <div className="mask reveal"><Words text={p.assignedWord} /></div>
      </>
    );
  } else if (phase === 'drawing' && watcher && upTeam && p.assignedWord) {
    // Another team's turn: this team knows the word, under a cover it lifts
    // itself. A phone's strip has two lines, so there the warning takes the
    // first one while the word is showing, and needs no line while it isn't.
    const shh = `Shh! ${upTeam.name} can’t see this`;
    center = (
      <>
        <div className={`hint-label game-team-heading${wordShown ? ' game-team-shown' : ''}`}>
          <span className="game-team-drawing">
            <span aria-hidden="true">{upTeam.emoji} </span>
            {upTeam.name} is drawing
          </span>
          <span className="game-team-shh-alt">{shh}</span>
        </div>
        <div className="game-team-secret">
          {wordShown && <div className="mask reveal"><Words text={p.assignedWord} /></div>}
          <button
            type="button"
            className={wordShown ? 'small game-team-show on' : 'small game-team-show'}
            aria-pressed={wordShown}
            onClick={() => setShownTurn(wordShown ? null : drawingTurn)}
          >
            <span aria-hidden="true">👀</span> Show word
          </button>
          <span className="game-team-shh">{shh}</span>
        </div>
      </>
    );
  } else if (phase === 'drawing' && youGuessed && p.assignedWord) {
    // Solved: the word itself, not the blanks, for the rest of the turn.
    center = (
      <>
        <div className="hint-label">You got it!</div>
        <div className="mask reveal"><Words text={p.assignedWord} /></div>
      </>
    );
  } else if (phase === 'drawing' && room.round.maskedWord) {
    center = (
      <>
        <div className="hint-label">
          {youGuessed
            ? 'You got it!'
            : onUpTeam
              ? `Your team is up: guess ${drawer ? `${drawer.name}’s` : 'the'} drawing`
              : watcher && upTeam
                ? `${upTeam.name} is drawing`
                : 'Guess this'}
        </div>
        <div className="mask" aria-label={`${wordLengths(room.round.maskedWord)} letters`}>
          <Words text={room.round.maskedWord} masked />
          <span className="word-count">({wordLengths(room.round.maskedWord)})</span>
        </div>
      </>
    );
  } else if ((phase === 'reveal' || phase === 'scoreboard') && room.round.solution) {
    center = (
      <>
        <div className="hint-label">The word was</div>
        <div className="mask reveal"><Words text={room.round.solution} /></div>
      </>
    );
  } else if (phase === 'selecting') {
    const who = drawer?.name ?? 'Someone';
    center = (
      <div className="hint-label">
        {isDrawer
          ? 'Your turn to draw!'
          : onUpTeam
            ? `Your team is up! ${who} is picking a word`
            : watcher && upTeam
              ? `${upTeam.name} is up. ${who} is picking a word`
              : `${who} is picking a word`}
      </div>
    );
  } else if (phase === 'finished') {
    // While the results are minimised, the way back to them.
    center = finaleShown ? (
      <div className="hint-label">Game over</div>
    ) : (
      <button
        type="button"
        ref={resultsButton}
        className="small results-open"
        onClick={() => setFinaleOpen(true)}
        aria-label="Show the results"
      >
        <span aria-hidden="true">🏆</span> Results
      </button>
    );
  }

  const timed = phase === 'drawing' || phase === 'selecting';
  const hurry = phase === 'drawing' && p.secondsLeft > 0 && p.secondsLeft <= 10;

  /* ------------------------------------------------------------ overlays */
  const verdict = (room.round.likes > 0 || room.round.dislikes > 0) && (
    <p className="verdict">
      {drawer?.name ?? 'The drawing'} got 👍 {room.round.likes} &nbsp;👎 {room.round.dislikes}
    </p>
  );
  let overlay: ReactNode = null;
  if (phase === 'drawing') {
    overlay = (
      <Reactions
        likes={room.round.likes}
        dislikes={room.round.dislikes}
        feed={p.reactionFeed}
        mine={p.myReaction}
        canReact={!isDrawer && p.online}
        onReact={p.onReact}
      />
    );
  } else if (phase === 'selecting') {
    overlay = (
      <div className="overlay">
        <div className="overlay-body">
          {isDrawer && p.wordOptions ? (
            <WordPicker
              choices={p.wordOptions.choices}
              allowCustom={p.wordOptions.allowCustom}
              busy={p.busy}
              secondsLeft={p.secondsLeft}
              onChoose={p.onChoose}
              onCustom={p.onCustom}
            />
          ) : upTeam && (onUpTeam || watcher) ? (
            <>
              <TeamChip team={upTeam} />
              {drawer && <Avatar i={drawer.avatar} size={84} />}
              <h2>{onUpTeam ? 'Your team is up!' : `${upTeam.name} is up`}</h2>
              <p className="muted">
                {drawer?.name ?? 'Someone'} is choosing a word
                {watcher && '. You’ll see the word too.'}
              </p>
            </>
          ) : (
            <>
              {drawer && <Avatar i={drawer.avatar} size={84} />}
              <h2>{drawer?.name ?? 'Someone'} is choosing a word</h2>
              <p className="muted">Get ready to guess!</p>
            </>
          )}
        </div>
      </div>
    );
  } else if (phase === 'reveal' && teams) {
    // A team turn: what the team won and who got it, never each player's
    // points (the game is scored by team).
    const guesserId = room.round.guessedPlayerIds[0];
    const guesser = room.players.find((x) => x.id === guesserId);
    const got = guesserId !== undefined;
    // What the turn won, and how fast: the team's score now against as the
    // drawing began, and the time from then to the reveal. A page that missed
    // the drawing (it joined or came back since) leaves out what it can't know.
    const start = teamStart.current;
    const sameTurn = start !== null && start.teamId === upTeamId && start.drawerId === room.round.drawerId;
    const gained = got && upTeam && sameTurn ? upTeam.score - start.score : 0;
    const drawSeconds = room.settings.drawSeconds;
    const secs =
      got && sameTurn && start.at !== null && revealedAt !== null
        ? Math.min(drawSeconds, Math.max(1, Math.round((revealedAt - start.at) / 1000)))
        : null;
    // How the turn ended, in the server's words (its line in the chat); until
    // that comes, or for a turn it has none for, from what the round and the
    // roster say now. The roster alone can mislead: the server gives a drawer
    // or guessers who drop out ten seconds' grace, so a drawer whose phone
    // locked just before time ran out still ran out of time.
    const guessersLeft = room.players.some(
      (x) => x.connected && x.id !== room.round.drawerId && (x.teamId ?? null) === upTeamId,
    );
    const said = !got && upTeam ? serverTurnEnd(p.messages, upTeam.name, room.round.solution) : null;
    const ending = got ? 'got' : (said ?? (!drawer?.connected ? 'left' : guessersLeft ? 'time' : 'alone'));
    overlay = (
      <div className="overlay">
        <div className="overlay-body">
          {upTeam && (
            <>
              <TeamChip team={upTeam} />
              <h2>
                {ending === 'got'
                  ? `${upTeam.name} got it!`
                  : ending === 'left'
                    ? 'The drawer left'
                    : ending === 'time'
                      ? 'Time’s up!'
                      : `Nobody on ${upTeam.name} is left to guess`}
              </h2>
              {ending === 'time' && <p className="muted">Nobody on {upTeam.name} got it.</p>}
            </>
          )}
          {gained > 0 && (
            <p className="game-team-gain">
              +{gained}
              {secs !== null && <span className="game-team-secs"> in {secs}s</span>}
            </p>
          )}
          {guesser && (
            <p className="game-team-who">
              <Avatar i={guesser.avatar} size={28} />
              <span>{guesser.id === room.youId ? 'You guessed it!' : `${guesser.name} guessed it`}</span>
            </p>
          )}
          {/* A turn can end before its word was chosen (the drawer left). */}
          {room.round.solution && (
            <>
              <p className="muted reveal-label">The word was</p>
              <div className="solution">{room.round.solution}</div>
            </>
          )}
          {verdict}
        </div>
      </div>
    );
  } else if (phase === 'reveal') {
    const present = room.players.filter((x) => x.connected).length;
    const gains = room.players
      .map((x) => ({ x, gain: x.score - (turnStart.current.get(x.id) ?? x.score) }))
      .sort((a, b) => b.gain - a.gain)
      .filter(({ x, gain }) => present <= BIG_ROOM || gain > 0 || x.id === room.youId);
    overlay = (
      <div className="overlay">
        <div className="overlay-body">
          <p className="muted reveal-label">The word was</p>
          <div className="solution">{room.round.solution ?? '…'}</div>
          {verdict}
          <ol {...listProps(gains.length)}>
            {gains.map(({ x, gain }) => (
              <li key={x.id}>
                <Avatar i={x.avatar} size={28} />
                <span>{x.name}</span>
                <span className={`gain ${gain ? '' : 'zero'}`}>{gain ? `+${gain}` : '0'}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  } else if (phase === 'scoreboard') {
    // The server says which scoreboard is the last one (its final scores). The
    // round number can't: it has already moved on before any other scoreboard.
    const last = p.finalScores !== null;
    overlay = (
      <div className="overlay">
        <div className="overlay-body">
          <h2>{last ? 'Final scores' : 'Scores so far'}</h2>
          {teams ? (
            // A team game is scored by team: the standings, and nobody's own points.
            <ol className="game-team-standings">
              {standings(teams).map(({ team, rank }) => (
                <li key={team.id} className={team.id === myTeam?.id ? 'game-team-mine' : undefined}>
                  <span>#{rank}</span>
                  <span>
                    <TeamChip team={team} />
                    {team.id === myTeam?.id && <span className="game-team-yours">Your team</span>}
                  </span>
                  <span className="gain">{team.score}</span>
                </li>
              ))}
            </ol>
          ) : (
            <ol {...listProps(room.players.length)}>
              {ranked(room.players).map((x, i) => (
                <li key={x.id}>
                  <span>#{i + 1}</span>
                  <span>{x.name}</span>
                  <span className="gain">{x.score}</span>
                </li>
              ))}
            </ol>
          )}
          {!last && (
            <p className="muted">
              Round {room.round.round} of {room.round.totalRounds} is next
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* data-* name the screen for automated checks (and devtools); no styling. */}
      <div
        className="game"
        ref={gameRef}
        data-phase={phase}
        data-role={isDrawer ? 'drawer' : watcher ? 'watcher' : 'guesser'}
      >
        <div className={`word-strip ${menuOpen ? 'menu-open' : ''}`} ref={stripRef}>
          <div className="left">
            <div
              className={`clock ${hurry ? 'hurry' : ''} ${timed ? '' : 'idle'}`}
              aria-label={timed ? `${p.secondsLeft} seconds left` : 'Paused'}
            >
              {timed ? p.secondsLeft : '⏸'}
            </div>
            {/* "Round 1 of 3"; on a phone, "1/3". */}
            <span className="round">
              <span className="round-word">Round </span>
              {Math.max(1, room.round.round)}
              <span className="round-of"> of </span>
              <span className="round-slash" aria-hidden="true">/</span>
              {room.round.totalRounds}
            </span>
          </div>
          <div className="center">{center}</div>
          <button
            ref={menuToggle}
            className="small icon menu-toggle"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-label="More: invite, report, leave"
          >
            ⋯
          </button>
          <div className="right">
            {phase === 'drawing' && !isDrawer && (
              <button
                className="small"
                onClick={() => {
                  setMenuOpen(false);
                  p.onReport();
                }}
                title="Report this word as offensive"
                aria-label="Report this word"
              >
                🚩 <span className="btn-label">Report</span>
              </button>
            )}
            {p.isHost && phase !== 'finished' && <RestartButton onRestart={p.onRestart} />}
            {lastShareable && (
              <button
                className="small"
                onClick={() => {
                  setMenuOpen(false);
                  setLastSheet(true);
                }}
                aria-label="Share the last game’s results"
              >
                🏆 <span className="btn-label">Share last game</span>
              </button>
            )}
            <InviteLink roomCode={room.roomCode} compact />
            <button className="small" onClick={p.onLeave} aria-label="Leave the game">
              🚪 <span className="btn-label">Leave</span>
            </button>
          </div>
        </div>

        <div className={teams ? 'play game-team-play' : 'play'}>
          {teams && <TeamBar teams={teams} upTeamId={upTeam?.id ?? null} myTeamId={myTeam?.id ?? null} />}
          <Scores
            players={room.players}
            drawerId={room.round.drawerId}
            guessed={room.round.guessedPlayerIds}
            youId={room.youId}
            isHost={p.isHost}
            onKick={p.onKick}
            teams={teams}
          />
          <div className="stage">
            <Board
              canDraw={canDraw}
              onDrawStart={p.onDrawStart}
              onDrawAppend={p.onDrawAppend}
              onUndo={p.onUndo}
              onClear={p.onClear}
              overlay={overlay}
            />
          </div>
          <Chat
            messages={messages}
            canGuess={canGuess}
            placeholder={placeholder}
            closeHint={p.closeHint}
            onGuess={p.onGuess}
            title={phase === 'finished' ? 'Chat' : 'Guesses'}
          />
        </div>
      </div>

      {joinedTeam && (
        <div className="toasts game-team-toasts">
          <div className="toast info" role="status">
            <span>
              You’re on <TeamChip team={joinedTeam} />
            </span>
            <button className="small" onClick={() => setJoinedTeam(null)}>
              OK
            </button>
          </div>
        </div>
      )}
      {phase === 'finished' && (
        <Finale
          key={finaleKey}
          room={room}
          summary={p.summary}
          results={results}
          finalScores={p.finalScores}
          isHost={p.isHost}
          busy={p.busy}
          open={finaleOpen}
          unread={unread}
          onMinimise={minimise}
          onPlayAgain={p.onPlayAgain}
          onRestart={p.onRestart}
        />
      )}
      {lastSheet && lastShareable && results && (
        <ShareSheet
          key={results.summary.id}
          summary={results.summary}
          festive={results.festive}
          youId={room.youId}
          roomCode={room.roomCode}
          file={results.file}
          card={results.card}
          title="Share last game"
          onClose={() => setLastSheet(false)}
          // On a phone, "Share last game" is folded away in the closed menu by then.
          returnFocus={() => menuToggle.current}
        />
      )}
    </>
  );
}
