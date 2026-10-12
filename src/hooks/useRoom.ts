import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  Player,
  Result,
  RoomSettings,
  RoundState,
  Stroke,
  WordChoice,
} from '../generated/contract';
import { socket } from '../lib/socket';
import { clearSession, loadSession, saveSession } from '../lib/session';
import { sfx } from '../lib/sound';

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
  strokes: Stroke[];
  /** Bumped on undo/clear so the canvas knows to rebuild its cache. */
  generation: number;
  /** Drawer only: the three on offer, plus whether a custom word is allowed. */
  wordOptions: { choices: WordChoice[]; allowCustom: boolean } | null;
  /** Drawer only: the solution they are drawing. */
  assignedWord: string | null;
  secondsLeft: number;
  closeHint: string | null;
  finalScores: Player[] | null;
  busy: boolean;
  error: string | null;
  you: Player | null;
  isHost: boolean;
  create: (name: string, avatar: number) => Promise<void>;
  join: (roomCode: string, name: string, avatar: number) => Promise<void>;
  updateSettings: (patch: Partial<RoomSettings>) => Promise<void>;
  start: () => Promise<void>;
  chooseWord: (wordId: number) => Promise<void>;
  customWord: (text: string) => Promise<void>;
  sendGuess: (text: string) => void;
  reportWord: () => void;
  sendStroke: (s: Stroke) => void;
  undo: () => void;
  clear: () => void;
  leave: () => void;
  dismissError: () => void;
}

const MAX_MESSAGES = 200;

