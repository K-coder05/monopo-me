import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '@landlord/engine';

export const socket: Socket<ServerToClient, ClientToServer> = io();

type Intent = 'START_GAME' | 'ROLL_DICE' | 'END_TURN';

/** Sends an intent and resolves with the server's error message, or null if it was accepted. */
export function send(intent: Intent): Promise<string | null> {
  return new Promise((resolve) => {
    socket.emit(intent, {}, (result) => resolve(result.ok ? null : result.error));
  });
}
