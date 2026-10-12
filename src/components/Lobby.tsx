import { useState } from 'react';
import type { RoomSettings } from '../generated/contract';
import type { RoomSnapshot } from '../hooks/useRoom';
import { Avatar } from './Avatar';

interface Props {
  room: RoomSnapshot;
  isHost: boolean;
  busy: boolean;
  onSettings: (patch: Partial<RoomSettings>) => void;
  onStart: () => void;
  onLeave: () => void;
}

const NUMERIC = [
  { key: 'rounds', label: 'Rounds', min: 1, max: 10, step: 1 },
  { key: 'drawSeconds', label: 'Draw time (s)', min: 30, max: 180, step: 10 },
  { key: 'maxPlayers', label: 'Max players', min: 2, max: 16, step: 1 },
] as const;

export function Lobby({ room, isHost, busy, onSettings, onStart, onLeave }: Props) {
  const [copied, setCopied] = useState(false);
  const present = room.players.filter((p) => p.connected).length;

  const share = async () => {
    const url = `${location.origin}/?room=${room.roomCode}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the code is on screen anyway */
    }
  };

  return (
    <>
      <div className="card row-between">
        <div>
          <span className="tag">Room</span>
          <h2 className="code">{room.roomCode}</h2>
        </div>
        <div className="row">
          <button onClick={share}>{copied ? 'Copied ✓' : 'Copy invite link'}</button>
          <button onClick={onLeave}>Leave</button>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h3>Players <span className="muted">({present} here)</span></h3>
          <ul className="players">
            {room.players.map((p) => (
              <li key={p.id} className={p.connected ? '' : 'away'}>
                <Avatar i={p.avatar} />
                <span className="pname">{p.name}</span>
                {p.isHost && <span className="tag">host</span>}
                {p.id === room.youId && <span className="tag">you</span>}
                {!p.connected && <span className="tag">away</span>}
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h3>Settings</h3>
          {NUMERIC.map((s) => (
            <label className="field row-between" key={s.key}>
              <span>{s.label}</span>
              <input
                type="number"
                disabled={!isHost || busy}
                min={s.min}
                max={s.max}
                step={s.step}
                value={room.settings[s.key]}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) onSettings({ [s.key]: v });
                }}
              />
            </label>
          ))}
          <label className="field row-between">
            <span>Allow custom words</span>
            <input
              type="checkbox"
              disabled={!isHost || busy}
              checked={room.settings.allowCustomWords}
              onChange={(e) => onSettings({ allowCustomWords: e.target.checked })}
            />
          </label>
          {!isHost && <p className="muted">Only the host can change settings.</p>}
        </div>
      </div>

      <div className="card">
        <button
          className="primary wide"
          disabled={!isHost || busy || present < 2}
          onClick={onStart}
        >
          {present < 2 ? 'Waiting for one more player…' : 'Start game'}
        </button>
        {!isHost && <p className="muted center">Waiting for the host to start.</p>}
      </div>
    </>
  );
}
