import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import type { BestDrawing, GameSummary, Player, SummaryPlayer } from '../generated/contract';
import type { RoomSnapshot } from '../hooks/useRoom';
import { recordGame, recordLine } from '../lib/records';
import { renderDrawing } from '../lib/render';
import { AWARDS, formatSeconds, ordinal, shareText, summaryFromPlayers } from '../lib/results';
import { roomInviteUrl } from '../lib/session';
import { canShareFiles, isPhone, shareFile } from '../lib/share';
import { sfx } from '../lib/sound';
import { Avatar } from './Avatar';
import { Confetti } from './Confetti';
import { InviteLink } from './InviteLink';
import { Podium, onPodium, points, type Standing } from './Podium';
import { ShareSheet, makeCardFile, shareMode, trapTab } from './ShareSheet';

/** The opening: banner and podium at once, the blocks rising, then the awards (index.css .finale). */
const SEQUENCE_MS = 1800;
/** How long the server's summary is waited for before the details make do with the scores. */
const FALLBACK_MS = 1500;
/** When the first award lands after the details appear (.award's animation-delay). */
const FIRST_AWARD_MS = 1000;

/* ------------------------------------------------------------ the results */

/**
 * A finished game's results as this page keeps them: the server's summary,
 * the drawing of the game replayed once, and the picture to share, made once.
 * Kept until the next game's summary arrives (through the lobby too), so the
 * last game can still be shared while the next one runs.
 */
export interface GameResults {
  /**
   * The server's summary, less its drawing of the game if that couldn't be
   * replayed in time: then the screen, the picture and its words all go
   * without one.
   */
  summary: GameSummary;
  /**
   * The drawing of the game at 1200×900 (the share card's size): undefined
   * until it has been replayed, null without one.
   */
  drawing: HTMLCanvasElement | null | undefined;
  /** The results picture, once made. */
  file: File | null;
  /** The results picture: made once, however often it is asked for. */
  card: () => Promise<File>;
}

interface Kept extends Omit<GameResults, 'card'> {
  /** The room the game was played in: its results go when you leave it. */
  roomCode: string;
}

/**
 * The drawing of the game on a canvas of its own; null if there is none, or
 * if it takes too long to replay (hundreds of fills), when the results go
 * without it rather than hold the page.
 */
async function replay(summary: GameSummary): Promise<HTMLCanvasElement | null> {
  if (!summary.best?.strokes.length) return null;
  try {
    return await renderDrawing(summary.best.strokes, 1200, 900);
  } catch {
    return null; // the results open anyway, without the picture
  }
}

/** iOS keeps a canvas's memory until it is shrunk, and caps the total. */
function free(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/** Runs `run` once the results have finished opening and the page is idle; returns a cancel. */
function afterOpening(run: () => void): () => void {
  let idle: number | null = null;
  const t = setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(run, { timeout: 4000 });
    } else run();
  }, SEQUENCE_MS);
  return () => {
    clearTimeout(t);
    if (idle !== null) window.cancelIdleCallback(idle);
  };
}

/**
 * Turns each new summary into results. The summary comes the moment the game
 * ends, as the results open, so the drawing waits: a replay with fills reads
 * and writes the whole 1200×900 bitmap per fill, too much for the opening on
 * a phone. It is replayed once the results have finished opening and the
 * page is idle (or straight away, if the picture is wanted sooner), and the
 * picture is made in idle time after that, ready for the Share tap.
 *
 * Kept per room (`roomCode`): the results of a room you have left go.
 */
