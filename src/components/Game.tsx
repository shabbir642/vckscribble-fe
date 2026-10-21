import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ChatMessage, GameSummary, Player, Reaction, Stroke } from '../generated/contract';
import type { RoomSnapshot } from '../hooks/useRoom';
import { Avatar } from './Avatar';
import { Board } from './Board';
import { Chat } from './Chat';
import { Finale, type GameResults } from './Finale';
import { InviteLink } from './InviteLink';
import { Reactions } from './Reactions';
import { Scores } from './Scores';
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
  if (seenPhase !== phase) {
    setSeenPhase(phase);
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
  useEffect(() => {
    if (phase === 'drawing') {
      turnStart.current = new Map(room.players.map((x) => [x.id, x.score]));
    }
    // Only on entering the drawing phase: score changes mid-turn are the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Short: on a phone the guess box is half the screen's width.
  const placeholder = !p.online
    ? 'Reconnecting…'
    : canDraw
      ? 'No chat while drawing'
      : phase === 'finished'
        ? 'Say gg, or ask for a rematch'
        : youGuessed
          ? 'Chat with the solvers'
          : phase === 'drawing'
            ? 'Type your guess…'
            : 'Guessing starts soon';

  /* ---------------------------------------------------------- word strip */
  let center: ReactNode = null;
  if (phase === 'drawing' && isDrawer && p.assignedWord) {
    center = (
      <>
        <div className="hint-label">Draw this</div>
        <div className="mask reveal"><Words text={p.assignedWord} /></div>
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
        <div className="hint-label">{youGuessed ? 'You got it!' : 'Guess this'}</div>
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
    center = (
      <div className="hint-label">
        {isDrawer ? 'Your turn to draw!' : `${drawer?.name ?? 'Someone'} is picking a word`}
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
  } else if (phase === 'reveal') {
    const gains = room.players
      .map((x) => ({ x, gain: x.score - (turnStart.current.get(x.id) ?? x.score) }))
      .sort((a, b) => b.gain - a.gain);
    overlay = (
      <div className="overlay">
        <div className="overlay-body">
          <p className="muted reveal-label">The word was</p>
          <div className="solution">{room.round.solution ?? '…'}</div>
          {(room.round.likes > 0 || room.round.dislikes > 0) && (
            <p className="verdict">
              {drawer?.name ?? 'The drawing'} got 👍 {room.round.likes} &nbsp;👎 {room.round.dislikes}
            </p>
          )}
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
          <ol {...listProps(room.players.length)}>
            {ranked(room.players).map((x, i) => (
              <li key={x.id}>
                <span>#{i + 1}</span>
                <span>{x.name}</span>
                <span className="gain">{x.score}</span>
              </li>
            ))}
          </ol>
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
      <div className="game" ref={gameRef} data-phase={phase} data-role={isDrawer ? 'drawer' : 'guesser'}>
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

        <div className="play">
          <Scores
            players={room.players}
            drawerId={room.round.drawerId}
            guessed={room.round.guessedPlayerIds}
            youId={room.youId}
            isHost={p.isHost}
            onKick={p.onKick}
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
            messages={p.messages}
            canGuess={canGuess}
            placeholder={placeholder}
            closeHint={p.closeHint}
            onGuess={p.onGuess}
            title={phase === 'finished' ? 'Chat' : 'Guesses'}
          />
        </div>
      </div>

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
