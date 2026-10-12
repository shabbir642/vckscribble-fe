import { useState } from 'react';
import { AVATARS, Avatar } from './Avatar';
import { roomFromUrl } from '../lib/session';

interface Props {
  busy: boolean;
  connected: boolean;
  onCreate: (name: string, avatar: number) => void;
  onJoin: (code: string, name: string, avatar: number) => void;
}

export function Home({ busy, connected, onCreate, onJoin }: Props) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(() => Math.floor(Math.random() * AVATARS.length));
  const [code, setCode] = useState(() => roomFromUrl() ?? '');

  const canCreate = name.trim().length > 0 && connected && !busy;
  const canJoin = canCreate && code.trim().length >= 4;

  return (
    <div className="card">
      <label className="field">
        <span>Your name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          placeholder="Alice"
          autoFocus
        />
      </label>

      <div className="field">
        <span>Avatar</span>
        <div className="avatars">
          {AVATARS.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`avatar-pick ${i === avatar ? 'on' : ''}`}
              onClick={() => setAvatar(i)}
              aria-label={`Avatar ${i + 1}`}
              aria-pressed={i === avatar}
            >
              <Avatar i={i} size={22} />
            </button>
          ))}
        </div>
      </div>

      <div className="actions">
        <button className="primary" disabled={!canCreate} onClick={() => onCreate(name.trim(), avatar)}>
          Create room
        </button>
        <span className="or">or</span>
        <input
          className="code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
          placeholder="CODE"
          aria-label="Room code"
        />
        <button disabled={!canJoin} onClick={() => onJoin(code.trim(), name.trim(), avatar)}>
          Join
        </button>
      </div>

      {!connected && <p className="muted">Connecting to server…</p>}
    </div>
  );
}
