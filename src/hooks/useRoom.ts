import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  Player,
  Result,
  RoomSettings,
  RoundState,
} from '../generated/contract';
import { socket } from '../lib/socket';
import { clearSession, loadSession, saveSession } from '../lib/session';

export interface RoomSnapshot {
  roomCode: string;
  players: Player[];
  settings: RoomSettings;
  round: RoundState;
  youId: string;
}

export interface UseRoom {
  connected: boolean;
  room: RoomSnapshot | null;
  messages: ChatMessage[];
  busy: boolean;
  error: string | null;
  you: Player | null;
  isHost: boolean;
  create: (name: string, avatar: number) => Promise<void>;
  join: (roomCode: string, name: string, avatar: number) => Promise<void>;
  updateSettings: (patch: Partial<RoomSettings>) => Promise<void>;
  start: () => Promise<void>;
  leave: () => void;
  dismissError: () => void;
}

const MAX_MESSAGES = 200;

export function useRoom(): UseRoom {
  const [connected, setConnected] = useState(socket.connected);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** StrictMode double-mounts in dev; resume must not fire twice. */
  const resumed = useRef(false);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      const s = loadSession();
      if (s && !resumed.current) {
        resumed.current = true;
        socket.emit('room:resume', s, (r) => {
          // A stale token just means the room is gone; drop it silently
          // rather than greeting the player with an error on page load.
          if (!r.ok) clearSession();
        });
      }
    };
    const onDisconnect = () => setConnected(false);

    const onState = (p: {
      roomCode: string;
      players: Player[];
      settings: RoomSettings;
      round: RoundState;
      you: { playerId: string };
    }) => {
      setRoom({
        roomCode: p.roomCode,
        players: p.players,
        settings: p.settings,
        round: p.round,
        youId: p.you.playerId,
      });
    };
    const onPlayers = (p: { players: Player[] }) =>
      setRoom((r) => (r ? { ...r, players: p.players } : r));
    const onRound = (p: RoundState) =>
      setRoom((r) => (r ? { ...r, round: p } : r));
    const onMessage = (m: ChatMessage) =>
      setMessages((prev) => [...prev, m].slice(-MAX_MESSAGES));

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onState);
    socket.on('room:players', onPlayers);
    socket.on('round:state', onRound);
    socket.on('chat:message', onMessage);
    socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onState);
      socket.off('room:players', onPlayers);
      socket.off('round:state', onRound);
      socket.off('chat:message', onMessage);
    };
  }, []);

  /** Wraps an ack-style emit so every caller gets the same busy/error handling. */
  const request = useCallback(
    <T extends object>(
      run: (ack: (r: Result<T>) => void) => void,
    ): Promise<Result<T>> => {
      setBusy(true);
      setError(null);
      return new Promise((resolve) => {
        run((r) => {
          setBusy(false);
          if (!r.ok) setError(r.message);
          resolve(r);
        });
      });
    },
    [],
  );

  const create = useCallback(
    async (name: string, avatar: number) => {
      const r = await request<{ roomCode: string; token: string }>((ack) =>
        socket.emit('room:create', { name, avatar }, ack),
      );
      if (r.ok) saveSession({ roomCode: r.roomCode, token: r.token });
    },
    [request],
  );

  const join = useCallback(
    async (roomCode: string, name: string, avatar: number) => {
      const r = await request<{ token: string }>((ack) =>
        socket.emit('room:join', { roomCode, name, avatar }, ack),
      );
      if (r.ok) saveSession({ roomCode: roomCode.toUpperCase(), token: r.token });
    },
    [request],
  );

  const updateSettings = useCallback(
    async (patch: Partial<RoomSettings>) => {
      await request((ack) => socket.emit('room:settings', patch, ack));
    },
    [request],
  );

  const start = useCallback(async () => {
    await request((ack) => socket.emit('room:start', {}, ack));
  }, [request]);

  const leave = useCallback(() => {
    clearSession();
    resumed.current = false;
    setRoom(null);
    setMessages([]);
    socket.disconnect();
    socket.connect();
  }, []);

  const you = room?.players.find((p) => p.id === room.youId) ?? null;

  return {
    connected,
    room,
    messages,
    busy,
    error,
    you,
    isHost: you?.isHost ?? false,
    create,
    join,
    updateSettings,
    start,
    leave,
    dismissError: () => setError(null),
  };
}
