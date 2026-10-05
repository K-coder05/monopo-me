import type { GameEvent, GameState } from './types';

/** Socket messages shared by server and client. */

export type Ack<T = object> = (result: ({ ok: true } & T) | { ok: false; error: string }) => void;

export type JoinedRoom = { roomCode: string; playerId: string };

export type ClientToServer = {
  CREATE_ROOM: (msg: { name: string; color: string }, ack: Ack<JoinedRoom>) => void;
  JOIN_ROOM: (msg: { roomCode: string; name: string; color: string }, ack: Ack<JoinedRoom>) => void;
  // Intents carry no playerId: the server acts for the Player bound to the sending connection.
  START_GAME: (msg: object, ack: Ack) => void;
  ROLL_DICE: (msg: object, ack: Ack) => void;
  BUY_PROPERTY: (msg: object, ack: Ack) => void;
  DECLINE_PROPERTY: (msg: object, ack: Ack) => void;
  END_TURN: (msg: object, ack: Ack) => void;
};

export type ServerToClient = {
  STATE: (msg: { state: GameState; events: GameEvent[] }) => void;
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
