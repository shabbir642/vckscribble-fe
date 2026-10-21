import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  GameSummary,
  Player,
  Reaction,
  Result,
  RoomPreview,
  RoomSettings,
  RoundPhase,
  RoundState,
  Stroke,
  WordChoice,
} from '../generated/contract';
import { connectFor, onShardOf, routeTo, socket } from '../lib/socket';
import {
  clearSession,
  deviceId,
  loadSession,
  loadTabSession,
  roomFromUrl,
  saveProfile,
  saveSession,
  setUrlRoom,
} from '../lib/session';
import { sfx } from '../lib/sound';
import { strokeStore } from '../lib/strokes';
import { dropPlayback, playPoints } from '../lib/playback';
import { callAttention } from '../lib/attention';

export interface RoomSnapshot {
  roomCode: string;
  players: Player[];
  settings: RoomSettings;
  round: RoundState;
  youId: string;
  /** The custom word list: only ever present for the host. */
  hostWords: string[] | null;
}

export interface UseRoom {
  connected: boolean;
  room: RoomSnapshot | null;
  messages: ChatMessage[];
  /** Reactions just made, for the floating 👍/👎 over the canvas. */
  reactionFeed: { id: number; reaction: Reaction; name: string }[];
  /** This player's own vote on the current drawing. */
  myReaction: Reaction | null;
  react: (reaction: Reaction) => void;
  /** True while re-taking a seat: on page load, or after a dropped connection. */
  reconnecting: boolean;
  /** Drawer only: the three on offer, plus whether a custom word is allowed. */
  wordOptions: { choices: WordChoice[]; allowCustom: boolean } | null;
  /** Drawer only: the solution they are drawing. */
  assignedWord: string | null;
  secondsLeft: number;
  closeHint: string | null;
  /** The last game's final scores; null from the moment a game starts until it ends. */
  finalScores: Player[] | null;
  /**
   * The server's summary of the game that just ended: awards, the drawing of
   * the game, everyone's numbers. It arrives just before the game's end (and
   * again on a refresh), and stays until the next game starts.
   */
  summary: GameSummary | null;
  busy: boolean;
  error: string | null;
  you: Player | null;
  isHost: boolean;
  create: (name: string, avatar: number) => Promise<void>;
  join: (roomCode: string, name: string, avatar: number) => Promise<Result>;
  /** What an invite code points at, without joining. */
  peek: (roomCode: string) => Promise<Result<RoomPreview>>;
  /** Host: kick a player. Anyone else: vote to kick (again to withdraw). */
  kick: (playerId: string) => Promise<void>;
  /** Rename / re-avatar yourself; lobby only. */
  updateProfile: (patch: { name?: string; avatar?: number }) => Promise<Result>;
  updateSettings: (patch: Partial<Omit<RoomSettings, 'customWordCount'>>) => Promise<void>;
  /** Host: replace the custom word list. */
  setCustomWords: (text: string) => Promise<Result<{ accepted: number; rejected: string[] }>>;
  start: () => Promise<void>;
  /** Host: stop the game, or leave the podium, and go back to the lobby. */
  restart: () => Promise<void>;
  chooseWord: (wordId: number) => Promise<void>;
  customWord: (text: string) => Promise<void>;
  sendGuess: (text: string) => void;
  reportWord: () => void;
  drawStart: (s: Stroke) => void;
  drawAppend: (id: string, points: number[]) => void;
  undo: () => void;
  clear: () => void;
  leave: () => void;
  dismissError: () => void;
}

const MAX_MESSAGES = 200;

/**
 * Strokes this browser drew. The server echoes every stroke to the whole room,
 * the drawer included (one broadcast is far cheaper for it than "everyone but
 * you"); the canvas already painted ours locally, so the echo is skipped.
 * Ids are random per stroke; the set is emptied whenever the canvas is, and
 * capped in case it never is.
 */
