import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  defaultBoard,
  defaultRules,
  HOTEL,
  IllegalActionError,
  type Action,
  type Card,
  type Deed,
  type GameState,
  type Override,
  type Player,
  type Rng,
} from './index';

/** Scripted values, then zeros once they run out. */
function script(...values: number[]): Rng {
  const queue = [...values];
  return { int: () => queue.shift() ?? 0 };
}

/** Rolls the given die faces (1-based). */
const dice = (...faces: number[]) => script(...faces.map((f) => f - 1));

function act(state: GameState, action: Action, rng: Rng = script()) {
  return applyAction(state, action, defaultRules, rng, 0);
}

/** ann (the Host), bob and cat in that turn order, ann to roll, with Chance holding `cards` (top first). */
function table(cards: Card[] = []): GameState {
  const decks = {
    chance: { cards, drawPile: cards.map((c) => c.id) },
    treasure: { cards: [] as Card[], drawPile: [] as string[] },
  };
  let state = createGame('ABCDE', { id: 'ann', name: 'ann', color: 'c0' }, defaultRules, defaultBoard, decks);
  for (const [i, name] of ['bob', 'cat'].entries()) {
    state = act(state, { type: 'JOIN_ROOM', playerId: name, name, color: `c${i + 1}` }).state;
  }
  // Roll-off in join order.
  const started = act(state, { type: 'START_GAME', playerId: 'ann' }, script(5, 5, 4, 4, 3, 3)).state;
  return { ...started, decks };
}

