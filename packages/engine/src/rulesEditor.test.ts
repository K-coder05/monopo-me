import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  defaultBoard,
  defaultRules,
  IllegalActionError,
  type Action,
  type Decks,
  type GameState,
  type Rng,
} from './index';

function dice(...faces: number[]): Rng {
  const queue = [...faces];
  return {
    int(maxExclusive) {
      const face = queue.shift();
      if (face === undefined) throw new Error('scripted dice ran out');
      if (face < 1 || face > maxExclusive) throw new Error(`face ${face} impossible on d${maxExclusive}`);
      return face - 1;
    },
  };
}

const emptyDecks = (): Decks => ({ chance: { cards: [], drawPile: [] }, treasure: { cards: [], drawPile: [] } });

/** Like the server: every action reads the Rules held in the state. */
function act(state: GameState, action: Action, rng: Rng = dice()) {
  return applyAction(state, action, state.rules, rng, 0);
}

function lobby(): GameState {
  let state = createGame(
    'ABCDE',
    { id: 'ann', name: 'ann', color: 'a' },
    structuredClone(defaultRules),
    structuredClone(defaultBoard),
    emptyDecks(),
  );
  state = act(state, { type: 'JOIN_ROOM', playerId: 'bob', name: 'bob', color: 'b' }).state;
  return state;
}

/** ann (first, on GO) and bob, game started. */
function playing(): GameState {
  return act(lobby(), { type: 'START_GAME', playerId: 'ann' }, dice(6, 5, 1, 2)).state;
}

/** Sends UPDATE_RULES with untrusted-shaped values, as the server would pass them on. */
function editRules(state: GameState, changes: Record<string, unknown>, playerId = 'ann') {
  return act(state, { type: 'UPDATE_RULES', playerId, changes } as Action);
}

describe('editing Rules', () => {
  it('applies a change to the next action and logs it', () => {
    const { state: edited, events } = editRules(playing(), { goSalary: 400 });

    expect(edited.rules.goSalary).toBe(400);
    expect(events).toContainEqual({ type: 'RULE_CHANGED', key: 'goSalary', from: 200, to: 400 });
    expect(edited.rulesChangedMidGame).toBe(true);
  });

  it('pays the new GO salary to the next Player to pass GO', () => {
    let state = editRules(playing(), { goSalary: 400 }).state;
    state = { ...state, players: state.players.map((p) => (p.id === 'ann' ? { ...p, position: 38 } : p)) };
    const { state: after } = act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2));
    expect(after.players.find((p) => p.id === 'ann')!.cash).toBe(1500 + 400);
  });

  it('does not mark a Lobby edit as a mid-game change, and startingCash applies at start', () => {
    const edited = editRules(lobby(), { startingCash: 2000 }).state;
    expect(edited.rulesChangedMidGame).toBeUndefined();
    const started = act(edited, { type: 'START_GAME', playerId: 'ann' }, dice(6, 5, 1, 2)).state;
    expect(started.players.map((p) => p.cash)).toEqual([2000, 2000]);
  });

  it('never rewrites past state: raising startingCash mid-game leaves cash alone', () => {
    const state = playing();
    const { state: edited } = editRules(state, { startingCash: 5000 });
    expect(edited.players.map((p) => p.cash)).toEqual([1500, 1500]);
    expect(edited.deeds).toEqual(state.deeds);
  });

  it('logs nothing for a value that is unchanged', () => {
    const { events } = editRules(playing(), { goSalary: 200 });
    expect(events).toEqual([]);
  });

  it.each([
    [{ housesPerHotel: 5 }, /housesPerHotel/],
    [{ housesPerHotel: 0 }, /housesPerHotel/],
    [{ goSalary: -1 }, /goSalary/],
    [{ goSalary: 'lots' }, /goSalary/],
    [{ mortgageRate: 1.5 }, /mortgageRate/],
    [{ freeParkingMode: 'casino' }, /freeParkingMode/],
    [{ tradingEnabled: 'yes' }, /tradingEnabled/],
    [{ stationRents: [] }, /stationRents/],
    [{ utilityMultipliers: [4, 'x'] }, /utilityMultipliers/],
    [{ bankHouses: -3 }, /bankHouses/],
    [{ bogusKey: 1 }, /bogusKey/],
  ])('rejects %j with a message', (changes, message) => {
    expect(() => editRules(playing(), changes)).toThrow(IllegalActionError);
    expect(() => editRules(playing(), changes)).toThrow(message);
  });

  it('accepts null for unlimited bank houses', () => {
    expect(editRules(playing(), { bankHouses: 12 }).state.rules.bankHouses).toBe(12);
    expect(editRules(playing(), { bankHouses: null }).state.rules.bankHouses).toBeNull();
  });

  it('rejects the whole edit when one value is bad', () => {
    expect(() => editRules(playing(), { goSalary: 400, jailFine: -5 })).toThrow(IllegalActionError);
  });

  it('refuses anyone but the Host', () => {
    expect(() => editRules(playing(), { goSalary: 400 }, 'bob')).toThrow(/Host/);
    expect(() =>
      act(playing(), { type: 'UPDATE_BOARD', playerId: 'bob', edits: [{ index: 1, price: 1 }] }),
    ).toThrow(/Host/);
    expect(() => act(playing(), { type: 'RESET_TO_DEFAULTS', playerId: 'bob' })).toThrow(/Host/);
  });
});

