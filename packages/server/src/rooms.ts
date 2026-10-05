import { randomInt, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyAction,
  createGame,
  defaultBoard,
  defaultRules,
  departing,
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

/** How long the Host may be away before the role passes to the next connected Player. */
export const HOST_AWAY_MS = 2 * 60 * 1000;

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
  /** The pending Auction countdown or turn timer for each Room that has one running. */
  private readonly countdowns = new Map<string, ReturnType<typeof setTimeout>>();
  /** For each Room whose Host has no open connection: since when, and the check due when time is up. */
  private readonly hostAway = new Map<string, { hostId: string; since: number; timer: ReturnType<typeof setTimeout> }>();

  /**
   * `onTimer` receives changes the server makes on its own, such as an Auction or turn running
   * out, a Player who drops counting as passed, or the Host role passing on.
   */
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
        // Rooms saved before Spectators existed.
        this.rooms.set(code, { ...saved.state, spectators: saved.state.spectators ?? [] });
        this.tokens.set(code, new Map(Object.entries(saved.tokens)));
        this.lastActive.set(code, saved.lastActive);
        this.histories.set(code, saved.history ?? []);
        this.scheduleCountdown(code, saved.state);
        this.watchHost(code);
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
    this.watchHost(roomCode);
  }

  /** A Player who drops out of an open Auction counts as passed (sent to `onTimer`). */
  disconnect(roomCode: string, playerId: string) {
    const counts = this.connections.get(roomCode);
    counts?.set(playerId, Math.max(0, (counts.get(playerId) ?? 0) - 1));
    this.watchHost(roomCode);
    const state = this.rooms.get(roomCode);
    if (!state?.auction?.bidders.includes(playerId) || !this.isAway(roomCode, playerId)) return;
    const result = this.passAwayBidders(roomCode, { state, events: [] });
    if (result.events.length === 0) return;
    this.record(roomCode, state, result, { type: 'PASS_AUCTION', playerId });
    this.onTimer(roomCode, result);
  }

  private isAway(roomCode: string, playerId: string): boolean {
    return !this.connections.get(roomCode)?.get(playerId);
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
      clearTimeout(this.hostAway.get(code)?.timer);
      for (const map of [this.rooms, this.tokens, this.lastActive, this.histories, this.connections, this.countdowns, this.hostAway]) {
        map.delete(code);
      }
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

  /**
   * Runs `action`, then passes for bidders who are away. A Player or Spectator who leaves or is
   * kicked can no longer rejoin.
   */
  act(roomCode: string, action: Action): ActionResult {
    const state = this.rooms.get(roomCode);
    if (!state) throw new IllegalActionError(`No Room with code ${roomCode}`);
    const acted = applyAction(state, action, state.rules, this.rng, this.now());
    const result = this.passAwayBidders(roomCode, acted);
    const gone = departing(action);
    if (gone !== undefined) {
      this.tokens.get(roomCode)?.delete(gone);
      this.connections.get(roomCode)?.delete(gone);
    }
    // Passes made for away bidders are a game action Undo can take back, even after an action it
    // steps over (a resume, say).
    const passed = result.events.length > acted.events.length;
    const history = this.histories.get(roomCode) ?? [];
    const recorded = recordUndo(history, state, result.state, action);
    if (passed && recorded === history && gone === undefined) {
      this.record(roomCode, state, result, { type: 'PASS_AUCTION', playerId: '' });
    } else {
      this.histories.set(roomCode, recorded);
      this.commit(roomCode, result.state);
    }
    return result;
  }

  /** Keeps the Undo snapshot for `action` taking the Room from `before` to `result`, and saves. */
  private record(roomCode: string, before: GameState, result: ActionResult, action: Action) {
    this.histories.set(roomCode, recordUndo(this.histories.get(roomCode) ?? [], before, result.state, action));
    this.commit(roomCode, result.state);
  }

  /** Passes, in the open Auction, for every bidder who is away (one holding the highest bid cannot). */
  private passAwayBidders(roomCode: string, result: ActionResult): ActionResult {
    let { state } = result;
    const events = [...result.events];
    for (;;) {
      const { auction } = state;
      if (!auction || state.paused) break;
      const away = auction.bidders.find((id) => id !== auction.highBid?.playerId && this.isAway(roomCode, id));
      if (away === undefined) break;
      const passed = applyAction(state, { type: 'PASS_AUCTION', playerId: away }, state.rules, this.rng, this.now());
      state = passed.state;
      events.push(...passed.events);
    }
    return { state, events };
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
    this.watchHost(roomCode);
  }

  /**
   * Keeps the 2-minute watch on a Host with no open connection: once it is up the role passes to
   * the next connected Player in turn order, or to the first to connect if nobody is. It runs while
   * the game is paused, so a Host who paused and left cannot leave the Room stuck.
   */
  private watchHost(roomCode: string) {
    const state = this.rooms.get(roomCode);
    const watch = this.hostAway.get(roomCode);
    clearTimeout(watch?.timer);
    if (!state || !this.isAway(roomCode, state.hostId)) {
      this.hostAway.delete(roomCode);
      return;
    }
    const since = watch?.hostId === state.hostId ? watch.since : this.now();
    // The handover always runs from a timer, never in the middle of another change to the Room.
    const timer = setTimeout(() => this.handOverHost(roomCode), Math.max(0, since + HOST_AWAY_MS - this.now()));
    this.hostAway.set(roomCode, { hostId: state.hostId, since, timer });
  }

  private handOverHost(roomCode: string) {
    const state = this.rooms.get(roomCode);
    const watch = this.hostAway.get(roomCode);
    if (!state || watch?.hostId !== state.hostId || !this.isAway(roomCode, state.hostId)) return;
    // Timers can fire slightly early against the wall clock; wait out the rest.
    if (this.now() < watch.since + HOST_AWAY_MS) return this.watchHost(roomCode);
    const at = state.players.findIndex((p) => p.id === state.hostId);
    const next = [...state.players.slice(at + 1), ...state.players.slice(0, at)].find(
      (p) => !this.isAway(roomCode, p.id) && !(state.phase === 'playing' && p.bankrupt),
    );
    // Nobody to take over yet: the next connection runs this check again.
    if (!next) return;
    try {
      this.onTimer(roomCode, this.act(roomCode, { type: 'HOST_TIMED_OUT', toId: next.id }));
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * (Re)starts the Room's countdown to match its state: the open Auction's (every bid moves it), or
   * else the turn timer's. Nothing counts down while the game is paused.
   */
  private scheduleCountdown(roomCode: string, state: GameState) {
    clearTimeout(this.countdowns.get(roomCode));
    this.countdowns.delete(roomCode);
    const due = deadline(state);
    if (!due) return;
    this.countdowns.set(
      roomCode,
      setTimeout(() => {
        this.countdowns.delete(roomCode);
        // Timers can fire slightly early against the wall clock; wait out the rest rather than
        // have the engine refuse the expiry and leave the game stuck.
        if (this.now() < due.at) return this.scheduleCountdown(roomCode, state);
        // A throw here would escape to the event loop and take the server down.
        try {
          this.onTimer(roomCode, this.act(roomCode, due.action));
        } catch (err) {
          console.error(err);
        }
      }, Math.max(0, due.at - this.now())),
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

/** When the Room's running countdown is up (server ms), and what the server then does. */
function deadline(state: GameState): { at: number; action: Action } | undefined {
  if (state.paused) return undefined;
  if (state.auction) return { at: state.auction.endsAt, action: { type: 'EXPIRE_AUCTION' } };
  const endsAt = state.turn?.timerEndsAt;
  return endsAt === undefined ? undefined : { at: endsAt, action: { type: 'EXPIRE_TURN' } };
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