function withPlayer(state: GameState, id: string, patch: Partial<Player>): GameState {
  return { ...state, players: state.players.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

function owning(state: GameState, ownerId: string, indexes: number[], patch: Partial<Deed> = {}): GameState {
  const deeds = { ...state.deeds };
  for (const index of indexes) deeds[index] = { ownerId, buildings: 0, mortgaged: false, ...patch };
  return { ...state, deeds };
}

const player = (state: GameState, id: string) => state.players.find((p) => p.id === id)!;

function override(state: GameState, o: Override, by = 'ann', rng?: Rng) {
  return act(state, { type: 'HOST_OVERRIDE', playerId: by, override: o }, rng);
}

describe('Overrides', () => {
  it('adjusts a Player’s cash and logs it', () => {
    const o: Override = { kind: 'ADJUST_CASH', playerId: 'bob', amount: -200 };

    const { state, events } = override(table(), o);

    expect(player(state, 'bob').cash).toBe(1300);
    expect(events).toEqual([{ type: 'OVERRIDE', override: o }]);
    expect(state.log.at(-1)?.event).toEqual({ type: 'OVERRIDE', override: o });
  });

  it('are refused from anyone but the Host, and leave the state alone', () => {
    const state = table();

    expect(() => override(state, { kind: 'ADJUST_CASH', playerId: 'bob', amount: 500 }, 'bob')).toThrow('Only the Host');
    expect(player(state, 'bob').cash).toBe(1500);
  });

  it('refuse bad values', () => {
    const state = table();
    const bad = (o: unknown) => expect(() => override(state, o as Override)).toThrow(IllegalActionError);

    bad({ kind: 'ADJUST_CASH', playerId: 'bob', amount: -1501 });
    bad({ kind: 'ADJUST_CASH', playerId: 'bob', amount: 1.5 });
    bad({ kind: 'ADJUST_CASH', playerId: 'nobody', amount: 5 });
    bad({ kind: 'MOVE_TOKEN', playerId: 'bob', index: 40 });
    bad({ kind: 'SET_OWNER', index: 0, ownerId: 'bob' });
    bad({ kind: 'SET_BUILDINGS', index: 1, buildings: 1 });
    bad({ kind: 'TELEPORT' });
    bad('ADJUST_CASH');
  });

  it('move a token without salary or resolving the space', () => {
    const o: Override = { kind: 'MOVE_TOKEN', playerId: 'bob', index: 39 };

    const { state, events } = override(withPlayer(table(), 'bob', { position: 30 }), o);

    expect(player(state, 'bob')).toMatchObject({ position: 39, cash: 1500 });
    expect(events).toEqual([{ type: 'OVERRIDE', override: o }]);
    expect(state.turn?.step).toBe('awaitRoll');
  });

  it('reassign a Deed, buildings and all, or hand it back to the bank', () => {
    const built = owning(table(), 'bob', [37, 39], { buildings: 2 });

    const given = override(built, { kind: 'SET_OWNER', index: 39, ownerId: 'cat' }).state;
    expect(given.deeds[39]).toEqual({ ownerId: 'cat', buildings: 2, mortgaged: false });

    const returned = override(given, { kind: 'SET_OWNER', index: 37, ownerId: null }).state;
    expect(returned.deeds[37]).toBeUndefined();

    const bought = override(returned, { kind: 'SET_OWNER', index: 5, ownerId: 'ann' }).state;
    expect(bought.deeds[5]).toEqual({ ownerId: 'ann', buildings: 0, mortgaged: false });
  });

  it('add or remove buildings, ignoring the building rules', () => {
    // bob owns only one street of the group.
    const state = owning(table(), 'bob', [39]);

    const hotel = override(state, { kind: 'SET_BUILDINGS', index: 39, buildings: HOTEL }).state;
    expect(hotel.deeds[39]?.buildings).toBe(HOTEL);
    expect(override(hotel, { kind: 'SET_BUILDINGS', index: 39, buildings: 0 }).state.deeds[39]?.buildings).toBe(0);
    expect(() => override(state, { kind: 'SET_BUILDINGS', index: 5, buildings: 1 })).toThrow(IllegalActionError);
  });

  it('send a Player to Jail; the active Player’s turn then only waits to end', () => {
    const { state } = override(withPlayer(table(), 'ann', { position: 3 }), { kind: 'SEND_TO_JAIL', playerId: 'ann' });

    expect(player(state, 'ann')).toMatchObject({ position: 10, inJail: true, jailTurns: 0 });
    expect(state.turn?.step).toBe('awaitEndTurn');

    const bob = override(state, { kind: 'SEND_TO_JAIL', playerId: 'bob' }).state;
    expect(player(bob, 'bob')).toMatchObject({ position: 10, inJail: true });
    expect(() => override(bob, { kind: 'SEND_TO_JAIL', playerId: 'bob' })).toThrow('already in Jail');
  });

  it('release a Player from Jail where they stand', () => {
    const jailed = withPlayer(table(), 'bob', { position: 10, inJail: true, jailTurns: 2 });

    const { state } = override(jailed, { kind: 'RELEASE_FROM_JAIL', playerId: 'bob' });

    expect(player(state, 'bob')).toMatchObject({ position: 10, inJail: false, jailTurns: 0 });
    expect(() => override(state, { kind: 'RELEASE_FROM_JAIL', playerId: 'bob' })).toThrow('not in Jail');
  });

  it('skip a Player’s next turn', () => {
    const skipping = override(table(), { kind: 'SKIP_TURN', playerId: 'bob' }).state;
    const ready = { ...skipping, turn: { ...skipping.turn!, step: 'awaitEndTurn' as const } };

    const { state } = act(ready, { type: 'END_TURN', playerId: 'ann' });

    expect(state.turn?.playerId).toBe('cat');
  });

  it('end the turn at once, dropping a card being resolved', () => {
    const card: Card = {
      id: 'c-1', deck: 'chance', title: 'Wait', text: '', effects: [{ type: 'MANUAL' }], keepable: false, enabled: true, copies: 1,
    };
    // ann rolls 3 from 4 onto Chance at 7.
    const drawn = act(withPlayer(table([card]), 'ann', { position: 4 }), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;
    expect(drawn.turn?.step).toBe('awaitCard');

    const { state, events } = override(drawn, { kind: 'END_TURN' });

    expect(state.turn).toMatchObject({ playerId: 'bob', step: 'awaitRoll', cards: [] });
    expect(events.map((e) => e.type)).toEqual(['OVERRIDE', 'TURN_ENDED', 'TURN_STARTED']);
  });

  it('do not end the turn while a Debt or Auction is open', () => {
    const owing = { ...table(), debts: [{ debtorId: 'ann', creditor: { type: 'bank' as const }, amount: 5000, feedsJackpot: false }] };
    const blocked = { ...owing, turn: { ...owing.turn!, step: 'awaitDebt' as const } };

    expect(() => override(blocked, { kind: 'END_TURN' })).toThrow('Debt');
  });

  describe('on a Debt', () => {
    /** ann rolls 4 from 35 onto bob's Dark Blue 2 hotel (rent 2000) with 1500 cash. */
    const owing = () => {
      const ready = owning(withPlayer(table(), 'ann', { position: 35 }), 'bob', [37, 39], { buildings: HOTEL });
      return act(ready, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 3)).state;
    };

    it('settle cancels it without moving cash, and play carries on', () => {
      expect(owing().turn?.step).toBe('awaitDebt');

      const { state } = override(owing(), { kind: 'SETTLE_DEBT' });

      expect(state.debts).toEqual([]);
      expect(state.players.map((p) => p.cash)).toEqual([1500, 1500, 1500]);
      expect(state.turn?.step).toBe('awaitEndTurn');
    });

    it('force makes the debtor pay when they can', () => {
      const topped = override(owing(), { kind: 'ADJUST_CASH', playerId: 'ann', amount: 600 }).state;

      const { state, events } = override(topped, { kind: 'FORCE_DEBT' });

      expect(state.players.map((p) => p.cash)).toEqual([100, 3500, 1500]);
      expect(events).toContainEqual({ type: 'DEBT_PAID', debtorId: 'ann', creditor: { type: 'player', playerId: 'bob' }, amount: 2000 });
      expect(state.turn?.step).toBe('awaitEndTurn');
    });

    it('force makes the debtor bankrupt to the Creditor when they cannot pay', () => {
      const { state, events } = override(owing(), { kind: 'FORCE_DEBT' });

      expect(player(state, 'ann').bankrupt).toBe(true);
      expect(player(state, 'bob').cash).toBe(3000);
      expect(events).toContainEqual({ type: 'BANKRUPT', playerId: 'ann', creditor: { type: 'player', playerId: 'bob' } });
      expect(state.turn?.playerId).toBe('bob');
    });

    it('are refused when nobody owes anything', () => {
      expect(() => override(table(), { kind: 'SETTLE_DEBT' })).toThrow('No Debt');
      expect(() => override(table(), { kind: 'FORCE_DEBT' })).toThrow('No Debt');
    });
  });
});