describe('editing the Board', () => {
  it('changes a Space definition and logs each field', () => {
    const { state, events } = act(playing(), {
      type: 'UPDATE_BOARD',
      playerId: 'ann',
      edits: [{ index: 1, name: 'Old Kent Road', price: 80, rents: [3, 10, 30, 90, 160, 250] }],
    });
    expect(state.board[1]).toMatchObject({ name: 'Old Kent Road', price: 80, rents: [3, 10, 30, 90, 160, 250] });
    expect(events).toContainEqual({ type: 'SPACE_CHANGED', index: 1, field: 'price', from: 60, to: 80 });
    expect(events).toHaveLength(3);
  });

  it('changes a tax amount and house cost', () => {
    const { state } = act(playing(), {
      type: 'UPDATE_BOARD',
      playerId: 'ann',
      edits: [
        { index: 4, taxAmount: 150 },
        { index: 1, houseCost: 75 },
      ],
    });
    expect(state.board[4]!.taxAmount).toBe(150);
    expect(state.board[1]!.houseCost).toBe(75);
  });

  it.each([
    [{ index: 1, rents: [1, 2, 3] }, /6 entries/],
    [{ index: 1, price: -5 }, /price/],
    [{ index: 1, name: '   ' }, /name/],
    [{ index: 0, price: 100 }, /price/],
    [{ index: 4, houseCost: 10 }, /houseCost/],
    [{ index: 99, price: 10 }, /space/i],
  ])('rejects %j', (edit, message) => {
    expect(() => act(playing(), { type: 'UPDATE_BOARD', playerId: 'ann', edits: [edit] })).toThrow(message);
  });

  it('leaves existing Deeds alone and charges the new rent', () => {
    let state = playing();
    state = { ...state, deeds: { 3: { ownerId: 'bob', buildings: 0, mortgaged: false } } };
    state = act(state, { type: 'UPDATE_BOARD', playerId: 'ann', edits: [{ index: 3, rents: [40, 1, 1, 1, 1, 1] }] }).state;
    expect(state.deeds[3]).toEqual({ ownerId: 'bob', buildings: 0, mortgaged: false });
    const { state: after } = act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2));
    expect(after.players.find((p) => p.id === 'ann')!.cash).toBe(1500 - 40);
  });
});

describe('never retroactive', () => {
  it('lowering housesPerHotel leaves existing buildings standing', () => {
    let state = playing();
    state = { ...state, deeds: { 3: { ownerId: 'bob', buildings: 4, mortgaged: false } } };
    state = editRules(state, { housesPerHotel: 2 }).state;
    expect(state.deeds[3]!.buildings).toBe(4);
  });
});