export function useResults(
  summary: GameSummary | null,
  youId: string,
  roomCode: string | null,
): GameResults | null {
  const [kept, setKept] = useState<Kept | null>(null);
  // A new game's results are kept from the render its summary arrives in, so
  // no screen ever sees the summary without them. A re-send of the same game
  // changes nothing; leaving the room drops them.
  let next = kept && kept.roomCode === roomCode ? kept : null;
  if (summary && roomCode && summary.id !== next?.summary.id) {
    next = { roomCode, summary, drawing: summary.best ? undefined : null, file: null };
  }
  if (next !== kept) setKept(next);

  /** The same, for the replay, the picture's promise and the cleanup, which outlive a render. */
  const latest = useRef<Kept | null>(null);
  const job = useRef<{ id: string; promise: Promise<File> } | null>(null);
  const replaying = useRef<{ id: string; promise: Promise<HTMLCanvasElement | null> } | null>(null);
  const mounted = useRef(true);

  /** Frees a drawing once no picture is being drawn from it. */
  const release = (old: Kept, oldJob: { promise: Promise<File> } | null) => {
    void (oldJob?.promise ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => free(old.drawing));
  };

  // Before anything else runs: the share sheet asks for the picture as it
  // opens, which can be in the very commit a new summary arrives in.
  useLayoutEffect(() => {
    const old = latest.current;
    latest.current = kept;
    if (old && old.summary.id !== kept?.summary.id) {
      const oldJob = job.current;
      job.current = null;
      release(old, oldJob);
    }
  }, [kept]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Next tick: React's development double mount comes straight back.
      setTimeout(() => {
        if (!mounted.current && latest.current) release(latest.current, job.current);
      }, 0);
    };
  }, []);

  /**
   * The drawing of the game, replayed the first time it is wanted (in slices,
   * so the page stays responsive): never twice.
   */
  const drawing = useCallback((): Promise<HTMLCanvasElement | null> => {
    const cur = latest.current;
    if (!cur) return Promise.resolve(null);
    if (cur.drawing !== undefined) return Promise.resolve(cur.drawing);
    const id = cur.summary.id;
    if (replaying.current?.id === id) return replaying.current.promise;
    const promise = replay(cur.summary).then((art) => {
      const now = latest.current;
      // Another game's results took over, or these were let go, while it ran.
      if (now?.summary.id !== id || !mounted.current) {
        free(art);
        return null;
      }
      const done: Kept = {
        ...now,
        // None, or given up on: a game without a drawing, as far as anything here goes.
        summary: art || !now.summary.best ? now.summary : { ...now.summary, best: null },
        drawing: art,
      };
      latest.current = done;
      setKept((k) => (k?.summary.id === id ? done : k));
      return art;
    });
    replaying.current = { id, promise };
    return promise;
  }, []);

  const card = useCallback((): Promise<File> => {
    const cur = latest.current;
    if (!cur) return Promise.reject(new Error('There is no game to share'));
    if (cur.file) return Promise.resolve(cur.file);
    const id = cur.summary.id;
    if (job.current?.id === id) return job.current.promise;
    // The one replay, now if it hasn't happened yet; without a drawing the
    // picture is laid out without one (never replayed a second time for it).
    const promise = drawing().then((art) => {
      const now = latest.current;
      return makeCardFile(now?.summary.id === id ? now.summary : cur.summary, youId, art);
    });
    job.current = { id, promise };
    promise.then(
      (file) => {
        const now = latest.current;
        if (now?.summary.id !== id) return;
        latest.current = { ...now, file };
        setKept(latest.current);
      },
      () => {
        // The next tap tries again.
        if (job.current?.promise === promise) job.current = null;
      },
    );
    return promise;
  }, [youId, drawing]);

  // The drawing, once the results have finished opening and the page is idle.
  const pending = kept && kept.drawing === undefined ? kept.summary.id : null;
  useEffect(() => {
    if (!pending) return;
    return afterOpening(() => void drawing());
  }, [pending, drawing]);

  // The picture, made in idle time after that. Only for players: someone who
  // joined after the end has nothing to share.
  const id = kept?.summary.id;
  const played = kept?.summary.players.some((x) => x.id === youId) ?? false;
  useEffect(() => {
    if (!id || !played) return;
    return afterOpening(() => void card().catch(() => undefined));
  }, [id, played, card]);

  return useMemo(
    () => (kept ? { summary: kept.summary, drawing: kept.drawing, file: kept.file, card } : null),
    [kept, card],
  );
}

/* -------------------------------------------------------------- records */

type Outcome = ReturnType<typeof recordGame>;

/**
 * Each game is counted once, the first time its summary is shown here: React
 * may run an effect twice, and the results can be closed and opened again.
 * Later looks reuse the outcome, so its "new" badges stay put.
 */
const outcomes = new Map<string, Outcome>();
/** Games whose sound has played on this page. */
const cued = new Set<string>();

function outcomeOf(summary: GameSummary, youId: string): Outcome {
  const key = `${summary.id} ${youId}`;
  let o = outcomes.get(key);
  if (!o) {
    o = recordGame(summary, youId);
    outcomes.set(key, o);
  }
  return o;
}