export function useRoom(): UseRoom {
  const [connected, setConnected] = useState(socket.connected);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [generation, setGeneration] = useState(0);
  const [wordOptions, setWordOptions] =
    useState<{ choices: WordChoice[]; allowCustom: boolean } | null>(null);
  const [assignedWord, setAssignedWord] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [closeHint, setCloseHint] = useState<string | null>(null);
  const [finalScores, setFinalScores] = useState<Player[] | null>(null);
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
    const onRound = (p: RoundState) => {
      setRoom((r) => {
        if (r) {
          if (p.phase === 'reveal' && r.round.phase !== 'reveal') sfx.roundEnd();
          if (p.phase === 'finished' && r.round.phase !== 'finished') sfx.finish();
          // Your own solve: in the new guessed list but not the old one.
          const was = r.round.guessedPlayerIds.includes(r.youId);
          if (!was && p.guessedPlayerIds.includes(r.youId)) sfx.correct();
        }
        return r ? { ...r, round: p } : r;
      });
      // Options and the assigned word are per-turn; clear them on every change
      // so a stale picker can never linger into the next phase.
      if (p.phase !== 'selecting') setWordOptions(null);
      if (p.phase !== 'drawing') setAssignedWord(null);
      if (p.phase === 'lobby') setFinalScores(null);
    };
    const onOptions = (p: { choices: WordChoice[]; allowCustom: boolean }) => {
      setWordOptions(p);
      sfx.yourTurn();
    };
    const onAssigned = (p: { text: string }) => setAssignedWord(p.text);
    const onTick = (p: { secondsLeft: number }) => {
      setSecondsLeft(p.secondsLeft);
      if (p.secondsLeft > 0 && p.secondsLeft <= 5) sfx.tick();
    };
    const onHintMask = (p: { maskedWord: string }) =>
      setRoom((r) => (r ? { ...r, round: { ...r.round, maskedWord: p.maskedWord } } : r));
    const onClose = (p: { text: string }) => {
      setCloseHint(p.text);
      setTimeout(() => setCloseHint(null), 2500);
    };
    const onScores = (p: { players: Player[]; final: boolean }) => {
      setRoom((r) => (r ? { ...r, players: p.players } : r));
      if (p.final) setFinalScores(p.players);
    };
    const onMessage = (m: ChatMessage) => {
      if (m.channel === 'system' && m.text.includes('guessed it')) sfx.someoneGuessed();
      setMessages((prev) => [...prev, m].slice(-MAX_MESSAGES));
    };

    // Upsert by id: a drag streams under one id as it grows.
    const onStroke = (p: { stroke: Stroke }) =>
      setStrokes((prev) => {
        const at = prev.findIndex((s) => s.id === p.stroke.id);
        if (at === -1) return [...prev, p.stroke];
        const next = prev.slice();
        next[at] = p.stroke;
        return next;
      });
    const onUndo = (p: { strokeId: string }) => {
      setStrokes((prev) => prev.filter((s) => s.id !== p.strokeId));
      setGeneration((g) => g + 1);
    };
    const onClear = () => {
      setStrokes([]);
      setGeneration((g) => g + 1);
    };
    const onSync = (p: { strokes: Stroke[] }) => {
      setStrokes(p.strokes);
      setGeneration((g) => g + 1);
    };
    const onToast = (p: { message: string }) => setError(p.message);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onState);
    socket.on('room:players', onPlayers);
    socket.on('round:state', onRound);
    socket.on('chat:message', onMessage);
    socket.on('word:options', onOptions);
    socket.on('word:assigned', onAssigned);
    socket.on('round:tick', onTick);
    socket.on('round:hint', onHintMask);
    socket.on('chat:close', onClose);
    socket.on('game:scores', onScores);
    socket.on('draw:stroke', onStroke);
    socket.on('draw:undo', onUndo);
    socket.on('draw:clear', onClear);
    socket.on('draw:sync', onSync);
    socket.on('error:toast', onToast);
    socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onState);
      socket.off('room:players', onPlayers);
      socket.off('round:state', onRound);
      socket.off('chat:message', onMessage);
      socket.off('word:options', onOptions);
      socket.off('word:assigned', onAssigned);
      socket.off('round:tick', onTick);
      socket.off('round:hint', onHintMask);
      socket.off('chat:close', onClose);
      socket.off('game:scores', onScores);
      socket.off('draw:stroke', onStroke);
      socket.off('draw:undo', onUndo);
      socket.off('draw:clear', onClear);
      socket.off('draw:sync', onSync);
      socket.off('error:toast', onToast);
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

  const chooseWord = useCallback(
    async (wordId: number) => {
      const r = await request((ack) => socket.emit('word:choose', { wordId }, ack));
      if (r.ok) setWordOptions(null);
    },
    [request],
  );

  const customWord = useCallback(
    async (text: string) => {
      const r = await request((ack) => socket.emit('word:custom', { text }, ack));
      if (r.ok) setWordOptions(null);
    },
    [request],
  );

  const sendGuess = useCallback((text: string) => {
    socket.emit('chat:guess', { text });
  }, []);

  const reportWord = useCallback(() => {
    socket.emit('word:report', { reason: 'inappropriate' }, () => undefined);
  }, []);

  /** Optimistic: the drawer sees their own line immediately, no round trip. */
  const sendStroke = useCallback((stroke: Stroke) => {
    setStrokes((prev) => {
      const at = prev.findIndex((s) => s.id === stroke.id);
      if (at === -1) return [...prev, stroke];
      const next = prev.slice();
      next[at] = stroke;
      return next;
    });
    socket.emit('draw:stroke', { stroke });
  }, []);

  const undo = useCallback(() => socket.emit('draw:undo', {}), []);
  const clear = useCallback(() => socket.emit('draw:clear', {}), []);

  const leave = useCallback(() => {
    clearSession();
    resumed.current = false;
    setRoom(null);
    setMessages([]);
    setStrokes([]);
    setGeneration((g) => g + 1);
    socket.disconnect();
    socket.connect();
  }, []);

  const you = room?.players.find((p) => p.id === room.youId) ?? null;

  return {
    connected,
    room,
    messages,
    strokes,
    generation,
    wordOptions,
    assignedWord,
    secondsLeft,
    closeHint,
    finalScores,
    busy,
    error,
    you,
    isHost: you?.isHost ?? false,
    create,
    join,
    updateSettings,
    start,
    chooseWord,
    customWord,
    sendGuess,
    reportWord,
    sendStroke,
    undo,
    clear,
    leave,
    dismissError: () => setError(null),
  };
}