const ownStrokes = new Set<string>();
const MAX_OWN_STROKES = 5000;
function markOwn(id: string): void {
  if (ownStrokes.size >= MAX_OWN_STROKES) {
    const oldest = ownStrokes.values().next().value;
    if (oldest !== undefined) ownStrokes.delete(oldest);
  }
  ownStrokes.add(id);
}

export function useRoom(): UseRoom {
  const [connected, setConnected] = useState(socket.connected);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reconnecting, setReconnecting] = useState(false);
  const [reactionFeed, setReactionFeed] = useState<UseRoom['reactionFeed']>([]);
  const [myReaction, setMyReaction] = useState<Reaction | null>(null);
  const [wordOptions, setWordOptions] =
    useState<{ choices: WordChoice[]; allowCustom: boolean } | null>(null);
  const [assignedWord, setAssignedWord] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [closeHint, setCloseHint] = useState<string | null>(null);
  const [finalScores, setFinalScores] = useState<Player[] | null>(null);
  const [summary, setSummary] = useState<GameSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Guards against a second resume while one is still in flight. */
  const resuming = useRef(false);
  /** Set once another tab was found holding the shared seat: don't ask again. */
  const sharedSeatTaken = useRef(false);
  /** Set between a successful resume and the drawing resync that follows it. */
  const awaitingSync = useRef(false);
  /** Whether this page currently shows a room, readable from socket handlers. */
  const inRoom = useRef(false);
  inRoom.current = room !== null;
  /** The phase this page last heard of, to tell when a new game begins. */
  const lastPhase = useRef<RoundPhase | null>(null);

  /** Back to the home screen, e.g. when the room no longer exists. */
  const resetRoom = useCallback(() => {
    // Clear the URL before Home renders, or it reads the old code as an invite.
    setUrlRoom(null);
    setRoom(null);
    setMessages([]);
    setWordOptions(null);
    setAssignedWord(null);
    setFinalScores(null);
    setSummary(null);
    lastPhase.current = null;
    dropPlayback();
    strokeStore.clear();
  }, []);

  useEffect(() => {
    /**
     * Every (re)connection re-seats the player. A socket reconnect gets a new
     * id the server has never seen, so without this the page keeps showing the
     * game while receiving nothing. This used to run once per page load, so the
     * second wifi blip left the player silently frozen.
     */
    const onConnect = () => {
      setConnected(true);
      const s = loadSession();
      // An invite link to a different room wins over an old seat: whoever
      // opened it means to join *that* room, not be dropped back into the last
      // one they played in.
      const invite = roomFromUrl();
      if (!s || (invite && invite !== s.roomCode && !inRoom.current)) {
        setReconnecting(false);
        return;
      }
      // Connected to another game-server process (say, to join a different
      // room): this seat is not here to resume, and is still valid.
      if (!onShardOf(s.roomCode)) {
        setReconnecting(false);
        return;
      }
      if (resuming.current) return;
      resuming.current = true;
      setReconnecting(true);
      // Only a tab resuming its own seat may take it from another connection.
      const takeover = loadTabSession()?.token === s.token;
      if (!takeover && sharedSeatTaken.current) {
        setReconnecting(false);
        return;
      }
      socket.emit('room:resume', { ...s, takeover }, (r) => {
        resuming.current = false;
        if (r.ok) {
          // The seat is back, but the drawing resync follows the ack: stay in
          // "reconnecting" (brush paused) until it lands, so nothing is drawn
          // into a canvas that is about to be replaced. Fallback in case it
          // never comes.
          awaitingSync.current = true;
          setTimeout(() => {
            if (!awaitingSync.current) return;
            awaitingSync.current = false;
            setReconnecting(false);
          }, 3000);
          return;
        }
        setReconnecting(false);
        if (r.code === 'WRONG_SHARD') {
          // The server has a different number of processes than we thought:
          // re-ask and reconnect to the right one, which resumes from there.
          void routeTo(s.roomCode, true);
          return;
        }
        if (r.code === 'SEAT_IN_USE') {
          sharedSeatTaken.current = true;
          // Another tab is playing this seat. Leave it alone and start this
          // tab at the home screen, where it can join as someone else.
          if (inRoom.current) resetRoom();
          setError('You’re already in this game in another tab. Join here with a different name.');
          return;
        }
        // The room is gone — a server restart, or it was collected. Leave it
        // rather than showing a game that will never move again.
        clearSession();
        if (inRoom.current) {
          resetRoom();
          setError('That game has ended — the server restarted or the room closed.');
        }
        setUrlRoom(null);
      });
    };
    const onDisconnect = () => {
      setConnected(false);
      if (loadSession()) setReconnecting(true);
    };

    /**
     * The last game's results stay through its podium and are dropped once a
     * new game starts: from the podium (play again goes straight to the next
     * turn) or from the lobby. Also when a reconnect lands mid-game, having
     * missed the start. Never on the way into `finished`: the summary comes
     * just before it.
     */
    const enterPhase = (next: RoundPhase) => {
      const prev = lastPhase.current;
      lastPhase.current = next;
      const between = (phase: RoundPhase | null) => phase === 'finished' || phase === 'lobby';
      if (next === 'lobby' || (between(prev) && !between(next))) {
        setFinalScores(null);
        setSummary(null);
      }
    };

    const onState = (p: {
      roomCode: string;
      players: Player[];
      settings: RoomSettings;
      round: RoundState;
      you: { playerId: string };
      hostWords?: string[];
    }) => {
      enterPhase(p.round.phase);
      setRoom({
        roomCode: p.roomCode,
        players: p.players,
        settings: p.settings,
        round: p.round,
        youId: p.you.playerId,
        hostWords: p.hostWords ?? null,
      });
    };
    const onPlayers = (p: { players: Player[] }) =>
      setRoom((r) => (r ? { ...r, players: p.players } : r));
    const onRound = (p: RoundState) => {
      enterPhase(p.phase);
      // A new turn starts with fresh votes.
      if (p.phase !== 'drawing') setMyReaction(null);
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
    };
    const onOptions = (p: { choices: WordChoice[]; allowCustom: boolean }) => {
      setWordOptions(p);
      sfx.yourTurn();
      callAttention('✏️ Your turn to draw!');
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
    // Kept in whatever phase it lands: it is sent just before the game ends.
    const onSummary = (s: GameSummary) => setSummary(s);
    const onMessage = (m: ChatMessage) => {
      if (m.channel === 'system' && m.text.includes('guessed it')) sfx.someoneGuessed();
      setMessages((prev) => [...prev, m].slice(-MAX_MESSAGES));
    };

    let feedId = 0;
    const onReaction = (p: { playerName: string; reaction: Reaction; likes: number; dislikes: number }) => {
      setRoom((r) => (r ? { ...r, round: { ...r.round, likes: p.likes, dislikes: p.dislikes } } : r));
      const id = ++feedId;
      setReactionFeed((f) => [...f.slice(-11), { id, reaction: p.reaction, name: p.playerName }]);
      setTimeout(() => setReactionFeed((f) => f.filter((x) => x.id !== id)), 1800);
    };

    // Drawing traffic goes straight to the canvas's store, never to React.
    const onStroke = (p: { stroke: Stroke }) => {
      if (ownStrokes.has(p.stroke.id)) return;
      // A stroke sent again replaces the old one; its queued points are stale.
      dropPlayback(p.stroke.id);
      strokeStore.put(p.stroke);
    };
    const onPoints = (p: { strokeId: string; points: number[] }) => {
      if (!ownStrokes.has(p.strokeId)) playPoints(p.strokeId, p.points);
    };
    const onUndo = (p: { strokeId: string }) => {
      dropPlayback(p.strokeId);
      strokeStore.remove(p.strokeId);
    };
    const onClear = () => {
      ownStrokes.clear();
      dropPlayback();
      strokeStore.clear();
    };
    const onSync = (p: { strokes: Stroke[] }) => {
      // ownStrokes is kept: a stroke still being drawn across the resync
      // must go on ignoring its echo.
      dropPlayback();
      strokeStore.replaceAll(p.strokes);
      if (awaitingSync.current) {
        awaitingSync.current = false;
        setReconnecting(false);
      }
    };
    const onToast = (p: { message: string }) => setError(p.message);
    const onKicked = (p: { by: 'host' | 'vote' }) => {
      clearSession();
      resetRoom();
      setError(p.by === 'host' ? 'The host removed you from the room.' : 'The room voted to kick you out.');
    };

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
    socket.on('game:summary', onSummary);
    socket.on('draw:stroke', onStroke);
    socket.on('draw:points', onPoints);
    socket.on('draw:reaction', onReaction);
    socket.on('draw:undo', onUndo);
    socket.on('draw:clear', onClear);
    socket.on('draw:sync', onSync);
    socket.on('error:toast', onToast);
    socket.on('room:kicked', onKicked);
    if (socket.connected) onConnect();
    // To the process that owns the room this page is about: an invite link,
    // else the seat to resume (see lib/socket.ts).
    else void connectFor(roomFromUrl() ?? loadSession()?.roomCode ?? null);

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
      socket.off('game:summary', onSummary);
      socket.off('draw:stroke', onStroke);
      socket.off('draw:points', onPoints);
      socket.off('draw:reaction', onReaction);
      socket.off('draw:undo', onUndo);
      socket.off('draw:clear', onClear);
      socket.off('draw:sync', onSync);
      socket.off('error:toast', onToast);
      socket.off('room:kicked', onKicked);
    };
  }, [resetRoom]);

  /**
   * The address bar mirrors the room: `/?room=CODE` while you are in one, so
   * the URL is always a working invite, and `/` once you leave, so a dead code
   * never lingers to prefill the next visit.
   */
  const shownCode = useRef<string | null>(null);
  useEffect(() => {
    const code = room?.roomCode ?? null;
    if (code) setUrlRoom(code);
    else if (shownCode.current) setUrlRoom(null);
    shownCode.current = code;
  }, [room?.roomCode]);

  /** Wraps an ack-style emit so every caller gets the same busy/error handling. */
  const request = useCallback(
    <T extends object>(
      run: (ack: (r: Result<T>) => void) => void,
    ): Promise<Result<T>> => {
      // Offline, Socket.IO would queue the request and send it on reconnect —
      // before the seat is re-taken, so the server rejects it, and meanwhile the
      // button sits busy. Say so now instead.
      if (!socket.connected) {
        const message = 'You’re offline. Reconnecting…';
        setError(message);
        return Promise.resolve({ ok: false, code: 'INTERNAL', message } as Result<T>);
      }
      setBusy(true);
      setError(null);
      return new Promise((resolve) => {
        run((r) => {
          setBusy(false);
          // WRONG_SHARD is handled by re-routing, not shown.
          if (!r.ok && r.code !== 'WRONG_SHARD') setError(r.message);
          resolve(r);
        });
      });
    },
    [],
  );

  const create = useCallback(
    async (name: string, avatar: number) => {
      saveProfile({ name, avatar });
      const r = await request<{ roomCode: string; token: string }>((ack) =>
        socket.emit('room:create', { name, avatar, deviceId: deviceId() }, ack),
      );
      if (r.ok) saveSession({ roomCode: r.roomCode, token: r.token });
    },
    [request],
  );

  const join = useCallback(
    async (roomCode: string, name: string, avatar: number) => {
      saveProfile({ name, avatar });
      const attempt = () =>
        request<{ token: string }>((ack) =>
          socket.emit('room:join', { roomCode, name, avatar, deviceId: deviceId() }, ack),
        );
      await routeTo(roomCode);
      let r = await attempt();
      if (!r.ok && r.code === 'WRONG_SHARD') {
        await routeTo(roomCode, true);
        r = await attempt();
        if (!r.ok && r.code === 'WRONG_SHARD') setError(r.message);
      }
      if (r.ok) saveSession({ roomCode: roomCode.toUpperCase(), token: r.token });
      return r;
    },
    [request],
  );

  const peek = useCallback(async (roomCode: string) => {
    const attempt = () =>
      new Promise<Result<RoomPreview>>((resolve) =>
        socket.emit('room:peek', { roomCode }, resolve),
      );
    await routeTo(roomCode);
    const r = await attempt();
    if (r.ok || r.code !== 'WRONG_SHARD') return r;
    await routeTo(roomCode, true);
    return attempt();
  }, []);

  const updateProfile = useCallback(
    async (patch: { name?: string; avatar?: number }) => {
      const r = await request((ack) => socket.emit('player:update', patch, ack));
      if (r.ok) {
        const me = latestYou.current;
        if (me) saveProfile({ name: patch.name ?? me.name, avatar: patch.avatar ?? me.avatar });
      }
      return r;
    },
    [request],
  );

  const kick = useCallback(
    async (playerId: string) => {
      await request<{ kicked: boolean; votes: number; needed: number }>((ack) =>
        socket.emit('player:kick', { playerId }, ack),
      );
    },
    [request],
  );

  const updateSettings = useCallback(
    async (patch: Partial<Omit<RoomSettings, 'customWordCount'>>) => {
      await request((ack) => socket.emit('room:settings', patch, ack));
    },
    [request],
  );

  const setCustomWords = useCallback(
    (text: string) =>
      request<{ accepted: number; rejected: string[] }>((ack) =>
        socket.emit('room:customWords', { text }, ack),
      ),
    [request],
  );

  const start = useCallback(async () => {
    await request((ack) => socket.emit('room:start', {}, ack));
  }, [request]);

  const restart = useCallback(async () => {
    await request((ack) => socket.emit('room:restart', {}, ack));
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

  /**
   * Fire-and-forget events are dropped while offline rather than queued.
   * Socket.IO flushes its queue on reconnect *before* the client can re-take
   * its seat, so queued strokes and guesses all bounced with "You are not in a
   * room". The rejoin resyncs the drawing instead (`draw:sync`).
   */
  const sendGuess = useCallback((text: string) => {
    if (socket.connected) socket.emit('chat:guess', { text });
  }, []);

  const reportWord = useCallback(() => {
    if (socket.connected) socket.emit('word:report', { reason: 'inappropriate' }, () => undefined);
  }, []);

  /** The canvas paints its own strokes locally; these only transmit. */
  const drawStart = useCallback((stroke: Stroke) => {
    if (!socket.connected) return;
    markOwn(stroke.id);
    socket.emit('draw:stroke', { stroke });
  }, []);
  const drawAppend = useCallback((id: string, points: number[]) => {
    if (socket.connected) socket.emit('draw:points', { id, points });
  }, []);

  const react = useCallback((reaction: Reaction) => {
    if (!socket.connected) return;
    setMyReaction(reaction);
    socket.emit('draw:react', { reaction });
  }, []);

  const undo = useCallback(() => {
    if (socket.connected) socket.emit('draw:undo', {});
  }, []);
  const clear = useCallback(() => {
    if (socket.connected) socket.emit('draw:clear', {});
  }, []);

  const leave = useCallback(() => {
    clearSession();
    resetRoom();
    socket.disconnect();
    socket.connect();
  }, [resetRoom]);

  const dismissError = useCallback(() => setError(null), []);
  const you = room?.players.find((p) => p.id === room.youId) ?? null;
  const latestYou = useRef(you);
  latestYou.current = you;

  return {
    connected,
    room,
    messages,
    reactionFeed,
    myReaction,
    react,
    reconnecting,
    wordOptions,
    assignedWord,
    secondsLeft,
    closeHint,
    finalScores,
    summary,
    busy,
    error,
    you,
    isHost: you?.isHost ?? false,
    create,
    join,
    peek,
    kick,
    updateProfile,
    updateSettings,
    setCustomWords,
    start,
    restart,
    chooseWord,
    customWord,
    sendGuess,
    reportWord,
    drawStart,
    drawAppend,
    undo,
    clear,
    leave,
    dismissError,
  };
}
