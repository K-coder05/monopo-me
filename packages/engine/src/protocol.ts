import type { GameEvent, GameState, Rules, SpaceEdit, TradeSide } from './types';

/** Socket messages shared by server and client. */

export type Ack<T = object> = (result: ({ ok: true } & T) | { ok: false; error: string }) => void;

export type JoinedRoom = { roomCode: string; playerId: string };

/** What the Player's browser keeps to rejoin later; the token proves they own the Player. */
export type RejoinKey = JoinedRoom & { token: string };

/** Intents that act on one property, named by its Board index. */
export type PropertyIntent = 'BUILD' | 'SELL_BUILDING' | 'MORTGAGE' | 'UNMORTGAGE';

export type ClientToServer = {
  CREATE_ROOM: (msg: { name: string; color: string }, ack: Ack<RejoinKey>) => void;
  JOIN_ROOM: (msg: { roomCode: string; name: string; color: string }, ack: Ack<RejoinKey>) => void;
  /** Takes the Player back with the token from their RejoinKey; sent on every (re)connect. */
  REJOIN_ROOM: (msg: { roomCode: string; token: string }, ack: Ack<JoinedRoom>) => void;
  // Intents carry no playerId: the server acts for the Player bound to the sending connection.
  START_GAME: (msg: object, ack: Ack) => void;
  ROLL_DICE: (msg: object, ack: Ack) => void;
  PAY_JAIL_FINE: (msg: object, ack: Ack) => void;
  USE_JAIL_CARD: (msg: object, ack: Ack) => void;
  /** `choiceId` is the Player picked for a `drawerChoice` card. */
  CONTINUE_CARD: (msg: { choiceId?: string }, ack: Ack) => void;
  BUY_PROPERTY: (msg: object, ack: Ack) => void;
  DECLINE_PROPERTY: (msg: object, ack: Ack) => void;
  PLACE_BID: (msg: { amount: number }, ack: Ack) => void;
  PASS_AUCTION: (msg: object, ack: Ack) => void;
  /** `index` is the street's Board index. */
  BUILD: (msg: { index: number }, ack: Ack) => void;
  SELL_BUILDING: (msg: { index: number }, ack: Ack) => void;
  /** `index` is the property's Board index. */
  MORTGAGE: (msg: { index: number }, ack: Ack) => void;
  UNMORTGAGE: (msg: { index: number }, ack: Ack) => void;
  /** A proposal while an offer is open is a counter-offer (from its partner) or a revision (from its proposer). */
  PROPOSE_TRADE: (msg: { partnerId: string; give: TradeSide; take: TradeSide }, ack: Ack) => void;
  ACCEPT_TRADE: (msg: object, ack: Ack) => void;
  REJECT_TRADE: (msg: object, ack: Ack) => void;
  WITHDRAW_TRADE: (msg: object, ack: Ack) => void;
  END_TURN: (msg: object, ack: Ack) => void;
  PAY_DEBT: (msg: object, ack: Ack) => void;
  DECLARE_BANKRUPTCY: (msg: object, ack: Ack) => void;
  REMATCH: (msg: object, ack: Ack) => void;
  BACK_TO_LOBBY: (msg: object, ack: Ack) => void;
  // Host only; the server checks types and ranges and rejects bad values with a message.
  /** `changes` holds only the Rules keys to change. */
  UPDATE_RULES: (msg: { changes: Partial<Rules> }, ack: Ack) => void;
  UPDATE_BOARD: (msg: { edits: SpaceEdit[] }, ack: Ack) => void;
  /** Restores the built-in Defaults for Rules and Board. */
  RESET_TO_DEFAULTS: (msg: object, ack: Ack) => void;
};

export type ServerToClient = {
  /** `serverNow` is the server clock (ms) at send time, so clients can show countdowns despite clock skew. */
  /** `away` lists the Players with no open connection. */
  STATE: (msg: { state: GameState; events: GameEvent[]; serverNow: number; away: string[] }) => void;
};

export const ROOM_CODE_LENGTH = 5;
export const MAX_NAME_LENGTH = 20;

export const TOKEN_COLORS = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#9a6324',
] as const;
