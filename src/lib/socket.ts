import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../generated/contract';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Falls back to the host the page was served from rather than a literal
 * `localhost`, so a phone or laptop elsewhere on the wifi reaches the backend
 * on the dev machine instead of looking for one on itself. $VITE_SERVER_URL
 * still wins, which is how deployments point at a different host entirely.
 */
const URL =
  import.meta.env['VITE_SERVER_URL'] ?? `http://${window.location.hostname}:3001`;

/** Single connection for the app; rooms are joined over it (M2). */
export const socket: GameSocket = io(URL, { autoConnect: false });
