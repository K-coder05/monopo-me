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
  /** The pending Auction countdown for each Room that has one open. */
  private readonly countdowns = new Map<string, ReturnType<typeof setTimeout>>();

  /** `onTimer` receives changes the server makes on its own, such as an Auction running out. */
  constructor(
    private readonly onTimer: (roomCode: string, result: ActionResult) => void,
    private readonly rng: Rng = serverRng,
    private readonly now: () => number = Date.now,
  ) {}

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
    const result = applyAction(state, action, state.rules, this.rng, this.now());
    this.rooms.set(roomCode, result.state);
    this.scheduleCountdown(roomCode, result.state);
    return result;
  }

  /** (Re)starts the Room's Auction countdown to match its state; every bid moves the deadline. */
  private scheduleCountdown(roomCode: string, state: GameState) {
    clearTimeout(this.countdowns.get(roomCode));
    this.countdowns.delete(roomCode);
    if (!state.auction) return;
    const delay = Math.max(0, state.auction.endsAt - this.now());
    this.countdowns.set(
      roomCode,
      setTimeout(() => {
        this.countdowns.delete(roomCode);
        // Timers can fire slightly early against the wall clock; wait out the rest rather than
        // have the engine refuse the expiry and leave the Auction stuck open.
        if (this.now() < state.auction!.endsAt) return this.scheduleCountdown(roomCode, state);
        // A throw here would escape to the event loop and take the server down.
        try {
          this.onTimer(roomCode, this.act(roomCode, { type: 'EXPIRE_AUCTION' }));
        } catch (err) {
          console.error(err);
        }
      }, delay),
    );
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
