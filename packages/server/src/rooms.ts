import { randomInt, randomUUID } from 'node:crypto';
import {
  applyAction,
  createGame,
  defaultBoard,
  defaultRules,
  IllegalActionError,
  MAX_NAME_LENGTH,
  ROOM_CODE_LENGTH,
  TOKEN_COLORS,
  type Action,
  type ActionResult,
  type GameState,
  type JoinedRoom,
  type Rng,
} from '@landlord/engine';

// No 0/O or 1/I/L, so codes are easy to read aloud and type on a phone.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const serverRng: Rng = { int: (maxExclusive) => randomInt(maxExclusive) };

/** In-memory Rooms. Every change goes through the engine. */
export class Rooms {
  private readonly rooms = new Map<string, GameState>();

  constructor(private readonly rng: Rng = serverRng) {}

  create(name: string, color: string): JoinedRoom & ActionResult {
    const host = { id: randomUUID(), ...validPlayer(name, color) };
    const roomCode = this.freshCode();
    // Each Room gets its own copy of the Rules and Board so edits never leak between Rooms.
    const state = createGame(roomCode, host, structuredClone(defaultRules), structuredClone(defaultBoard));
    this.rooms.set(roomCode, state);
    return { roomCode, playerId: host.id, state, events: [] };
  }

  join(roomCode: string, name: string, color: string): JoinedRoom & ActionResult {
    const code = roomCode.trim().toUpperCase();
    const playerId = randomUUID();
    const result = this.act(code, { type: 'JOIN_ROOM', playerId, ...validPlayer(name, color) });
    return { roomCode: code, playerId, ...result };
  }

  act(roomCode: string, action: Action): ActionResult {
    const state = this.rooms.get(roomCode);
    if (!state) throw new IllegalActionError(`No Room with code ${roomCode}`);
    const result = applyAction(state, action, state.rules, this.rng);
    this.rooms.set(roomCode, result.state);
    return result;
  }

  private freshCode(): string {
    for (;;) {
      const code = Array.from({ length: ROOM_CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(
        '',
      );
      if (!this.rooms.has(code)) return code;
    }
  }
}

function validPlayer(name: unknown, color: unknown): { name: string; color: string } {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) {
    throw new IllegalActionError(`Name must be 1–${MAX_NAME_LENGTH} characters`);
  }
  if (typeof color !== 'string' || !(TOKEN_COLORS as readonly string[]).includes(color)) {
    throw new IllegalActionError('Pick a token colour from the list');
  }
  return { name: trimmed, color };
}
