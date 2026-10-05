import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServer, ServerToClient } from '@landlord/engine';

export const socket: Socket<ServerToClient, ClientToServer> = io();

export type Intent = 'START_GAME' | 'ROLL_DICE' | 'BUY_PROPERTY' | 'DECLINE_PROPERTY' | 'PASS_AUCTION' | 'END_TURN';

/** Resolves with the server's error message, or null if it was accepted. */
function toError(resolve: (error: string | null) => void): Ack {
  return (result) => resolve(result.ok ? null : result.error);
}

/** Sends an intent and resolves with the server's error message, or null if it was accepted. */
export function send(intent: Intent): Promise<string | null> {
  return new Promise((resolve) => socket.emit(intent, {}, toError(resolve)));
}

/** Bids `amount` in the open Auction; resolves like `send`. */
export function placeBid(amount: number): Promise<string | null> {
  return new Promise((resolve) => socket.emit('PLACE_BID', { amount }, toError(resolve)));
}