/* ----------------------------------------------------------------- copy */

/** "Ann wins!", "It’s a tie: Ann & Bob!"; for a game cut short, who was ahead. */
function bannerText(standings: Standing[], abandoned: boolean): string {
  const top = standings.filter((s) => s.rank === 1 && s.score > 0).map((s) => s.name);
  const last = top[top.length - 1];
  if (last === undefined) return 'Nobody scored this time';
  const names = top.length > 1 ? `${top.slice(0, -1).join(', ')} & ${last}` : last;
  if (abandoned) return top.length > 1 ? `${names} were level` : `${names} was ahead`;
  return top.length > 1 ? `It’s a tie: ${names}!` : `${names} wins!`;
}

function placeLine(me: SummaryPlayer, summary: GameSummary): string {
  if (me.score <= 0) return summary.abandoned ? 'No points before the game ended' : 'No points this time';
  if (summary.abandoned) return `You were ${ordinal(me.rank)} when the game ended`;
  if (me.rank === 1) {
    const tied = summary.players.some((x) => x.rank === 1 && x.id !== me.id);
    return tied ? 'You tied for first!' : 'You won!';
  }
  return `You came ${ordinal(me.rank)} of ${summary.players.length}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Your numbers as chips: only what you did, with the words a screen reader needs. */
function statChips(me: SummaryPlayer): { emoji: string; text: string; more?: string }[] {
  const drawings = me.drew === 1 ? 'drawing' : 'drawings';
  const chips: { emoji: string; text: string; more?: string }[] = [];
  if (me.guessed > 0) chips.push({ emoji: '🎯', text: plural(me.guessed, 'word', 'words'), more: ' guessed' });
  if (me.fastestMs !== null) {
    chips.push({ emoji: '⚡', text: `${formatSeconds(me.fastestMs)} fastest`, more: ' guess' });
  }
  if (me.likes > 0) {
    chips.push({ emoji: '👍', text: plural(me.likes, 'like', 'likes'), more: ` on your ${drawings}` });
  }
  if (me.solvedByOthers > 0) chips.push({ emoji: '✏️', text: `${me.solvedByOthers} guessed your ${drawings}` });
  return chips;
}

/* ----------------------------------------------------------- the screen */

interface Props {
  room: RoomSnapshot;
  /** The server's summary, once it has come. */
  summary: GameSummary | null;
  /** The drawing and the picture made from a summary (maybe a previous game's). */
  results: GameResults | null;
  finalScores: Player[] | null;
  isHost: boolean;
  busy: boolean;
  /** False while minimised to look at the chat. */
  open: boolean;
  /** Chat messages that came in while the results were open. */
  unread: number;
  onMinimise: () => void;
  onPlayAgain: () => void;
  onRestart: () => void;
}

/**
 * The results of a finished game, over the whole screen: the podium at once,
 * then your game, the awards, the drawing of the game and everyone else, with
 * Play again and Share always in reach at the bottom.
 *
 * A dialog over the game rather than an overlay on the canvas: there is far
 * more to show than a phone's canvas holds. It minimises to the chat (the
 * post-game banter is what gets the next game going) and comes back from the
 * word strip.
 */
export function Finale(p: Props) {
  const { room, isHost } = p;
  const youId = room.youId;
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const own = p.summary && p.results?.summary.id === p.summary.id ? p.results : null;
  /** The server's summary as the results keep it (without a drawing too slow to replay). */
  const summary = own?.summary ?? p.summary;

  // Banner and podium show at once, from the scores; the details wait a
  // moment for the server's summary (which normally came first anyway).
  const players = p.finalScores ?? room.players;
  const base = useMemo(() => summaryFromPlayers(players), [players]);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), FALLBACK_MS);
    return () => clearTimeout(t);
  }, []);
  /** What the details show: the server's summary or, after the wait, the scores alone. */
  const shown = summary ?? (waited ? base : null);
  const abandoned = summary?.abandoned ?? false;

  // "left" by who is here now rather than at the end: someone refreshing just
  // then is back, and someone who has since gone is gone.
  const here = new Set(room.players.filter((x) => x.connected).map((x) => x.id));
  const standings: Standing[] = (summary ?? base).players.map((x) => ({ ...x, left: !here.has(x.id) }));
  const top = onPodium(standings);
  const rest = standings.filter((s) => !top.includes(s));

  const me = shown?.players.find((x) => x.id === youId) ?? null;
  // In the room but not in its results: joined after the game ended.
  const joinedLate = summary !== null && !summary.players.some((x) => x.id === youId);
  const hostName = room.players.find((x) => x.isHost)?.name ?? 'the host';
  const present = room.players.filter((x) => x.connected).length;
  const canShare = shown !== null && me !== null;

  // Play again waits out the opening, so nobody's results vanish mid-podium.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), SEQUENCE_MS);
    return () => clearTimeout(t);
  }, []);

  // Opened again after a look at the chat: everything in place, no replay.
  const [calm, setCalm] = useState(false);
  useEffect(() => {
    if (!p.open) setCalm(true);
  }, [p.open]);

  const [sheetOpen, setSheetOpen] = useState(false);
  /** Share goes straight to the OS sheet here, so the other ways need a way in. */
  const [native] = useState(() => shareMode() === 'native');

  // Tagged with its game: a resume can land on another game's results (one
  // played without you) while these are up, and this game's outcome must not
  // count for it.
  const [outcome, setOutcome] = useState<{ id: string; o: Outcome } | null>(null);
  useEffect(() => {
    if (!summary?.players.some((x) => x.id === youId)) {
      setOutcome(null);
      return;
    }
    const id = summary.id;
    setOutcome((o) => (o?.id === id ? o : { id, o: outcomeOf(summary, youId) }));
  }, [summary, youId]);
  const counted = outcome && outcome.id === summary?.id ? outcome.o : null;

  /** When the details appeared, which is when the awards start landing. */
  const detailsAt = useRef(0);
  const detailsKey = shown?.id ?? null;
  useEffect(() => {
    if (detailsKey) detailsAt.current = performance.now();
  }, [detailsKey]);

  // One sound after the game-over one: a fanfare for a new personal best, or
  // a chime as the first award lands. Never both, and not again for a game
  // already counted (a refresh, a re-send).
  useEffect(() => {
    if (!summary || !counted?.counted || cued.has(summary.id)) return;
    const best = !summary.abandoned && counted.milestones.some((m) => m.id !== 'games');
    const cue = best ? sfx.fanfare : summary.awards.length ? sfx.award : null;
    if (!cue) return;
    const id = summary.id;
    const t = setTimeout(
      () => {
        cued.add(id);
        cue();
      },
      Math.max(0, detailsAt.current + FIRST_AWARD_MS - performance.now()),
    );
    return () => clearTimeout(t);
  }, [summary, counted]);

  useEffect(() => {
    if (p.open) headingRef.current?.focus({ preventScroll: true });
  }, [p.open]);

  // Escape goes to the chat, unless the share sheet is on top (it closes itself).
  const { onMinimise } = p;
  useEffect(() => {
    if (!p.open || sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onMinimise();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [p.open, sheetOpen, onMinimise]);

  // Under the share sheet, nothing here is reachable.
  useEffect(() => {
    const el = panelRef.current;
    if (el) el.inert = sheetOpen;
  }, [sheetOpen]);

  const invite = roomInviteUrl(room.roomCode);
  const share = () => {
    if (!shown) return;
    const file = shown === summary ? (own?.file ?? null) : null;
    if (file && isPhone() && canShareFiles(file)) {
      // Straight from the tap with nothing awaited: the OS sheet needs the tap.
      void shareFile(file, shareText(shown, youId, invite, true)).then((r) => {
        if (r === 'failed') setSheetOpen(true);
      });
      return;
    }
    setSheetOpen(true);
  };

  const waitLine = !isHost && !joinedLate;
  const unread = p.unread > 99 ? '99+' : String(p.unread);

  return (
    <>
      {createPortal(
        <div className="finale-layer" hidden={!p.open}>
          <div className="finale-scrim" onClick={onMinimise} aria-hidden="true" />
          <div
            ref={panelRef}
            className={`finale ${calm ? 'calm' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={trapTab}
          >
            {!calm && !abandoned && <Confetti />}
            <div className="finale-top">
              <h2 id={titleId} ref={headingRef} tabIndex={-1}>
                {abandoned ? 'Game ended early' : 'Game over'}
              </h2>
              {isHost && (
                <button type="button" className="link" onClick={p.onRestart} disabled={p.busy}>
                  Back to lobby
                </button>
              )}
              <button
                type="button"
                className="small finale-chat"
                onClick={onMinimise}
                aria-label={p.unread > 0 ? `Chat, ${plural(p.unread, 'new message', 'new messages')}` : 'Chat'}
              >
                <span aria-hidden="true">💬</span> Chat
                {p.unread > 0 && <span className="finale-badge" aria-hidden="true">{unread}</span>}
              </button>
            </div>

            {/* Focusable, so a keyboard can scroll it (Safari makes no scroller focusable by itself). */}
            <div className="finale-body" tabIndex={0} role="region" aria-label="Results">
              {joinedLate && (
                <p className="finale-joined">
                  {isHost
                    ? 'You’re in. Start the next game when everyone’s ready.'
                    : `You’re in. The next game starts when ${hostName} is ready.`}
                </p>
              )}
              <div className="finale-hero">
                <p className="winner-banner">{bannerText(standings, abandoned)}</p>
                <Podium standings={standings} youId={youId} />
              </div>
              {/* Keyed: the details appear (and animate) afresh when the real summary replaces the stand-in. */}
              <div className="finale-details" key={shown?.id ?? ''}>
                {me && shown && <YourGame me={me} summary={shown} outcome={shown === summary ? counted : null} />}
                {shown && <Awards summary={shown} youId={youId} />}
                {shown?.best && (
                  <DrawingOfTheGame
                    best={shown.best}
                    art={own?.drawing ?? null}
                    ready={own !== null && own.drawing !== undefined}
                  />
                )}
                {rest.length > 0 && (
                  <Others rest={rest} youId={youId} title={top.length ? 'Everyone else' : 'Scores'} />
                )}
              </div>
            </div>

            {(waitLine || isHost || canShare) && (
              <div className="finale-bar">
                {waitLine && <p className="finale-wait">Waiting for {hostName} to start the next game</p>}
                {isHost && present < 2 && <InviteLink roomCode={room.roomCode} />}
                {(isHost || canShare) && (
                  <div className={`finale-actions ${isHost && present < 2 ? 'stack' : ''}`}>
                    {isHost &&
                      (present < 2 ? (
                        <button type="button" className="primary big" disabled>
                          Invite one more player to play again
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="primary big"
                          onClick={p.onPlayAgain}
                          disabled={p.busy || !settled}
                        >
                          Play again
                        </button>
                      ))}
                    {canShare && (
                      <button
                        type="button"
                        className="accent big"
                        onClick={share}
                        aria-label={isHost ? 'Share results' : undefined}
                      >
                        {isHost ? (
                          <>
                            Share<span className="finale-wide"> results</span>
                          </>
                        ) : (
                          'Share results'
                        )}
                      </button>
                    )}
                  </div>
                )}
                {canShare && native && (
                  <button type="button" className="link finale-more" onClick={() => setSheetOpen(true)}>
                    More ways to share
                  </button>
                )}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
      {sheetOpen && shown && (
        <ShareSheet
          key={shown.id}
          summary={shown}
          youId={youId}
          roomCode={room.roomCode}
          file={shown === summary ? (own?.file ?? null) : null}
          // The stand-in has no drawing to replay.
          card={shown === summary && own ? own.card : () => makeCardFile(shown, youId, null)}
          title="Share the results"
          onClose={() => setSheetOpen(false)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------ the parts */

function YourGame({ me, summary, outcome }: { me: SummaryPlayer; summary: GameSummary; outcome: Outcome | null }) {
  const headingId = useId();
  const chips = statChips(me);
  const news = outcome?.milestones ?? [];
  const line = outcome ? recordLine(outcome.records) : null;
  return (
    <section className="your-game" aria-labelledby={headingId}>
      <h3 id={headingId}>Your game</h3>
      <p className="place">{placeLine(me, summary)}</p>
      {chips.length > 0 && (
        <ul className="stats">
          {chips.map((c) => (
            <li key={c.emoji}>
              <span aria-hidden="true">{c.emoji}</span> {c.text}
              {c.more && <span className="visually-hidden">{c.more}</span>}
            </li>
          ))}
        </ul>
      )}
      {news.length > 0 && (
        <ul className="milestones">
          {news.map((m) => (
            <li key={m.id}>
              <span aria-hidden="true">🎉</span> {m.label}
            </li>
          ))}
        </ul>
      )}
      {line && <p className="records">{line}</p>}
    </section>
  );
}

function Awards({ summary, youId }: { summary: GameSummary; youId: string }) {
  const headingId = useId();
  const byId = new Map(summary.players.map((x) => [x.id, x]));
  const won = summary.awards.flatMap((a) => {
    const who = byId.get(a.playerId);
    return who ? [{ a, who }] : [];
  });
  if (!won.length) return null;
  return (
    <section className="finale-section" aria-labelledby={headingId}>
      <h3 id={headingId}>Awards</h3>
      <ul className="awards">
        {won.map(({ a, who }, i) => {
          const award = AWARDS[a.id];
          const mine = who.id === youId;
          return (
            <li key={a.id} className={`award ${mine ? 'mine' : ''}`} style={{ '--i': i } as CSSProperties}>
              <span className="award-emoji" aria-hidden="true">{award.emoji}</span>
              <span className="award-title">{award.title}</span>
              <span className="award-blurb">{award.blurb}</span>
              <span className="award-who">
                <Avatar i={who.avatar} size={24} />
                <span className="award-name">{who.name}</span>
                {mine && <span className="award-you">(you)</span>}
              </span>
              <span className="award-value">{award.value(a.value)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DrawingOfTheGame({ best, art, ready }: { best: BestDrawing; art: HTMLCanvasElement | null; ready: boolean }) {
  const headingId = useId();
  const meta = [
    best.likes > 0 ? `👍 ${best.likes}` : null,
    // Nobody left to guess (a game abandoned mid-turn) is no news. A drawing
    // nobody got can still win on likes: say so with a wink, not a zero.
    best.guessers === 0
      ? null
      : best.solvers === 0
        ? 'nobody guessed it 😅'
        : best.solvers === best.guessers
          ? 'everyone guessed it'
          : `guessed by ${best.solvers} of ${best.guessers}`,
  ].filter((x): x is string => x !== null);
  const line = meta.join(' · ');
  return (
    <section className="finale-section best-drawing" aria-labelledby={headingId}>
      <h3 id={headingId}>Drawing of the game</h3>
      <figure>
        <div className="frame">
          {!ready ? (
            <div className="shimmer" aria-hidden="true" />
          ) : (
            art && <DrawingView art={art} label={`“${best.word}” drawn by ${best.drawerName}`} />
          )}
        </div>
        <figcaption>
          <span className="caption">
            “{best.word}” by {best.drawerName}
          </span>
          {line && <span className="meta">{line.charAt(0).toUpperCase() + line.slice(1)}</span>}
        </figcaption>
      </figure>
    </section>
  );
}

/**
 * The drawing, copied from its one replay into a canvas sized to the screen
 * (at most 2× for sharpness, as the game's canvas). Copied again when the box
 * changes size: a phone turning, or the results coming back from the chat.
 */
function DrawingView({ art, label }: { art: HTMLCanvasElement; label: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const paint = () => {
      const box = canvas.getBoundingClientRect();
      if (!box.width || !art.width) return; // hidden, or the replay was freed
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(box.width * dpr);
      const h = Math.round(box.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // Exactly 4:3 (the frame's border leaves the box a hair off), centred.
      const dw = Math.min(w, (h * 4) / 3);
      const dh = (dw * 3) / 4;
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(art, (w - dw) / 2, (h - dh) / 2, dw, dh);
    };
    paint();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(paint);
    ro?.observe(canvas);
    return () => {
      ro?.disconnect();
      free(canvas);
    };
  }, [art]);
  return <canvas ref={ref} role="img" aria-label={label} />;
}

function Others({ rest, youId, title }: { rest: Standing[]; youId: string; title: string }) {
  const headingId = useId();
  return (
    <section className="finale-section finale-others" aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      <ol className="finale-ranks">
        {rest.map((s) => (
          <li key={s.id} className={[s.id === youId && 'me', s.left && 'left'].filter(Boolean).join(' ')}>
            <span className="rank">#{s.rank}</span>
            <Avatar i={s.avatar} size={28} />
            <span className="who">
              <span className="pname">{s.name}</span>
              {s.id === youId && <span className="you">(you)</span>}
            </span>
            {s.left && <span className="tag">left</span>}
            <span className="score">{points(s.score)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
