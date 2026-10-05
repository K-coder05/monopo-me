import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServer, PropertyIntent, Rules, ServerToClient, RejoinKey, SpaceEdit, TradeSide } from '@landlord/engine';

export const socket: Socket<ServerToClient, ClientToServer> = io();

const SESSION_KEY = 'landlord.rejoinKey';

/** The RejoinKey this browser keeps so a refresh or dropped connection puts the Player straight back. */
export function loadRejoinKey(): RejoinKey | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as RejoinKey) : null;
  } catch {
    return null;
  }
}

export function saveRejoinKey(session: RejoinKey) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage blocked: the Player simply cannot auto-rejoin.
  }
}

export function clearRejoinKey() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing stored to clear.
  }
}

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
  | 'BACK_TO_LOBBY'
  | 'RESET_TO_DEFAULTS';

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

/** Host only: sends staged Rules changes; the server rejects bad values with a message. Resolves like `send`. */
export function updateRules(changes: Partial<Rules>): Promise<string | null> {
  return new Promise((resolve) => socket.emit('UPDATE_RULES', { changes }, toError(resolve)));
}

/** Host only: sends staged Space definition changes. Resolves like `send`. */
export function updateBoard(edits: SpaceEdit[]): Promise<string | null> {
  return new Promise((resolve) => socket.emit('UPDATE_BOARD', { edits }, toError(resolve)));
}
