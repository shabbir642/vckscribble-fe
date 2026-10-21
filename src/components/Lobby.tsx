import { useEffect, useId, useRef, useState } from 'react';
import {
  MAX_PLAYERS,
  type ChatMessage,
  type Result,
  type RoomSettings,
  type Stroke,
  type TeamId,
} from '../generated/contract';
import { Board } from './Board';
import { Chat } from './Chat';
import type { RoomSnapshot } from '../hooks/useRoom';
import { AVATARS, Avatar } from './Avatar';
import { InviteLink } from './InviteLink';
import { KickButton } from './KickButton';
import { RoomSettingsPanel } from './RoomSettingsPanel';
import {
  ModeSwitch,
  PlayerChip,
  TeamCards,
  TeamStatus,
  notReadyLabel,
  readiness,
  teamViews,
  versus,
} from './Teams';

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
  onJoinTeam: (teamId: TeamId) => Promise<Result>;
  onShuffleTeams: () => Promise<Result>;
  onRenameTeam: (teamId: TeamId, name: string) => Promise<Result>;
}

/**
 * Past this many players here (room sizes that didn't exist before rooms of
 * 30), the roster turns compact so Start and the settings stay within reach.
 */
const COMPACT_FROM = 16;

export function Lobby({
  room, isHost, busy, online, messages, onSettings, onCustomWords, onStart, onLeave,
  onDrawStart, onDrawAppend, onUndo, onClear, onProfile, onGuess, onKick,
  onJoinTeam, onShuffleTeams, onRenameTeam,
}: Props) {
  const present = room.players.filter((p) => p.connected).length;
  const me = room.players.find((p) => p.id === room.youId);
  const host = room.players.find((p) => p.isHost);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftAvatar, setDraftAvatar] = useState(0);
  // A few dashed "waiting" tiles make an empty lobby read as an invitation.
  const openSeats = Math.max(0, Math.min(3, room.settings.maxPlayers - present));
  const compact = present > COMPACT_FROM;
  // Full at a limit the host chose: whoever comes next is turned away.
  const full = present >= room.settings.maxPlayers && room.settings.maxPlayers < MAX_PLAYERS;

  const views = room.settings.mode === 'teams' ? teamViews(room.players, room.settings, room.teams) : null;
  const status = views ? readiness(views) : null;
  // On none of the game's teams: only ever for a moment, but nobody is hidden.
  const teamless = views
    ? room.players.filter((p) => !views.some((v) => v.id === (p.teamId ?? null)))
    : [];
  const canStart = status ? status.ready : present >= 2;
  const startLabel = status
    ? status.ready ? 'Start the game!' : notReadyLabel(status.short)
    : present < 2 ? 'Invite one more player to start' : 'Start the game!';

  // Uneven teams may start, but the host is asked first.
  const uneven = status && status.ready && status.uneven ? versus(status.sizes) : null;
  const [confirming, setConfirming] = useState(false);
  const asking = confirming && uneven !== null;
  const askId = useId();
  const startButton = useRef<HTMLButtonElement>(null);
  const firstChoice = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);
  // Teams that even out, or stop being ready, take the question with them.
  useEffect(() => {
    if (uneven === null) setConfirming(false);
  }, [uneven]);
  useEffect(() => {
    if (asking) {
      asked.current = true;
      firstChoice.current?.focus();
      return;
    }
    if (!asked.current) return;
    asked.current = false;
    // The question took focus away with it: hand it back to Start.
    const active = document.activeElement;
    if (!active || active === document.body) startButton.current?.focus();
  }, [asking]);

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
  const joinTeam = (teamId: TeamId) => void onJoinTeam(teamId);
  const shuffle = () => void onShuffleTeams();

  // Above team cards or a big room's roster, the form opens right under its
  // button rather than below everyone; a classic room keeps it under the grid.
  const formFirst = views !== null || compact;
  const profileForm = editing && (
    <form
      className={formFirst ? 'profile-edit lobby-team-profile' : 'profile-edit'}
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
  );

  return (
    <div className="lobby">
      <div className="card lobby-top">
        <div>
          <div className="label">Room code</div>
          <div className="room-code">{room.roomCode}</div>
        </div>
        <div style={{ flex: '1 1 320px', maxWidth: 540 }}>
          <div className="label" style={{ marginBottom: 6 }}>Send this link to your friends</div>
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
          {formFirst && profileForm}

          <ModeSwitch
            settings={room.settings}
            isHost={isHost}
            busy={busy}
            onSettings={onSettings}
          />

          {isHost && full && (
            <div className="lobby-team-full">
              <p role="status">The room is full, so anyone else is turned away.</p>
              <button className="small" disabled={busy} onClick={() => onSettings({ maxPlayers: MAX_PLAYERS })}>
                Make room for {MAX_PLAYERS}
              </button>
            </div>
          )}

          {views && status ? (
            <>
              <TeamStatus
                views={views}
                status={status}
                youId={room.youId}
                isHost={isHost}
                busy={busy}
                present={present}
                onJoin={joinTeam}
                onSettings={onSettings}
                onShuffle={shuffle}
              />
              <TeamCards
                views={views}
                youId={room.youId}
                isHost={isHost}
                busy={busy}
                present={present}
                compact={compact}
                onJoin={joinTeam}
                onRename={onRenameTeam}
                onKick={onKick}
              />
              {teamless.length > 0 && (
                <div className="lobby-team-loose">
                  <h4>Not on a team yet</h4>
                  <ul className="lobby-team-members compact">
                    {teamless.map((p) => (
                      <PlayerChip
                        key={p.id}
                        player={p}
                        youId={room.youId}
                        isHost={isHost}
                        present={present}
                        compact
                        onKick={onKick}
                      />
                    ))}
                  </ul>
                </div>
              )}
              <p className="lobby-team-how">
                Teams take turns. When your team is up, one of you draws and the rest guess: the first
                right answer wins the points. When another team draws, you see the word, so keep it secret!
              </p>
            </>
          ) : compact ? (
            <ul className="lobby-team-members compact lobby-team-roster">
              {room.players.map((p) => (
                <PlayerChip
                  key={p.id}
                  player={p}
                  youId={room.youId}
                  isHost={isHost}
                  present={present}
                  compact
                  onKick={onKick}
                />
              ))}
            </ul>
          ) : (
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
          )}

          {!formFirst && profileForm}
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
        {/* On a phone the host's bar rides the bottom of the screen: Start is always in reach. */}
        <div className={isHost ? 'start-bar lobby-team-sticky' : 'start-bar'}>
          {isHost ? (
            asking ? (
              <div
                className="card lobby-team-confirm"
                role="group"
                aria-labelledby={askId}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setConfirming(false);
                }}
              >
                <p id={askId}>Teams are uneven ({uneven})</p>
                <div className="row">
                  <button
                    ref={firstChoice}
                    disabled={busy}
                    onClick={() => {
                      setConfirming(false);
                      shuffle();
                    }}
                  >
                    Shuffle teams
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(false);
                      onStart();
                    }}
                  >
                    Start anyway
                  </button>
                </div>
              </div>
            ) : (
              <button
                ref={startButton}
                className="primary big wide"
                disabled={busy || !canStart}
                onClick={() => (uneven !== null ? setConfirming(true) : onStart())}
              >
                {startLabel}
              </button>
            )
          ) : (
            <div className="card center" style={{ width: '100%' }}>
              <strong>Waiting for {host?.name ?? 'the host'} to start…</strong>
            </div>
          )}
        </div>

        <RoomSettingsPanel
          settings={room.settings}
          players={room.players}
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
