import { useState } from 'react';
import { Game } from './components/Game';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { Logo } from './components/Logo';
import { Toasts } from './components/Toasts';
import { useRoom } from './hooks/useRoom';
import { soundEnabled, toggleSound } from './lib/sound';

export function App() {
  const r = useRoom();
  const [sound, setSound] = useState(soundEnabled);
  const inGame = r.room && r.room.round.phase !== 'lobby';

  return (
    <div className="wrap">
      <header className="head">
        {r.room ? <Logo /> : <span />}
        <div className="row">
          <button
            className="small icon"
            onClick={() => setSound(toggleSound())}
            aria-pressed={sound}
            aria-label={sound ? 'Mute sounds' : 'Turn sounds on'}
            title={sound ? 'Mute sounds' : 'Turn sounds on'}
          >
            {sound ? '🔊' : '🔇'}
          </button>
          <span
            className={`conn ${r.connected ? 'ok' : 'bad'}`}
            title={r.connected ? 'Connected' : 'Offline'}
            aria-label={r.connected ? 'Connected' : 'Offline'}
          />
        </div>
      </header>

      <Toasts
        error={r.error}
        info={r.room && r.reconnecting ? 'Connection lost. Getting your seat back…' : null}
        onDismiss={r.dismissError}
      />

      {!r.room && r.reconnecting && (
        <div className="home">
          <div className="center">
            <Logo big />
            <p className="tagline">Getting your seat back…</p>
          </div>
        </div>
      )}

      {!r.room && !r.reconnecting && (
        <Home
          busy={r.busy}
          connected={r.connected}
          onCreate={r.create}
          onJoin={r.join}
          onPeek={r.peek}
        />
      )}

      {r.room && !inGame && (
        <Lobby
          room={r.room}
          isHost={r.isHost}
          busy={r.busy}
          online={r.connected && !r.reconnecting}
          messages={r.messages}
          onSettings={r.updateSettings}
          onStart={r.start}
          onLeave={r.leave}
          onDrawStart={r.drawStart}
          onDrawAppend={r.drawAppend}
          onUndo={r.undo}
          onClear={r.clear}
          onProfile={r.updateProfile}
          onGuess={r.sendGuess}
        />
      )}

      {r.room && inGame && (
        <Game
          room={r.room}
          online={r.connected && !r.reconnecting}
          messages={r.messages}
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
          onDrawStart={r.drawStart}
          onDrawAppend={r.drawAppend}
          onUndo={r.undo}
          onClear={r.clear}
          onLeave={r.leave}
          isHost={r.isHost}
          onPlayAgain={r.start}
        />
      )}
    </div>
  );
}
