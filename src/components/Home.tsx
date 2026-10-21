import { useEffect, useRef, useState } from 'react';
import type { Result, RoomPreview } from '../generated/contract';
import { AVATARS, Avatar } from './Avatar';
import { Logo } from './Logo';
import { describePreset, type RoomPreset } from '../lib/preset';
import { loadRecords, recordLine } from '../lib/records';
import { loadProfile, roomFromUrl, setUrlRoom } from '../lib/session';

interface Props {
  busy: boolean;
  connected: boolean;
  onCreate: (name: string, avatar: number) => void;
  onJoin: (code: string, name: string, avatar: number) => Promise<Result>;
  onPeek: (code: string) => Promise<Result<RoomPreview>>;
  /** Packs or words from a guide page, for the next room created here. */
  preset: RoomPreset | null;
  onDropPreset: () => void;
}

function describe(p: RoomPreview): string {
  const who = `${p.players} of ${p.maxPlayers} players`;
  if (p.phase === 'lobby') return `${who} waiting for the game to start`;
  if (p.phase === 'finished') return `${who}, between games`;
  return `${who}, game in progress (you can jump in)`;
}

/**
 * Two faces, like skribbl:
 * - opened from an invite link: the room you are joining comes first, shown
 *   before you commit — or a plain "this link has expired";
 * - opened directly: create a room, or type a code.
 * Your name and avatar are remembered from last time either way.
 */
export function Home({ busy, connected, onCreate, onJoin, onPeek, preset, onDropPreset }: Props) {
  const saved = loadProfile();
  const createButton = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(saved?.name ?? '');
  const [avatar, setAvatar] = useState(
    () => saved?.avatar ?? Math.floor(Math.random() * AVATARS.length),
  );
  const [invite, setInvite] = useState(roomFromUrl);
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [inviteDead, setInviteDead] = useState(false);
  const [code, setCode] = useState('');
  /** "Game 7 · 3 wins · fastest guess 2.1s", once a game has counted. */
  const [records] = useState(() => recordLine(loadRecords()));

  // Look the invite up as soon as there is a connection to ask over.
  useEffect(() => {
    if (!invite || !connected) return;
    let live = true;
    void onPeek(invite).then((r) => {
      if (!live) return;
      if (r.ok) setPreview(r);
      else {
        setInviteDead(true);
        setUrlRoom(null);
      }
    });
    return () => {
      live = false;
    };
  }, [invite, connected, onPeek]);

  const clean = name.trim();
  const ready = clean.length > 0 && connected && !busy;
  const full = preview ? preview.players >= preview.maxPlayers : false;
  const inviting = Boolean(invite && !inviteDead);

  const join = async (target: string) => {
    const r = await onJoin(target, clean, avatar);
    if (!r.ok && r.code === 'ROOM_NOT_FOUND' && target === invite) {
      setInviteDead(true);
      setUrlRoom(null);
    }
  };

  const dropInvite = () => {
    setInvite(null);
    setPreview(null);
    setInviteDead(false);
    setUrlRoom(null);
  };

  const submit = () => {
    if (!ready) return;
    if (inviting) void join(invite!);
    else onCreate(clean, avatar);
  };

  return (
    <div className="home">
      <div className="center">
        <Logo big />
        <p className="tagline">Draw badly. Guess wildly. Laugh loudly.</p>
      </div>

      <div className="card">
        {inviting && (
          <div className="invite-head">
            <h2>{preview?.hostName ? `${preview.hostName} invited you to play` : 'You’re invited to play'}</h2>
            <div className="room-code">{invite}</div>
            <p className="muted">
              {preview ? describe(preview) : connected ? 'Looking up the room…' : 'Connecting…'}
            </p>
          </div>
        )}
        {inviteDead && (
          <p className="notice" role="status">
            That invite link has expired because the room closed. Start a new room below.
          </p>
        )}

        <div className="hero-avatar">
          <Avatar i={avatar} size={84} />
        </div>

        <label className="field">
          <span>Your name</span>
          <input
            ref={nameInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder="Enter your name"
            autoFocus={!clean}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        {records && <p className="records-line">{records}</p>}

        <div className="field">
          <span>Pick your avatar</span>
          <div className="avatar-grid">
            {AVATARS.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`avatar-pick ${i === avatar ? 'on' : ''}`}
                onClick={() => setAvatar(i)}
                aria-label={`Avatar ${i + 1}`}
                aria-pressed={i === avatar}
              >
                <Avatar i={i} size={40} />
              </button>
            ))}
          </div>
        </div>

        {inviting ? (
          <>
            <button
              className="primary big wide"
              disabled={!ready || !preview || full}
              onClick={() => void join(invite!)}
            >
              {full ? 'This room is full' : 'Join the game'}
            </button>
            <p className="center" style={{ marginTop: 12 }}>
              <button className="link" onClick={dropInvite}>
                Create my own room instead
              </button>
            </p>
          </>
        ) : (
          <>
            {preset && (
              <div className="preset-note">
                <p id="preset-desc">Your room will start with: {describePreset(preset)}</p>
                <button
                  type="button"
                  className="link"
                  aria-describedby="preset-desc"
                  onClick={() => {
                    onDropPreset();
                    // This button goes away with the notice: move focus on, not to the page top.
                    // A disabled Create can't take it; then the name field, which is
                    // what usually holds Create back.
                    const create = createButton.current;
                    (create && !create.disabled ? create : nameInput.current)?.focus();
                  }}
                >
                  Remove
                </button>
              </div>
            )}
            <button
              ref={createButton}
              className="primary big wide"
              disabled={!ready}
              onClick={() => onCreate(clean, avatar)}
            >
              Create a room
            </button>
            <div className="divider">or join with a code</div>
            <div className="join-row">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && ready && code.length >= 4) void join(code);
                }}
                placeholder="CODE"
                aria-label="Room code"
              />
              <button disabled={!ready || code.length < 4} onClick={() => void join(code)}>
                Join
              </button>
            </div>
          </>
        )}

        {!connected && <p className="muted center" style={{ marginTop: 14 }}>Connecting to the server…</p>}
      </div>
    </div>
  );
}
