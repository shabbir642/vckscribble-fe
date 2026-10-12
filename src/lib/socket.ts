import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../generated/contract';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const URL = import.meta.env['VITE_SERVER_URL'] ?? 'http://localhost:3001';

/** Single connection for the app; rooms are joined over it (M2). */
export const socket: GameSocket = io(URL, { autoConnect: false });
