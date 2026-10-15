import { useState } from 'react';
import type { ChatMessage, Result, RoomSettings, Stroke } from '../generated/contract';
import { Board } from './Board';
import { Chat } from './Chat';
import type { RoomSnapshot } from '../hooks/useRoom';
import { AVATARS, Avatar } from './Avatar';
import { InviteLink } from './InviteLink';
import { KickButton } from './KickButton';
import { RoomSettingsPanel } from './RoomSettingsPanel';

interface Props {
  room: RoomSnapshot;
  isHost: boolean;
  busy: boolean;
  /** False while reconnecting: drawing pauses until the seat is back. */
  online: boolean;
  messages: ChatMessage[];
  onSettings: (patch: Partial<Omit<RoomSettings, 'customWordCount'>>) => void;
  onCustomWords: (text: string) => Promise<Result<{ accepted: number; rejected: string[] }>>;
  onStart: () => void;
  onLeave: () => void;
  onDrawStart: (s: Stroke) => void;
  onDrawAppend: (id: string, points: number[]) => void;
  onUndo: () => void;
  onClear: () => void;
  onProfile: (patch: { name?: string; avatar?: number }) => Promise<Result>;
  onGuess: (text: string) => void;
  onKick: (playerId: string) => void;
}


export function Lobby({
  room, isHost, busy, online, messages, onSettings, onCustomWords, onStart, onLeave,
  onDrawStart, onDrawAppend, onUndo, onClear, onProfile, onGuess, onKick,
}: Props) {
  const present = room.players.filter((p) => p.connected).length;
  const me = room.players.find((p) => p.id === room.youId);
  const host = room.players.find((p) => p.isHost);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftAvatar, setDraftAvatar] = useState(0);
  // A few dashed "waiting" tiles make an empty lobby read as an invitation.
  const openSeats = Math.max(0, Math.min(3, room.settings.maxPlayers - present));

  const startEdit = () => {
    setDraftName(me?.name ?? '');
    setDraftAvatar(me?.avatar ?? 0);
    setEditing(true);
  };
  const saveEdit = async () => {
    const name = draftName.trim();
    if (!name || !me) return;
    const patch: { name?: string; avatar?: number } = {};
    if (name !== me.name) patch.name = name;
    if (draftAvatar !== me.avatar) patch.avatar = draftAvatar;
    if (!Object.keys(patch).length) return setEditing(false);
    const r = await onProfile(patch);
    if (r.ok) setEditing(false);
  };

  return (
    <div className="lobby">
      <div className="card lobby-top">
        <div>
          <div className="label">Room code</div>
          <div className="room-code">{room.roomCode}</div>
        </div>
        <div style={{ flex: '1 1 320px', maxWidth: 540 }}>
          <div className="label" style={{ marginBottom: 6 }}>Send this link to your team</div>
          <InviteLink roomCode={room.roomCode} />
        </div>
        <button onClick={onLeave}>Leave room</button>
      </div>

      <div className="side">
        <div className="card lobby-players">
          <div className="row-between" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Players ({present}/{room.settings.maxPlayers})</h3>
            {me && !editing && (
              <button className="small" onClick={startEdit}>Change name or avatar</button>
            )}
          </div>
          <div className="player-grid">
            {room.players.map((p) => (
              <div
                key={p.id}
                className={`player-tile ${p.id === room.youId ? 'me' : ''} ${p.connected ? '' : 'away'}`}
              >
                {p.isHost && <span className="crown" title="Host">👑</span>}
                <Avatar i={p.avatar} size={52} />
                <span className="pname">{p.name}</span>
                <span className="note">
                  {p.id === room.youId ? 'You' : !p.connected ? 'Away' : p.isHost ? 'Host' : ' '}
                </span>
                <KickButton
                  player={p}
                  youId={room.youId}
                  isHost={isHost}
                  present={present}
                  onKick={onKick}
                />
              </div>
            ))}
            {Array.from({ length: openSeats }, (_, i) => (
              <div key={`open-${i}`} className="player-tile empty">Waiting…</div>
            ))}
          </div>

          {editing && (
            <form
              className="profile-edit"
              onSubmit={(e) => {
                e.preventDefault();
                void saveEdit();
              }}
            >
              <label className="field" style={{ marginBottom: 0 }}>
                <span>Your name</span>
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  maxLength={20}
                  autoFocus
                />
              </label>
              <div className="avatar-grid">
                {AVATARS.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`avatar-pick ${i === draftAvatar ? 'on' : ''}`}
                    onClick={() => setDraftAvatar(i)}
                    aria-label={`Avatar ${i + 1}`}
                    aria-pressed={i === draftAvatar}
                  >
                    <Avatar i={i} size={38} />
                  </button>
                ))}
              </div>
              <div className="row">
                <button className="primary" type="submit" disabled={busy || !draftName.trim()}>
                  Save
                </button>
                <button type="button" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </form>
          )}
        </div>

        <div className="stage lobby-doodle">
          <div className="row-between" style={{ color: 'var(--paper)' }}>
            <h3 style={{ margin: 0 }}>Doodle while you wait</h3>
            <span style={{ fontWeight: 800, opacity: 0.85 }}>Everyone can draw here</span>
          </div>
          <Board
            canDraw={online}
            onDrawStart={onDrawStart}
            onDrawAppend={onDrawAppend}
            onUndo={onUndo}
            onClear={onClear}
          />
        </div>
      </div>

      <div className="side">
        <div className="start-bar">
          {isHost ? (
            <button className="primary big wide" disabled={busy || present < 2} onClick={onStart}>
              {present < 2 ? 'Invite one more player to start' : 'Start the game!'}
            </button>
          ) : (
            <div className="card center" style={{ width: '100%' }}>
              <strong>Waiting for {host?.name ?? 'the host'} to start…</strong>
            </div>
          )}
        </div>

        <RoomSettingsPanel
          settings={room.settings}
          isHost={isHost}
          busy={busy}
          hostName={host?.name ?? null}
          hostWords={room.hostWords}
          onSettings={onSettings}
          onCustomWords={onCustomWords}
        />

        <Chat
          messages={messages}
          canGuess
          placeholder="Say hi to the room…"
          closeHint={null}
          onGuess={onGuess}
          title="Chat"
        />
      </div>
    </div>
  );
}
