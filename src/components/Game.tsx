import type { ChatMessage, Player, Stroke } from '../generated/contract';
import type { RoomSnapshot } from '../hooks/useRoom';
import { Board } from './Board';
import { Chat } from './Chat';
import { Scores } from './Scores';
import { WordPicker } from './WordPicker';
import { Confetti } from './Confetti';

interface Props {
  room: RoomSnapshot;
  messages: ChatMessage[];
  strokes: Stroke[];
  generation: number;
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
  onStroke: (s: Stroke) => void;
  onUndo: () => void;
  onClear: () => void;
  onLeave: () => void;
  isHost: boolean;
  onPlayAgain: () => void;
}

export function Game(p: Props) {
  const { room } = p;
  const isDrawer = room.round.drawerId === room.youId;
  const drawer = room.players.find((x) => x.id === room.round.drawerId);
  const youGuessed = room.round.guessedPlayerIds.includes(room.youId);
  const phase = room.round.phase;

  const canDraw = isDrawer && phase === 'drawing';
  const canGuess = !isDrawer && (phase === 'drawing' || phase === 'lobby');

  const placeholder = isDrawer
    ? 'You are drawing — no chatting'
    : youGuessed
      ? 'You got it! (only solvers see this)'
      : 'Type your guess…';

  return (
    <>
      <div className="card row-between status">
        <div className="row">
          <span className="tag">Round {room.round.round}/{room.round.totalRounds}</span>
          {phase === 'drawing' && <span className="timer">{p.secondsLeft}s</span>}
        </div>

        <div className="center-word">
          {phase === 'drawing' && isDrawer && p.assignedWord && (
            <span className="mono mask">{p.assignedWord}</span>
          )}
          {phase === 'drawing' && !isDrawer && room.round.maskedWord && (
            <span className="mono mask">{room.round.maskedWord}</span>
          )}
          {(phase === 'reveal' || phase === 'scoreboard') && room.round.solution && (
            <span className="solution">{room.round.solution}</span>
          )}
          {phase === 'selecting' && !isDrawer && (
            <span className="muted">{drawer?.name ?? 'Someone'} is choosing…</span>
          )}
        </div>

        <div className="row">
          {phase === 'drawing' && !isDrawer && (
            <button className="link small" onClick={p.onReport} title="Report this word">
              Report
            </button>
          )}
          <button onClick={p.onLeave}>Leave</button>
        </div>
      </div>

      {phase === 'selecting' && isDrawer && p.wordOptions && (
        <WordPicker
          choices={p.wordOptions.choices}
          allowCustom={p.wordOptions.allowCustom}
          busy={p.busy}
          secondsLeft={p.secondsLeft}
          onChoose={p.onChoose}
          onCustom={p.onCustom}
        />
      )}

      {phase === 'finished' && p.finalScores && (
        <div className="card podium">
          <Confetti />
          {(() => {
            const ranked = [...p.finalScores!].sort((a, b) => b.score - a.score);
            const top = ranked[0]!.score;
            // A draw is possible, so announce every player on the top score
            // rather than whoever sorted first.
            const champs = ranked.filter((x) => x.score === top);
            return (
              <p className="winner-banner">
                {champs.length > 1
                  ? `It's a tie — ${champs.map((c) => c.name).join(' & ')}!`
                  : `${champs[0]!.name} wins!`}
              </p>
            );
          })()}
          <h3>Final scores</h3>
          <ol>
            {[...p.finalScores].sort((a, b) => b.score - a.score).map((pl, _i, arr) => (
              <li key={pl.id} className={pl.score === arr[0]!.score ? 'winner' : ''}>
                <span>{pl.score === arr[0]!.score ? <span className="crown">👑</span> : null}</span>
                <span>{pl.name}</span>
                <span className="score">{pl.score}</span>
              </li>
            ))}
          </ol>
          {p.isHost ? (
            <button className="primary wide" onClick={p.onPlayAgain} disabled={p.busy}>
              Play again
            </button>
          ) : (
            <p className="muted center">Waiting for the host to start another game.</p>
          )}
        </div>
      )}

      <div className="play">
        <Board
          strokes={p.strokes}
          generation={p.generation}
          canDraw={canDraw}
          onStroke={p.onStroke}
          onUndo={p.onUndo}
          onClear={p.onClear}
        />
        <div className="side">
          <Scores
            players={room.players}
            drawerId={room.round.drawerId}
            guessed={room.round.guessedPlayerIds}
            youId={room.youId}
          />
          <Chat
            messages={p.messages}
            canGuess={canGuess}
            placeholder={placeholder}
            closeHint={p.closeHint}
            onGuess={p.onGuess}
          />
        </div>
      </div>
    </>
  );
}
