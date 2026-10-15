import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatMessage, Player, Reaction, Stroke } from '../generated/contract';
import type { RoomSnapshot } from '../hooks/useRoom';
import { Avatar } from './Avatar';
import { Board } from './Board';
import { Chat } from './Chat';
import { Confetti } from './Confetti';
import { InviteLink } from './InviteLink';
import { Podium, rankPlayers } from './Podium';
import { Reactions } from './Reactions';
import { Scores } from './Scores';
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
  finalScores: Player[] | null;
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

  const canDraw = isDrawer && phase === 'drawing' && p.online;
  const canGuess = !isDrawer && phase === 'drawing' && p.online;

  // Scores as the turn began, so the reveal can show what each player won.
  const turnStart = useRef(new Map<string, number>());
  useEffect(() => {
    if (phase === 'drawing') {
      turnStart.current = new Map(room.players.map((x) => [x.id, x.score]));
    }
    // Only on entering the drawing phase: score changes mid-turn are the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const placeholder = !p.online
    ? 'Reconnecting…'
    : canDraw
    ? 'No chatting while you draw'
    : youGuessed
      ? 'Chat with the other solvers'
      : phase === 'drawing'
        ? 'Type your guess here…'
        : 'Guess when the drawing starts';

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
    center = <div className="hint-label">Game over</div>;
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
          <p className="muted">The word was</p>
          <div className="solution">{room.round.solution ?? '…'}</div>
          {(room.round.likes > 0 || room.round.dislikes > 0) && (
            <p className="verdict">
              {drawer?.name ?? 'The drawing'} got 👍 {room.round.likes} &nbsp;👎 {room.round.dislikes}
            </p>
          )}
          <ol>
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
    overlay = (
      <div className="overlay">
        <div className="overlay-body">
          <h2>Scores so far</h2>
          <ol>
            {ranked(room.players).map((x, i) => (
              <li key={x.id}>
                <span>#{i + 1}</span>
                <span>{x.name}</span>
                <span className="gain">{x.score}</span>
              </li>
            ))}
          </ol>
          <p className="muted">
            Round {room.round.round} of {room.round.totalRounds} is next
          </p>
        </div>
      </div>
    );
  } else if (phase === 'finished' && p.finalScores) {
    const order = rankPlayers(p.finalScores);
    const champs = order.filter((x) => x.rank === 1).map((x) => x.player.name);
    overlay = (
      <div className="overlay finale">
        <Confetti />
        <div className="overlay-body">
          <div className="winner-banner">
            {champs.length > 1 ? `It’s a tie: ${champs.join(' & ')}!` : `${champs[0] ?? 'Nobody'} wins!`}
          </div>
          <Podium players={p.finalScores} youId={room.youId} />
          {p.isHost ? (
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="primary big" onClick={p.onPlayAgain} disabled={p.busy}>
                Play again
              </button>
              <button className="big" onClick={p.onRestart} disabled={p.busy}>
                Back to lobby
              </button>
            </div>
          ) : (
            <p className="muted">Waiting for the host to start another game…</p>
          )}
        </div>
      </div>
    );
  }

  return (
    // data-* name the screen for automated checks (and devtools); no styling.
    <div className="game" data-phase={phase} data-role={isDrawer ? 'drawer' : 'guesser'}>
      <div className="word-strip">
        <div className="left">
          <div
            className={`clock ${hurry ? 'hurry' : ''} ${timed ? '' : 'idle'}`}
            aria-label={timed ? `${p.secondsLeft} seconds left` : 'Paused'}
          >
            {timed ? p.secondsLeft : '⏸'}
          </div>
          <span className="round">
            Round {Math.max(1, room.round.round)} of {room.round.totalRounds}
          </span>
        </div>
        <div className="center">{center}</div>
        <div className="right">
          {phase === 'drawing' && !isDrawer && (
            <button className="small" onClick={p.onReport} title="Report this word as offensive" aria-label="Report this word">
              🚩 <span className="btn-label">Report</span>
            </button>
          )}
          {p.isHost && phase !== 'finished' && <RestartButton onRestart={p.onRestart} />}
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
        />
      </div>
    </div>
  );
}
