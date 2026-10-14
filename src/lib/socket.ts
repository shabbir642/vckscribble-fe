import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../generated/contract';
import { SERVER_URL } from './server';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Single connection for the app. WebSocket first: starting on HTTP long-polling
 * and upgrading costs extra round trips per connect, and polling requests from
 * one client must all reach the same server process. Polling stays as a
 * fallback for networks that block WebSockets.
 */
export const socket: GameSocket = io(SERVER_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
});
