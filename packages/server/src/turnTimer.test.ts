import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult, GameState, Rng } from '@landlord/engine';
import { Rooms } from './rooms';

const COLORS = ['#e6194b', '#3cb44b'] as const;

describe('Rooms turn timer', () => {
  let clock: number;
  /** Values the Rng hands out next; zeros once it runs out. */
  let queue: number[];
  let changes: ActionResult[];
  let rooms: Rooms;
  const rng: Rng = { int: () => queue.shift() ?? 0 };

  beforeEach(() => {
    vi.useFakeTimers();
    clock = 1_000_000;
    queue = [];
    changes = [];
    rooms = new Rooms((_code, result) => changes.push(result), rng, () => clock);
  });
  afterEach(() => vi.useRealTimers());

  const wait = (ms: number) => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  };

  /** ann (the Host) then bob, both connected, ann to roll with a 30s turn timer. */
  function started() {
    const ann = rooms.create('ann', COLORS[0]);
    const bob = rooms.join(ann.roomCode, 'bob', COLORS[1]);
    const code = ann.roomCode;
    rooms.connect(code, ann.playerId);
    rooms.connect(code, bob.playerId);
    rooms.act(code, { type: 'UPDATE_RULES', playerId: ann.playerId, changes: { turnTimerSeconds: 30 } });
    queue.push(5, 5, 4, 4);
    rooms.act(code, { type: 'START_GAME', playerId: ann.playerId });
    queue.length = 0;
    return { code, ann: ann.playerId, state: (): GameState => rooms.get(code)! };
  }

  it('takes the default action when the timer runs out', () => {
    const r = started();
    wait(29_999);
    expect(changes).toEqual([]);

    queue.push(0, 1);
    wait(1);
    expect(changes[0]!.events[0]).toEqual({ type: 'TURN_TIMED_OUT', playerId: r.ann });
    expect(r.state().turn!.step).toBe('awaitBuyDecision');

    // Declined after the next 30s, so an Auction opens and its own countdown takes over.
    wait(30_000);
    expect(r.state().auction).toBeDefined();
    expect(r.state().turn!.timerEndsAt).toBeUndefined();
  });

  it('waits while the game is paused', () => {
    const r = started();
    wait(10_000);
    rooms.act(r.code, { type: 'PAUSE', playerId: r.ann });
    wait(60_000);
    expect(changes).toEqual([]);

    rooms.act(r.code, { type: 'RESUME', playerId: r.ann });
    wait(19_999);
    expect(changes).toEqual([]);
    wait(1);
    expect(changes[0]!.events[0]).toEqual({ type: 'TURN_TIMED_OUT', playerId: r.ann });
  });

  it('runs on a Player who is away', () => {
    const r = started();
    rooms.disconnect(r.code, r.ann);
    wait(30_000);
    expect(changes.some((c) => c.events.some((e) => e.type === 'TURN_TIMED_OUT'))).toBe(true);
  });
});
