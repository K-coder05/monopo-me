import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  defaultBoard,
  defaultRules,
  IllegalActionError,
  undo,
  type Action,
  type GameState,
  type Player,
  type Rng,
  type Rules,
} from './index';

/** Scripted values, then zeros once they run out. */
function script(...values: number[]): Rng {
  const queue = [...values];
  return { int: () => queue.shift() ?? 0 };
}

/** Rolls the given die faces (1-based). */
const dice = (...faces: number[]) => script(...faces.map((f) => f - 1));

function act(state: GameState, action: Action, rng: Rng = script(), now = 0) {
  return applyAction(state, action, state.rules, rng, now);
}

/** ann (the Host), bob and cat in that turn order, ann to roll from GO at `now` with a 30s turn timer. */
function table(rules: Partial<Rules> = {}, now = 0): GameState {
  let state = createGame('ABCDE', { id: 'ann', name: 'ann', color: 'c0' }, { ...defaultRules, turnTimerSeconds: 30, ...rules }, defaultBoard);
  for (const [i, name] of ['bob', 'cat'].entries()) {
    state = act(state, { type: 'JOIN_ROOM', playerId: name, name, color: `c${i + 1}` }).state;
  }
  return act(state, { type: 'START_GAME', playerId: 'ann' }, script(5, 5, 4, 4, 3, 3), now).state;
}

