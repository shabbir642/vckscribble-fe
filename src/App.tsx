import { Game } from './components/Game';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { useState } from 'react';
import { useRoom } from './hooks/useRoom';
import { soundEnabled, toggleSound } from './lib/sound';

export function App() {
  const r = useRoom();
  const [sound, setSound] = useState(soundEnabled);
  const inGame = r.room && r.room.round.phase !== 'lobby';

  return (
    <div className="wrap">
      <header className="head">
        <div>
          <h1>vckscribble</h1>
          <p className="sub">Draw the corporate slang. Guess the corporate slang.</p>
        </div>
        <div className="row">
          <button
            className="small"
            onClick={() => setSound(toggleSound())}
            aria-pressed={sound}
            title={sound ? 'Mute' : 'Unmute'}
          >
            {sound ? 'Sound on' : 'Sound off'}
          </button>
          <span
            className={`dot ${r.connected ? 'ok' : 'bad'}`}
            title={r.connected ? 'connected' : 'offline'}
          />
        </div>
      </header>

      {r.error && (
        <div className="card error" role="alert">
          <span>{r.error}</span>
          <button onClick={r.dismissError}>Dismiss</button>
        </div>
      )}

      {!r.room && (
        <Home busy={r.busy} connected={r.connected} onCreate={r.create} onJoin={r.join} />
      )}

      {r.room && !inGame && (
        <Lobby
          room={r.room}
          isHost={r.isHost}
          busy={r.busy}
          onSettings={r.updateSettings}
          onStart={r.start}
          onLeave={r.leave}
          strokes={r.strokes}
          generation={r.generation}
          onStroke={r.sendStroke}
          onUndo={r.undo}
          onClear={r.clear}
        />
      )}

      {r.room && inGame && (
        <Game
          room={r.room}
          messages={r.messages}
          strokes={r.strokes}
          generation={r.generation}
          wordOptions={r.wordOptions}
          assignedWord={r.assignedWord}
          secondsLeft={r.secondsLeft}
          closeHint={r.closeHint}
          finalScores={r.finalScores}
          busy={r.busy}
          onChoose={r.chooseWord}
          onCustom={r.customWord}
          onGuess={r.sendGuess}
          onReport={r.reportWord}
          onStroke={r.sendStroke}
          onUndo={r.undo}
          onClear={r.clear}
          onLeave={r.leave}
          isHost={r.isHost}
          onPlayAgain={r.start}
        />
      )}

      {r.room && !inGame && r.messages.length > 0 && (
        <div className="card log">
          {r.messages.slice(-6).map((m) => (
            <div key={m.id} className="muted mono">{m.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}
