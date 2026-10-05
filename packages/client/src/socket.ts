import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServer, PropertyIntent, ServerToClient, TradeSide } from '@landlord/engine';

export const socket: Socket<ServerToClient, ClientToServer> = io();

export type Intent =
  | 'START_GAME'
  | 'ROLL_DICE'
  | 'PAY_JAIL_FINE'
  | 'USE_JAIL_CARD'
  | 'BUY_PROPERTY'
  | 'DECLINE_PROPERTY'
  | 'PASS_AUCTION'
  | 'END_TURN'
  | 'ACCEPT_TRADE'
  | 'REJECT_TRADE'
  | 'WITHDRAW_TRADE'
  | 'PAY_DEBT'
  | 'DECLARE_BANKRUPTCY'
  | 'REMATCH'
  | 'BACK_TO_LOBBY';

/** Resolves with the server's error message, or null if it was accepted. */
function toError(resolve: (error: string | null) => void): Ack {
  return (result) => resolve(result.ok ? null : result.error);
}

/** Sends an intent and resolves with the server's error message, or null if it was accepted. */
export function send(intent: Intent): Promise<string | null> {
  return new Promise((resolve) => socket.emit(intent, {}, toError(resolve)));
}

/**
 * Builds on, or sells a building from, the street at `index`, or mortgages or unmortgages the
 * property there; resolves like `send`.
 */
export function sendPropertyAction(intent: PropertyIntent, index: number): Promise<string | null> {
  return new Promise((resolve) => socket.emit(intent, { index }, toError(resolve)));
}

/** Dismisses the revealed card; `choiceId` is the Player picked for a `drawerChoice` card. Resolves like `send`. */
export function continueCard(choiceId?: string): Promise<string | null> {
  return new Promise((resolve) => socket.emit('CONTINUE_CARD', { choiceId }, toError(resolve)));
}

/** Bids `amount` in the open Auction; resolves like `send`. */
export function placeBid(amount: number): Promise<string | null> {
  return new Promise((resolve) => socket.emit('PLACE_BID', { amount }, toError(resolve)));
}

/** Proposes, revises or counters the open Trade; resolves like `send`. */
export function proposeTrade(partnerId: string, give: TradeSide, take: TradeSide): Promise<string | null> {
  return new Promise((resolve) => socket.emit('PROPOSE_TRADE', { partnerId, give, take }, toError(resolve)));
}
