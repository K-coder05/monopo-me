import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IllegalActionError, type ActionResult, type GameState, type Rng } from '@landlord/engine';
import { HOST_AWAY_MS, Rooms } from './rooms';

const COLORS = ['#e6194b', '#3cb44b', '#4363d8'] as const;

describe('Rooms membership', () => {
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

  /** ann (the Host), bob and cat, in that turn order once started; `connected` have a connection open. */
  function room(connected = ['ann', 'bob', 'cat']) {
    const ann = rooms.create('ann', COLORS[0]);
    const bob = rooms.join(ann.roomCode, 'bob', COLORS[1]);
    const cat = rooms.join(ann.roomCode, 'cat', COLORS[2]);
    const ids: Record<string, string> = { ann: ann.playerId, bob: bob.playerId, cat: cat.playerId };
    for (const name of connected) rooms.connect(ann.roomCode, ids[name]!);
    const code = ann.roomCode;
    const state = (): GameState => rooms.get(code)!;
    const start = () => {
      queue.push(5, 5, 4, 4, 3, 3);
      rooms.act(code, { type: 'START_GAME', playerId: ids.ann! });
      queue.length = 0;
    };
    /** ann rolls 1 + 2 onto Baltic Avenue and declines it, opening an Auction. */
    const openAuction = () => {
      start();
      queue.push(0, 1);
      rooms.act(code, { type: 'ROLL_DICE', playerId: ids.ann! });
      return rooms.act(code, { type: 'DECLINE_PROPERTY', playerId: ids.ann! });
    };
    return { code, ids, tokens: { ann: ann.token, bob: bob.token, cat: cat.token }, state, start, openAuction };
  }

  describe('a Player who is away during an Auction', () => {
    it('counts as passed when the Auction opens', () => {
      const r = room(['ann', 'bob']);
      const { events } = r.openAuction();
      expect(r.state().auction!.bidders).toEqual([r.ids.ann, r.ids.bob]);
      expect(events).toContainEqual({ type: 'AUCTION_PASSED', playerId: r.ids.cat });
    });

    it('counts as passed when play resumes, and Undo can take that back', () => {
      const r = room();
      r.openAuction();
      rooms.act(r.code, { type: 'PAUSE', playerId: r.ids.ann! });
      rooms.disconnect(r.code, r.ids.cat!);
      rooms.act(r.code, { type: 'RESUME', playerId: r.ids.ann! });
      expect(r.state().auction!.bidders).toEqual([r.ids.ann, r.ids.bob]);
      rooms.undo(r.code, r.ids.ann!);
      expect(r.state().auction!.bidders).toEqual([r.ids.ann, r.ids.bob, r.ids.cat]);
    });

    it('counts as passed when they drop mid-Auction', () => {
      const r = room();
      r.openAuction();
      rooms.disconnect(r.code, r.ids.cat!);
      expect(r.state().auction!.bidders).toEqual([r.ids.ann, r.ids.bob]);
      expect(changes.at(-1)!.events).toContainEqual({ type: 'AUCTION_PASSED', playerId: r.ids.cat });
    });
  });

  it('runs no Auction countdown while paused, and restarts it on resume', () => {
    const r = room();
    // The 10 s countdown has 6 s left when paused.
    r.openAuction();
    wait(4_000);
    rooms.act(r.code, { type: 'PAUSE', playerId: r.ids.ann! });
    wait(5 * 60_000);
    expect(r.state().auction).toBeDefined();

    rooms.act(r.code, { type: 'RESUME', playerId: r.ids.ann! });
    wait(5_999);
    expect(r.state().auction).toBeDefined();
    wait(1);
    expect(r.state().auction).toBeUndefined();
    expect(changes.at(-1)!.events).toContainEqual(expect.objectContaining({ type: 'AUCTION_UNSOLD' }));
  });

  describe('a Host who is away', () => {
    it('hands the role to the next connected Player in turn order after 2 minutes, for good', () => {
      const r = room(['ann', 'cat']);
      r.start();
      rooms.disconnect(r.code, r.ids.ann!);
      wait(HOST_AWAY_MS - 1);
      expect(r.state().hostId).toBe(r.ids.ann);

      wait(1);
      // bob is away too, so cat is next.
      expect(r.state().hostId).toBe(r.ids.cat);
      expect(changes.at(-1)!.events).toEqual([{ type: 'HOST_CHANGED', from: r.ids.ann, to: r.ids.cat, automatic: true }]);
      rooms.connect(r.code, r.ids.ann!);
      wait(HOST_AWAY_MS);
      expect(r.state().hostId).toBe(r.ids.cat);
    });

    it('keeps the role when they are back within 2 minutes', () => {
      const r = room();
      rooms.disconnect(r.code, r.ids.ann!);
      wait(HOST_AWAY_MS - 1);
      rooms.connect(r.code, r.ids.ann!);
      wait(HOST_AWAY_MS);
      expect(r.state().hostId).toBe(r.ids.ann);
    });

    it('waits for someone to connect when nobody is there to take over', () => {
      const r = room(['ann']);
      rooms.disconnect(r.code, r.ids.ann!);
      wait(HOST_AWAY_MS * 2);
      expect(r.state().hostId).toBe(r.ids.ann);
      rooms.connect(r.code, r.ids.bob!);
      wait(0);
      expect(r.state().hostId).toBe(r.ids.bob);
    });
  });

  it('stops a Player who left or was kicked from rejoining', () => {
    const r = room();
    r.start();
    rooms.act(r.code, { type: 'KICK', playerId: r.ids.ann!, targetId: r.ids.bob! });
    rooms.act(r.code, { type: 'LEAVE_ROOM', playerId: r.ids.cat! });
    expect(() => rooms.rejoin(r.code, r.tokens.bob)).toThrow(IllegalActionError);
    expect(() => rooms.rejoin(r.code, r.tokens.cat)).toThrow(IllegalActionError);
    expect(rooms.rejoin(r.code, r.tokens.ann)).toBe(r.ids.ann);
  });

  it('lets a late joiner rejoin as the same Spectator', () => {
    const r = room();
    r.start();
    const dan = rooms.join(r.code, 'dan', COLORS[0]);
    expect(r.state().spectators.map((s) => s.id)).toEqual([dan.playerId]);
    expect(rooms.rejoin(r.code, dan.token)).toBe(dan.playerId);
  });
});
