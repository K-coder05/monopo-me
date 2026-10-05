import { randomInt, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyAction,
  createGame,
  defaultBoard,
  defaultRules,
  IllegalActionError,
  MAX_NAME_LENGTH,
  recordUndo,
  ROOM_CODE_LENGTH,
  TOKEN_COLORS,
  undo,
  type Action,
  type ActionResult,
  type GameState,
  type RejoinKey,
  type Rng,
} from '@landlord/engine';

// No 0/O or 1/I/L, so codes are easy to read aloud and type on a phone.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const IDLE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * What one Room's file holds. Tokens stay on the server; they never go out in a STATE, and
 * neither does the Undo history kept beside the state.
 */
type SavedRoom = { state: GameState; tokens: Record<string, string>; lastActive: number; history?: GameState[] };

export const serverRng: Rng = { int: (maxExclusive) => randomInt(maxExclusive) };

/**
 * Rooms, kept in memory and saved as one JSON file each in `dir` after every change (no saving
 * without a `dir`). Every change goes through the engine.
 */
export class Rooms {
  private readonly rooms = new Map<string, GameState>();
  /** Each Player's reconnect token, by Room then Player. */
  private readonly tokens = new Map<string, Map<string, string>>();
  private readonly lastActive = new Map<string, number>();
  /** Each Room's Undo snapshots, oldest first. */
  private readonly histories = new Map<string, GameState[]>();
  /** Open connections per Player, by Room then Player. */
  private readonly connections = new Map<string, Map<string, number>>();
  /** The pending Auction countdown for each Room that has one open. */
  private readonly countdowns = new Map<string, ReturnType<typeof setTimeout>>();

  /** `onTimer` receives changes the server makes on its own, such as an Auction running out. */
  constructor(
    private readonly onTimer: (roomCode: string, result: ActionResult) => void,
    private readonly rng: Rng = serverRng,
    private readonly now: () => number = Date.now,
    private readonly dir?: string,
  ) {
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const saved: SavedRoom = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        const code = saved.state.roomCode;
        this.rooms.set(code, saved.state);
        this.tokens.set(code, new Map(Object.entries(saved.tokens)));
        this.lastActive.set(code, saved.lastActive);
        this.histories.set(code, saved.history ?? []);
        this.scheduleCountdown(code, saved.state);
      } catch (err) {
        console.error(`Skipping unreadable Room file ${file}`, err);
      }
    }
    this.expireIdle();
  }

  get(roomCode: string): GameState | undefined {
    return this.rooms.get(roomCode);
  }

  create(name: string, color: string): RejoinKey & ActionResult {
    const host = { id: randomUUID(), ...validPlayer(name, color) };
    const roomCode = this.freshCode();
    // Each Room gets its own copy of the Rules and Board so edits never leak between Rooms.
    const state = createGame(roomCode, host, structuredClone(defaultRules), structuredClone(defaultBoard));
    this.rooms.set(roomCode, state);
    const token = this.issueToken(roomCode, host.id);
    this.save(roomCode);
    return { roomCode, playerId: host.id, token, state, events: [] };
  }

  join(roomCode: string, name: string, color: string): RejoinKey & ActionResult {
    const code = roomCode.trim().toUpperCase();
    const playerId = randomUUID();
    const result = this.act(code, { type: 'JOIN_ROOM', playerId, ...validPlayer(name, color) });
    const token = this.issueToken(code, playerId);
    this.save(code);
    return { roomCode: code, playerId, token, ...result };
  }

  /** The Player who holds `token` in the Room; anything else is refused. */
  rejoin(roomCode: string, token: unknown): string {
    const code = roomCode.trim().toUpperCase();
    const held = typeof token === 'string' && token.length > 0 ? token : undefined;
    for (const [playerId, expected] of this.tokens.get(code) ?? []) {
      if (held === expected) return playerId;
    }
    throw new IllegalActionError('Could not rejoin that Room');
  }

  connect(roomCode: string, playerId: string) {
    const counts = this.connections.get(roomCode) ?? new Map<string, number>();
    counts.set(playerId, (counts.get(playerId) ?? 0) + 1);
    this.connections.set(roomCode, counts);
  }

  disconnect(roomCode: string, playerId: string) {
    const counts = this.connections.get(roomCode);
    counts?.set(playerId, Math.max(0, (counts.get(playerId) ?? 0) - 1));
  }

  /** Players with no open connection. */
  away(roomCode: string): string[] {
    const counts = this.connections.get(roomCode);
    return (this.rooms.get(roomCode)?.players ?? []).map((p) => p.id).filter((id) => !counts?.get(id));
  }

  /** Deletes Rooms nobody has acted in for 30 days. */
  expireIdle() {
    for (const [code, last] of this.lastActive) {
      if (this.now() - last <= IDLE_EXPIRY_MS) continue;
      clearTimeout(this.countdowns.get(code));
      for (const map of [this.rooms, this.tokens, this.lastActive, this.histories, this.connections, this.countdowns]) map.delete(code);
      if (this.dir) rmSync(join(this.dir, `${code}.json`), { force: true });
    }
  }

  private issueToken(roomCode: string, playerId: string): string {
    const token = randomUUID();
    const tokens = this.tokens.get(roomCode) ?? new Map<string, string>();
    tokens.set(playerId, token);
    this.tokens.set(roomCode, tokens);
    return token;
  }

  /** Writes the Room to disk via a temp file so a crash mid-write cannot corrupt the saved copy. */
  private save(roomCode: string) {
    this.lastActive.set(roomCode, this.now());
    if (!this.dir) return;
    const saved: SavedRoom = {
      state: this.rooms.get(roomCode)!,
      tokens: Object.fromEntries(this.tokens.get(roomCode) ?? []),
      lastActive: this.lastActive.get(roomCode)!,
      history: this.histories.get(roomCode) ?? [],
    };
    const file = join(this.dir, `${roomCode}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(saved));
    renameSync(`${file}.tmp`, file);
  }

  act(roomCode: string, action: Action): ActionResult {
    const state = this.rooms.get(roomCode);
    if (!state) throw new IllegalActionError(`No Room with code ${roomCode}`);
    const result = applyAction(state, action, state.rules, this.rng, this.now());
    this.histories.set(roomCode, recordUndo(this.histories.get(roomCode) ?? [], state, result.state, action));
    this.commit(roomCode, result.state);
    return result;
  }

  /** Host only: steps the game back over the last game action or Override. */
  undo(roomCode: string, playerId: string): ActionResult {
    const state = this.rooms.get(roomCode);
    if (!state) throw new IllegalActionError(`No Room with code ${roomCode}`);
    const { history, ...result } = undo(state, this.histories.get(roomCode) ?? [], playerId, this.now());
    this.histories.set(roomCode, history);
    this.commit(roomCode, result.state);
    return result;
  }

  private commit(roomCode: string, state: GameState) {
    this.rooms.set(roomCode, state);
    this.save(roomCode);
    this.scheduleCountdown(roomCode, state);
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