describe('timing', () => {
  /** ann lands on unowned Brown 2 and declines: an Auction is open. */
  function inAuction(): GameState {
    let state = act(playing(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;
    state = act(state, { type: 'DECLINE_PROPERTY', playerId: 'ann' }).state;
    expect(state.turn!.step).toBe('auction');
    return state;
  }

  it('waits for an Auction to finish, then applies and logs', () => {
    const queued = editRules(inAuction(), { goSalary: 400 });
    let state = queued.state;
    expect(state.rules.goSalary).toBe(200);
    expect(state.pendingEdit).toBeDefined();
    expect(queued.events).toEqual([{ type: 'CHANGES_QUEUED' }]);

    state = act(state, { type: 'PASS_AUCTION', playerId: 'ann' }).state;
    expect(state.rules.goSalary).toBe(200);
    const result = act(state, { type: 'PASS_AUCTION', playerId: 'bob' });

    expect(result.state.turn!.step).not.toBe('auction');
    expect(result.state.rules.goSalary).toBe(400);
    expect(result.state.pendingEdit).toBeUndefined();
    expect(result.events).toContainEqual({ type: 'RULE_CHANGED', key: 'goSalary', from: 200, to: 400 });
  });

  it('queues Board edits too, and merges later edits over earlier ones', () => {
    let state = inAuction();
    state = editRules(state, { goSalary: 300 }).state;
    state = editRules(state, { goSalary: 400, jailFine: 50 }).state;
    state = act(state, { type: 'UPDATE_BOARD', playerId: 'ann', edits: [{ index: 3, price: 99 }] }).state;
    expect(state.board[3]!.price).toBe(60);

    state = act(state, { type: 'PASS_AUCTION', playerId: 'ann' }).state;
    state = act(state, { type: 'PASS_AUCTION', playerId: 'bob' }).state;
    expect(state.rules).toMatchObject({ goSalary: 400, jailFine: 50 });
    expect(state.board[3]!.price).toBe(99);
  });

  it('a queued change does not affect the running Auction', () => {
    let state = editRules(inAuction(), { auctionStartBid: 50 }).state;
    state = act(state, { type: 'PLACE_BID', playerId: 'bob', amount: 1 }).state;
    expect(state.auction!.highBid!.amount).toBe(1);
  });
});

describe('reset to defaults', () => {
  it('restores Rules and Board in one action', () => {
    let state = editRules(playing(), { goSalary: 400, housesPerHotel: 2 }).state;
    state = act(state, { type: 'UPDATE_BOARD', playerId: 'ann', edits: [{ index: 1, name: 'Mayfair', price: 1 }] }).state;

    const { state: reset, events } = act(state, { type: 'RESET_TO_DEFAULTS', playerId: 'ann' });

    expect(reset.rules).toEqual(defaultRules);
    expect(reset.board).toEqual(defaultBoard);
    expect(events).toContainEqual({ type: 'DEFAULTS_RESTORED' });
  });

  it('logs the reset when it applies, not when it is queued', () => {
    let state = act(playing(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;
    state = act(state, { type: 'DECLINE_PROPERTY', playerId: 'ann' }).state;
    const queued = act(state, { type: 'RESET_TO_DEFAULTS', playerId: 'ann' });
    expect(queued.events).toEqual([{ type: 'CHANGES_QUEUED' }]);
    state = act(queued.state, { type: 'PASS_AUCTION', playerId: 'ann' }).state;
    expect(act(state, { type: 'PASS_AUCTION', playerId: 'bob' }).events).toContainEqual({ type: 'DEFAULTS_RESTORED' });
  });

  it('leaves Decks and Deeds alone', () => {
    const state = { ...playing(), deeds: { 3: { ownerId: 'bob', buildings: 2, mortgaged: false } } };
    const { state: reset } = act(state, { type: 'RESET_TO_DEFAULTS', playerId: 'ann' });
    expect(reset.deeds).toEqual(state.deeds);
    expect(reset.decks).toEqual(state.decks);
  });

  it('waits behind a multi-step action like any other change', () => {
    let state = editRules(playing(), { goSalary: 400 }).state;
    state = act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;
    state = act(state, { type: 'DECLINE_PROPERTY', playerId: 'ann' }).state;
    state = act(state, { type: 'RESET_TO_DEFAULTS', playerId: 'ann' }).state;
    expect(state.rules.goSalary).toBe(400);
    state = act(state, { type: 'PASS_AUCTION', playerId: 'ann' }).state;
    state = act(state, { type: 'PASS_AUCTION', playerId: 'bob' }).state;
    expect(state.rules).toEqual(defaultRules);
  });
});
