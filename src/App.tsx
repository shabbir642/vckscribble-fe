import { useEffect, useRef, useState } from 'react';
import { useResults } from './components/Finale';
import { Game } from './components/Game';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { Logo } from './components/Logo';
import { Toasts } from './components/Toasts';
import { MIN_CUSTOM_WORDS } from './generated/contract';
import { useRoom, type UseRoom } from './hooks/useRoom';
import { useViewportHeight } from './hooks/useViewportHeight';
import { useWakeLock } from './hooks/useWakeLock';
import { clearPresetParams, readPreset, type RoomPreset } from './lib/preset';
import { soundEnabled, toggleSound } from './lib/sound';

/**
 * Packs or words a guide page sent the player here with (lib/preset.ts).
 * Read once, outside React: StrictMode renders twice, and the address is
 * cleaned of them straight after the first render.
 */
const BOOT_PRESET = readPreset();

/**
 * Sets up a room the player just created the way the guide page asked:
 * packs and difficulty, then the word list. Whether the room plays only
 * those words depends on how many the server kept (it drops invalid ones and
 * repeats), not on how many were sent.
 */
async function applyPreset(
  p: RoomPreset,
  r: Pick<UseRoom, 'updateSettings' | 'setCustomWords'>,
): Promise<void> {
  if (p.packs?.length || p.difficulty) {
    await r.updateSettings({
      ...(p.packs?.length ? { wordPacks: p.packs } : {}),
      ...(p.difficulty ? { difficulty: p.difficulty } : {}),
    });
  }
  if (p.customWords?.length) {
    const res = await r.setCustomWords(p.customWords.join(', '));
    if (res.ok) await r.updateSettings({ customWordsOnly: res.accepted >= MIN_CUSTOM_WORDS });
  }
}

export function App() {
  const r = useRoom();
  // Kept here, not in the game screen: "Back to lobby" leaves the game screen,
  // and the next game must still be able to share the last one.
  const results = useResults(
    r.summary,
    r.room?.youId ?? '',
    r.room?.roomCode ?? null,
    r.room?.settings ?? null,
  );
  // Screen stays on for as long as the player is in a room.
  useWakeLock(r.room !== null);
  const [sound, setSound] = useState(soundEnabled);
  const inGame = Boolean(r.room && r.room.round.phase !== 'lobby');
  // The game screen fits the visible screen exactly: no scrolling mid-turn.
  useViewportHeight(inGame);
  // The page's plain-HTML intro (index.html, #about) is for the home screen.
  const onHome = !r.room && !r.reconnecting;
  useEffect(() => {
    document.body.dataset.screen = onHome ? 'home' : 'room';
  }, [onHome]);

  const [preset, setPreset] = useState(BOOT_PRESET);
  useEffect(() => {
    clearPresetParams();
  }, []);
  /**
   * Set when the player creates a room while a preset waits: that room gets
   * it, once. A seat resumed on load, or a room joined, never does.
   */
  const presetForNewRoom = useRef(false);
  const create = (name: string, avatar: number) => {
    presetForNewRoom.current = preset !== null;
    void r.create(name, avatar);
  };
  const join = async (code: string, name: string, avatar: number) => {
    const res = await r.join(code, name, avatar);
    // Someone else's room, set up their way: the preset is spent.
    if (res.ok) {
      presetForNewRoom.current = false;
      setPreset(null);
    }
    return res;
  };
  const roomCode = r.room?.roomCode;
  const phase = r.room?.round.phase;
  const online = r.connected && !r.reconnecting;
  const { isHost, busy, updateSettings, setCustomWords } = r;
  useEffect(() => {
    if (!preset || !presetForNewRoom.current) return;
    // Wait for the create request itself to finish: requests share `busy`.
    if (!roomCode || !isHost || phase !== 'lobby' || busy || !online) return;
    presetForNewRoom.current = false;
    setPreset(null);
    void applyPreset(preset, { updateSettings, setCustomWords });
  }, [preset, roomCode, isHost, phase, busy, online, updateSettings, setCustomWords]);

  return (
    <div className={`wrap ${inGame ? 'in-game' : ''}`}>
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
          onCreate={create}
          onJoin={join}
          onPeek={r.peek}
          preset={preset}
          onDropPreset={() => setPreset(null)}
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
          onCustomWords={r.setCustomWords}
          onStart={r.start}
          onLeave={r.leave}
          onDrawStart={r.drawStart}
          onDrawAppend={r.drawAppend}
          onUndo={r.undo}
          onClear={r.clear}
          onProfile={r.updateProfile}
          onGuess={r.sendGuess}
          onKick={r.kick}
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
          summary={r.summary}
          results={results}
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
          onRestart={r.restart}
          reactionFeed={r.reactionFeed}
          myReaction={r.myReaction}
          onReact={r.react}
          onKick={r.kick}
        />
      )}
    </div>
  );
}