function withPlayer(state: GameState, id: string, patch: Partial<Player>): GameState {
  return { ...state, players: state.players.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

const expire = (state: GameState, now: number, rng: Rng = script()) => act(state, { type: 'EXPIRE_TURN' }, rng, now);

/** ann rolls 1 + 2 onto Baltic Avenue (3) at `now` and is offered it. */
function offered(rules: Partial<Rules> = {}, now = 0): GameState {
  return act(table(rules), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2), now).state;
}

describe('Turn timer', () => {
  it('starts with the first turn', () => {
    expect(table({}, 1000).turn!.timerEndsAt).toBe(31_000);
  });

  it('is off when turnTimerSeconds is 0', () => {
    const state = table({ turnTimerSeconds: 0 });
    expect(state.turn!.timerEndsAt).toBeUndefined();
    expect(() => expire(state, 1_000_000)).toThrow(IllegalActionError);
  });

  it('cannot expire before it runs out', () => {
    expect(() => expire(table(), 29_999)).toThrow('has not run out');
  });

  it('rolls for a Player awaiting a roll', () => {
    const { state, events } = expire(table(), 30_000, dice(1, 2));
    expect(events[0]).toEqual({ type: 'TURN_TIMED_OUT', playerId: 'ann' });
    expect(events).toContainEqual({ type: 'DICE_ROLLED', playerId: 'ann', dice: [1, 2], total: 3 });
    expect(state.turn!.step).toBe('awaitBuyDecision');
    // The next step gets a full countdown of its own.
    expect(state.turn!.timerEndsAt).toBe(60_000);
  });

  it('declines for a Player awaiting a buy decision, starting an Auction with no turn timer', () => {
    const { state, events } = expire(offered(), 30_000);
    expect(events).toContainEqual({ type: 'PROPERTY_DECLINED', playerId: 'ann', index: 3 });
    expect(state.turn!.step).toBe('auction');
    expect(state.auction).toBeDefined();
    expect(state.turn!.timerEndsAt).toBeUndefined();
    expect(() => expire(state, 1_000_000)).toThrow(IllegalActionError);
  });

  it('declines with no Auction when auctionOnDecline is off', () => {
    const { state, events } = expire(offered({ auctionOnDecline: false }), 30_000);
    expect(events).toContainEqual({ type: 'PROPERTY_DECLINED', playerId: 'ann', index: 3 });
    expect(state.auction).toBeUndefined();
    expect(state.turn!.step).toBe('awaitEndTurn');
    expect(state.turn!.timerEndsAt).toBe(60_000);
  });

  it('ends the turn for a Player awaiting end of turn', () => {
    const bought = act(offered(), { type: 'BUY_PROPERTY', playerId: 'ann' }, script(), 10_000).state;
    expect(bought.turn!.timerEndsAt).toBe(40_000);
    const { state, events } = expire(bought, 40_000);
    expect(events).toContainEqual({ type: 'TURN_ENDED', playerId: 'ann' });
    expect(state.turn!.playerId).toBe('bob');
    expect(state.turn!.timerEndsAt).toBe(70_000);
  });

  it('gives a fresh countdown to a roll earned by Doubles', () => {
    // 2 + 2 lands on Income Tax (4); ann pays and rolls again.
    const { state } = act(table(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(2, 2), 20_000);
    expect(state.turn!.step).toBe('awaitRoll');
    expect(state.turn!.timerEndsAt).toBe(50_000);
  });

  it('keeps counting down through actions that stay on the same step', () => {
    const bought = act(offered(), { type: 'BUY_PROPERTY', playerId: 'ann' }, script(), 10_000).state;
    const mortgaged = act(bought, { type: 'MORTGAGE', playerId: 'ann', index: 3 }, script(), 20_000).state;
    expect(mortgaged.turn!.timerEndsAt).toBe(40_000);
  });

  it('does not run during a Debt', () => {
    // 1 + 3 lands on Income Tax (4) with no cash to pay it.
    const broke = withPlayer(table(), 'ann', { cash: 0 });
    const { state } = act(broke, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 3), 10_000);
    expect(state.turn!.step).toBe('awaitDebt');
    expect(state.turn!.timerEndsAt).toBeUndefined();
    expect(() => expire(state, 1_000_000)).toThrow(IllegalActionError);
  });

  it('keeps running while a Trade waits for a response', () => {
    const side = (cash: number) => ({ cash, properties: [], cards: [] });
    const proposal = { type: 'PROPOSE_TRADE', playerId: 'ann', partnerId: 'bob', give: side(10), take: side(0) } as const;
    const open = act(table(), proposal, script(), 10_000).state;
    expect(open.turn!.timerEndsAt).toBe(30_000);

    const { state } = expire(open, 30_000, dice(1, 2));
    expect(state.turn!.step).toBe('awaitBuyDecision');
    // Only the response is untimed: the offer stays open for bob.
    expect(state.trade).toBeDefined();
  });

  it('freezes while the game is paused', () => {
    const paused = act(table(), { type: 'PAUSE', playerId: 'ann' }, script(), 10_000).state;
    expect(paused.turn!.timerEndsAt).toBe(30_000);
    expect(() => expire(paused, 1_000_000)).toThrow('paused');

    const resumed = act(paused, { type: 'RESUME', playerId: 'ann' }, script(), 100_000).state;
    expect(resumed.turn!.timerEndsAt).toBe(120_000);
  });

  it('gives a countdown the Host turns on while paused in full once play resumes', () => {
    const paused = act(table({ turnTimerSeconds: 0 }), { type: 'PAUSE', playerId: 'ann' }, script(), 10_000).state;
    const on = act(paused, { type: 'UPDATE_RULES', playerId: 'ann', changes: { turnTimerSeconds: 30 } }, script(), 50_000).state;
    const resumed = act(on, { type: 'RESUME', playerId: 'ann' }, script(), 100_000).state;
    expect(resumed.turn!.timerEndsAt).toBe(130_000);
  });

  it('starts when the Host turns it on mid-turn, and stops when they turn it off', () => {
    const off = table({ turnTimerSeconds: 0 });
    const on = act(off, { type: 'UPDATE_RULES', playerId: 'ann', changes: { turnTimerSeconds: 60 } }, script(), 5_000).state;
    expect(on.turn!.timerEndsAt).toBe(65_000);
    const offAgain = act(on, { type: 'UPDATE_RULES', playerId: 'ann', changes: { turnTimerSeconds: 0 } }, script(), 6_000).state;
    expect(offAgain.turn!.timerEndsAt).toBeUndefined();
  });

  it('restarts in full after an Undo', () => {
    const before = table();
    const after = act(before, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2), 10_000).state;
    const { state } = undo(after, [before], 'ann', 50_000);
    expect(state.turn!.step).toBe('awaitRoll');
    expect(state.turn!.timerEndsAt).toBe(80_000);
  });
});
