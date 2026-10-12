import { useRoom } from './hooks/useRoom';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';

export function App() {
  const r = useRoom();

  return (
    <div className="wrap">
      <header className="head">
        <div>
          <h1>vckscribble</h1>
          <p className="sub">Draw the corporate slang. Guess the corporate slang.</p>
        </div>
        <span className={`dot ${r.connected ? 'ok' : 'bad'}`} title={r.connected ? 'connected' : 'offline'} />
      </header>

      {r.error && (
        <div className="card error" role="alert">
          <span>{r.error}</span>
          <button onClick={r.dismissError}>Dismiss</button>
        </div>
      )}

      {r.room ? (
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
      ) : (
        <Home busy={r.busy} connected={r.connected} onCreate={r.create} onJoin={r.join} />
      )}

      {r.messages.length > 0 && (
        <div className="card log">
          {r.messages.slice(-6).map((m) => (
            <div key={m.id} className="muted mono">{m.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}
