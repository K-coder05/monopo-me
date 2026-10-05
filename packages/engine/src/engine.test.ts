import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  defaultBoard,
  defaultRules,
  HOTEL,
  IllegalActionError,
  type Action,
  type Deed,
  type GameState,
  type Player,
  type Rng,
  type Rules,
} from './index';

/** An Rng that rolls the given die faces in order. */
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

const noDice: Rng = dice();

function lobby(names: string[], rules: Rules = defaultRules): GameState {
  const [host, ...others] = names;
  let state = createGame('ABCDE', { id: host!, name: host!, color: `${host}-colour` }, rules, defaultBoard);
  for (const name of others) {
    state = act(state, { type: 'JOIN_ROOM', playerId: name, name, color: `${name}-colour` }, noDice, rules).state;
  }
  return state;
}

/** Applies `action` at time `now` (ms). */
function act(state: GameState, action: Action, rng: Rng = noDice, rules: Rules = defaultRules, now = 0) {
  return applyAction(state, action, rules, rng, now);
}

describe('roll-off', () => {
  it('orders Players by highest roll-off total', () => {
    const state = lobby(['ann', 'bob', 'cat']);

    // ann 2+3=5, bob 6+5=11, cat 4+4=8
    const { state: next } = act(state, { type: 'START_GAME', playerId: 'ann' }, dice(2, 3, 6, 5, 4, 4));

    expect(next.phase).toBe('playing');
    expect(next.players.map((p) => p.id)).toEqual(['bob', 'cat', 'ann']);
    expect(next.turn).toMatchObject({ playerId: 'bob', step: 'awaitRoll', round: 1 });
  });

  it('re-rolls tied Players among themselves until the tie breaks', () => {
    const state = lobby(['ann', 'bob', 'cat', 'dan']);

    const rng = dice(
      // first roll-off: ann 7, bob 10, cat 7, dan 3
      3, 4, 5, 5, 6, 1, 1, 2,
      // ann and cat re-roll: tie again at 6
      1, 5, 2, 4,
      // ann and cat re-roll: ann 2, cat 12
      1, 1, 6, 6,
    );
    const { state: next, events } = act(state, { type: 'START_GAME', playerId: 'ann' }, rng);

    expect(next.players.map((p) => p.id)).toEqual(['bob', 'cat', 'ann', 'dan']);
    const rollOffs = events.filter((e) => e.type === 'ROLL_OFF');
    expect(rollOffs.map((e) => e.rolls.map((r) => r.playerId))).toEqual([
      ['ann', 'bob', 'cat', 'dan'],
      ['ann', 'cat'],
      ['ann', 'cat'],
    ]);
  });

  it('breaks several separate ties independently', () => {
    const state = lobby(['ann', 'bob', 'cat', 'dan']);

    const rng = dice(
      // ann 10, bob 4, cat 10, dan 4
      5, 5, 2, 2, 4, 6, 1, 3,
      // ann and cat re-roll: ann 3, cat 4
      1, 2, 2, 2,
      // bob and dan re-roll: bob 9, dan 5
      4, 5, 2, 3,
    );
    const { state: next } = act(state, { type: 'START_GAME', playerId: 'ann' }, rng);

    expect(next.players.map((p) => p.id)).toEqual(['cat', 'ann', 'bob', 'dan']);
  });
});

/** ann and bob in a started game, ann first. */
function started(rules: Rules = defaultRules): GameState {
  const roll = Array.from({ length: rules.diceCount * 2 }, (_, i) => (i < rules.diceCount ? 6 : 1));
  return act(lobby(['ann', 'bob'], rules), { type: 'START_GAME', playerId: 'ann' }, dice(...roll), rules).state;
}

function position(state: GameState, playerId: string) {
  return state.players.find((p) => p.id === playerId)!.position;
}

/** Rolls, declines any property offered (everyone passes in the Auction), and ends the turn. */
function playTurn(state: GameState, playerId: string, rng: Rng): GameState {
  let next = act(state, { type: 'ROLL_DICE', playerId }, rng).state;
  if (next.turn?.step === 'awaitBuyDecision') next = act(next, { type: 'DECLINE_PROPERTY', playerId }).state;
  for (const bidder of next.auction?.bidders ?? []) next = act(next, { type: 'PASS_AUCTION', playerId: bidder }).state;
  return act(next, { type: 'END_TURN', playerId }).state;
}

describe('rolling and moving', () => {
  it('moves the active Player clockwise by the dice total', () => {
    const { state, events } = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 4));

    expect(position(state, 'ann')).toBe(7);
    expect(position(state, 'bob')).toBe(0);
    expect(state.turn).toMatchObject({ playerId: 'ann', step: 'awaitEndTurn', lastRoll: [3, 4] });
    expect(events).toEqual([
      { type: 'DICE_ROLLED', playerId: 'ann', dice: [3, 4], total: 7 },
      { type: 'MOVED', playerId: 'ann', from: 0, to: 7 },
    ]);
  });

  it('wraps past index 39 back round the Board', () => {
    let state = started();
    // ann: 0 → 11 → 22 → 33, bob rolls in between
    for (let i = 0; i < 3; i++) {
      state = playTurn(state, 'ann', dice(5, 6));
      state = playTurn(state, 'bob', dice(1, 2));
    }
    expect(position(state, 'ann')).toBe(33);

    const { state: next, events } = act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(5, 6));

    expect(position(next, 'ann')).toBe(4);
    expect(events).toContainEqual({ type: 'MOVED', playerId: 'ann', from: 33, to: 4 });
  });

  it('rolls the dice count and sides set in the Rules', () => {
    const rules = { ...defaultRules, diceCount: 3, diceSides: 8 };

    const { state } = act(started(rules), { type: 'ROLL_DICE', playerId: 'ann' }, dice(8, 7, 1), rules);

    expect(position(state, 'ann')).toBe(16);
    expect(state.turn?.lastRoll).toEqual([8, 7, 1]);
  });

  it('does not let a Player roll out of turn', () => {
    expect(() => act(started(), { type: 'ROLL_DICE', playerId: 'bob' }, dice(1, 2))).toThrow(IllegalActionError);
  });

  it('does not let the active Player roll twice', () => {
    const state = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;

    expect(() => act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2))).toThrow(IllegalActionError);
  });

  it('does not allow rolling in the lobby', () => {
    expect(() => act(lobby(['ann', 'bob']), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2))).toThrow(
      IllegalActionError,
    );
  });
});

describe('turn order', () => {
  it('passes the turn to the next Player in roll-off order, then back round to the first in a new round', () => {
    // bob 12, cat 7, ann 2
    let state = act(lobby(['ann', 'bob', 'cat']), { type: 'START_GAME', playerId: 'ann' }, dice(1, 1, 6, 6, 3, 4))
      .state;
    const seen: [string, number][] = [];
    for (let i = 0; i < 4; i++) {
      const { playerId, round } = state.turn!;
      seen.push([playerId, round]);
      state = playTurn(state, playerId, dice(1, 2));
    }

    expect(seen).toEqual([
      ['bob', 1],
      ['cat', 1],
      ['ann', 1],
      ['bob', 2],
    ]);
  });

  it('does not let a Player end their turn before rolling', () => {
    expect(() => act(started(), { type: 'END_TURN', playerId: 'ann' })).toThrow(IllegalActionError);
  });

  it("does not let another Player end the active Player's turn", () => {
    const state = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;

    expect(() => act(state, { type: 'END_TURN', playerId: 'bob' })).toThrow(IllegalActionError);
  });
});

describe('game log', () => {
  it('records every event in order', () => {
    const state = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 4)).state;

    const types = state.log.map((e) => e.event.type);
    expect(types).toEqual([
      'PLAYER_JOINED',
      'PLAYER_JOINED',
      'GAME_STARTED',
      'ROLL_OFF',
      'TURN_ORDER_SET',
      'TURN_STARTED',
      'DICE_ROLLED',
      'MOVED',
    ]);
    expect(state.log.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(state.log[0]!.event).toEqual({ type: 'PLAYER_JOINED', playerId: 'ann' });
  });
});

describe('joining', () => {
  it('starts Players on the GO space of the Board', () => {
    const board = [...defaultBoard.slice(5), ...defaultBoard.slice(0, 5)].map((s, index) => ({ ...s, index }));

    const state = createGame('ABCDE', { id: 'ann', name: 'ann', color: 'red' }, defaultRules, board);

    expect(state.players[0]!.position).toBe(35);
  });

  it('does not let two Players share a token colour', () => {
    const state = lobby(['ann']);

    expect(() => act(state, { type: 'JOIN_ROOM', playerId: 'bob', name: 'bob', color: 'ann-colour' })).toThrow(
      IllegalActionError,
    );
  });
});

describe('starting the game', () => {
  it('only lets the Host start', () => {
    const state = lobby(['ann', 'bob']);

    expect(() => act(state, { type: 'START_GAME', playerId: 'bob' }, dice(1, 2, 3, 4))).toThrow(IllegalActionError);
  });

  it('needs at least two Players with the Defaults', () => {
    const state = lobby(['ann']);

    expect(() => act(state, { type: 'START_GAME', playerId: 'ann' }, dice(1, 2))).toThrow(IllegalActionError);
  });

  it('reads the minimum Player count from the Rules', () => {
    const rules = { ...defaultRules, minPlayers: 3 };
    const state = lobby(['ann', 'bob'], rules);

    expect(() => act(state, { type: 'START_GAME', playerId: 'ann' }, dice(1, 2, 3, 4), rules)).toThrow(
      IllegalActionError,
    );
  });

  it('cannot start a game that has already started', () => {
    const state = act(lobby(['ann', 'bob']), { type: 'START_GAME', playerId: 'ann' }, dice(6, 6, 1, 1)).state;

    expect(() => act(state, { type: 'START_GAME', playerId: 'ann' }, dice(1, 2, 3, 4))).toThrow(IllegalActionError);
  });

  it('turns away joiners once the Room is full', () => {
    const rules = { ...defaultRules, maxPlayers: 2 };
    const state = lobby(['ann', 'bob'], rules);

    expect(() =>
      act(state, { type: 'JOIN_ROOM', playerId: 'cat', name: 'cat', color: 'green' }, noDice, rules),
    ).toThrow(IllegalActionError);
  });

  it('turns away joiners once the game has started', () => {
    const state = act(lobby(['ann', 'bob']), { type: 'START_GAME', playerId: 'ann' }, dice(6, 6, 1, 1)).state;

    expect(() => act(state, { type: 'JOIN_ROOM', playerId: 'cat', name: 'cat', color: 'green' })).toThrow(
      IllegalActionError,
    );
  });
});

function player(state: GameState, playerId: string): Player {
  return state.players.find((p) => p.id === playerId)!;
}

function withPlayer(state: GameState, playerId: string, patch: Partial<Player>): GameState {
  return { ...state, players: state.players.map((p) => (p.id === playerId ? { ...p, ...patch } : p)) };
}

/** Gives `ownerId` unimproved, unmortgaged Deeds for the given space indexes. */
function owning(state: GameState, ownerId: string, indexes: number[], patch: Partial<Deed> = {}): GameState {
  const deeds = { ...state.deeds };
  for (const index of indexes) deeds[index] = { ownerId, buildings: 0, mortgaged: false, ...patch };
  return { ...state, deeds };
}

describe('buying property', () => {
  it('offers an unowned property at its List price when the Player lands on it', () => {
    const { state, events } = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2));

    expect(state.turn?.step).toBe('awaitBuyDecision');
    expect(events).toContainEqual({ type: 'PROPERTY_OFFERED', playerId: 'ann', index: 3, price: 60 });
  });

  it.each([
    ['a station', 2, 3, 5],
    ['a utility', 6, 6, 12],
  ])('offers %s too', (_, d1, d2, index) => {
    const { state } = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(d1, d2));

    expect(state.turn?.step).toBe('awaitBuyDecision');
    expect(position(state, 'ann')).toBe(index);
  });

  it('deducts the List price and creates the Deed when the Player buys', () => {
    const landed = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;

    const { state, events } = act(landed, { type: 'BUY_PROPERTY', playerId: 'ann' });

    expect(player(state, 'ann').cash).toBe(1440);
    expect(state.deeds[3]).toEqual({ ownerId: 'ann', buildings: 0, mortgaged: false });
    expect(state.turn?.step).toBe('awaitEndTurn');
    expect(events).toEqual([{ type: 'PROPERTY_BOUGHT', playerId: 'ann', index: 3, price: 60 }]);
  });

  it('charges the current List price from the Board', () => {
    const game = started();
    const board = game.board.map((s) => (s.index === 3 ? { ...s, price: 75 } : s));
    const landed = act({ ...game, board }, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;

    const { state } = act(landed, { type: 'BUY_PROPERTY', playerId: 'ann' });

    expect(player(state, 'ann').cash).toBe(1425);
  });

  it('ends the decision without a Deed when the Player declines and auctionOnDecline is off', () => {
    const rules = { ...defaultRules, auctionOnDecline: false };
    const landed = act(started(rules), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2), rules).state;

    const { state, events } = act(landed, { type: 'DECLINE_PROPERTY', playerId: 'ann' }, noDice, rules);

    expect(state.deeds[3]).toBeUndefined();
    expect(player(state, 'ann').cash).toBe(1500);
    expect(state.turn?.step).toBe('awaitEndTurn');
    expect(events).toEqual([{ type: 'PROPERTY_DECLINED', playerId: 'ann', index: 3 }]);
  });

  it('does not let the Player end their turn while the buy decision is open', () => {
    const landed = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;

    expect(() => act(landed, { type: 'END_TURN', playerId: 'ann' })).toThrow(IllegalActionError);
  });

  it('does not let another Player buy or decline', () => {
    const landed = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;

    expect(() => act(landed, { type: 'BUY_PROPERTY', playerId: 'bob' })).toThrow(IllegalActionError);
    expect(() => act(landed, { type: 'DECLINE_PROPERTY', playerId: 'bob' })).toThrow(IllegalActionError);
  });

  it('does not offer anything on a space that is not a property', () => {
    const { state, events } = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 4));

    expect(state.turn?.step).toBe('awaitEndTurn');
    expect(events.map((e) => e.type)).toEqual(['DICE_ROLLED', 'MOVED']);
    expect(() => act(state, { type: 'BUY_PROPERTY', playerId: 'ann' })).toThrow(IllegalActionError);
  });

  it('does nothing when the Player lands on their own property', () => {
    const { state, events } = act(owning(started(), 'ann', [3]), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2));

    expect(state.turn?.step).toBe('awaitEndTurn');
    expect(player(state, 'ann').cash).toBe(1500);
    expect(events.map((e) => e.type)).toEqual(['DICE_ROLLED', 'MOVED']);
  });

  it('refuses the purchase when the Player cannot afford it', () => {
    const poor = withPlayer(started(), 'ann', { cash: 59 });
    const landed = act(poor, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;

    expect(() => act(landed, { type: 'BUY_PROPERTY', playerId: 'ann' })).toThrow(IllegalActionError);
  });
});

describe('rent', () => {
  /** ann rolls onto `index` (from GO) with bob owning `owned`; returns the result. */
  function landOn(owned: number[], roll: [number, number], rules: Rules = defaultRules, patch: Partial<Deed> = {}) {
    return act(owning(started(rules), 'bob', owned, patch), { type: 'ROLL_DICE', playerId: 'ann' }, dice(...roll), rules);
  }

  it('charges base rent on a street', () => {
    const { state, events } = landOn([3], [1, 2]);

    expect(player(state, 'ann').cash).toBe(1496);
    expect(player(state, 'bob').cash).toBe(1504);
    expect(state.turn?.step).toBe('awaitEndTurn');
    expect(events).toContainEqual({ type: 'RENT_PAID', playerId: 'ann', ownerId: 'bob', index: 3, amount: 4 });
  });

  it('multiplies base rent when the owner holds the whole Colour group', () => {
    const { state } = landOn([1, 3], [1, 2]);

    expect(player(state, 'ann').cash).toBe(1492);
  });

  it('reads the Colour group multiplier from the Rules', () => {
    const { state } = landOn([1, 3], [1, 2], { ...defaultRules, colourGroupRentMultiplier: 3 });

    expect(player(state, 'ann').cash).toBe(1488);
  });

  it('does not multiply when the owner holds only part of the Colour group', () => {
    const { state } = landOn([6, 8], [4, 4]);

    expect(player(state, 'ann').cash).toBe(1494);
  });

  it.each([
    [[5], 25],
    [[5, 15], 50],
    [[5, 15, 25], 100],
    [[5, 15, 25, 35], 200],
  ])('charges station rent by stations owned (%j → %i)', (owned, rent) => {
    const { state } = landOn(owned, [2, 3]);

    expect(player(state, 'ann').cash).toBe(1500 - rent);
  });

  it('reads station rents from the Rules', () => {
    const { state } = landOn([5, 15], [2, 3], { ...defaultRules, stationRents: [10, 30, 60, 90] });

    expect(player(state, 'ann').cash).toBe(1470);
  });

  it.each([
    [[12], 4 * 12],
    [[12, 28], 10 * 12],
  ])('charges utility rent as a multiple of the dice total (%j → %i)', (owned, rent) => {
    const { state } = landOn(owned, [6, 6]);

    expect(player(state, 'ann').cash).toBe(1500 - rent);
  });

  it('reads utility multipliers from the Rules', () => {
    const { state } = landOn([12], [6, 6], { ...defaultRules, utilityMultipliers: [7, 20] });

    expect(player(state, 'ann').cash).toBe(1500 - 7 * 12);
  });

  it('charges nothing on a mortgaged property', () => {
    const { state, events } = landOn([3], [1, 2], defaultRules, { mortgaged: true });

    expect(player(state, 'ann').cash).toBe(1500);
    expect(events).toContainEqual({ type: 'RENT_WAIVED', playerId: 'ann', ownerId: 'bob', index: 3, reason: 'mortgaged' });
  });

  it('does not count mortgaged stations', () => {
    const game = owning(owning(started(), 'bob', [5]), 'bob', [15], { mortgaged: true });

    const { state } = act(game, { type: 'ROLL_DICE', playerId: 'ann' }, dice(2, 3));

    expect(player(state, 'ann').cash).toBe(1475);
  });

  it('does not count mortgaged utilities', () => {
    const game = owning(owning(started(), 'bob', [12]), 'bob', [28], { mortgaged: true });

    const { state } = act(game, { type: 'ROLL_DICE', playerId: 'ann' }, dice(6, 6));

    expect(player(state, 'ann').cash).toBe(1500 - 4 * 12);
  });

  it('still multiplies an unmortgaged street whose Colour group has a mortgaged street', () => {
    const game = owning(owning(started(), 'bob', [3]), 'bob', [1], { mortgaged: true });

    const { state } = act(game, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2));

    expect(player(state, 'ann').cash).toBe(1492);
  });

  it('charges nothing when the owner is in Jail, by default', () => {
    const game = withPlayer(owning(started(), 'bob', [3]), 'bob', { inJail: true });

    const { state, events } = act(game, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2));

    expect(player(state, 'ann').cash).toBe(1500);
    expect(player(state, 'bob').cash).toBe(1500);
    expect(events).toContainEqual({ type: 'RENT_WAIVED', playerId: 'ann', ownerId: 'bob', index: 3, reason: 'ownerInJail' });
  });

  it('charges rent to a jailed owner when collectRentInJail is on', () => {
    const rules = { ...defaultRules, collectRentInJail: true };
    const game = withPlayer(owning(started(rules), 'bob', [3]), 'bob', { inJail: true });

    const { state } = act(game, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2), rules);

    expect(player(state, 'ann').cash).toBe(1496);
    expect(player(state, 'bob').cash).toBe(1504);
  });
});

describe('mustCompleteLapBeforeBuying', () => {
  const rules = { ...defaultRules, mustCompleteLapBeforeBuying: true };

  it('offers nothing on an unowned property before the first pass of GO', () => {
    const { state, events } = act(started(rules), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2), rules);

    expect(state.turn?.step).toBe('awaitEndTurn');
    expect(events).toContainEqual({ type: 'PURCHASE_LOCKED', playerId: 'ann', index: 3 });
    expect(events.some((e) => e.type === 'PROPERTY_OFFERED')).toBe(false);
    expect(() => act(state, { type: 'BUY_PROPERTY', playerId: 'ann' }, noDice, rules)).toThrow(IllegalActionError);
  });

  it('offers the property once the Player has passed GO', () => {
    const game = withPlayer(started(rules), 'ann', { position: 36 });

    // 36 + 7 wraps round to 3
    const { state } = act(game, { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 4), rules);

    expect(player(state, 'ann').hasPassedGo).toBe(true);
    expect(state.turn?.step).toBe('awaitBuyDecision');
  });

  it('still charges rent before the first pass of GO', () => {
    const game = owning(started(rules), 'bob', [3]);

    const { state } = act(game, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2), rules);

    expect(player(state, 'ann').cash).toBe(1496);
  });
});

describe('GO salary', () => {
  /** ann rolls `roll` from `from`; returns the result. */
  function rollFrom(from: number, roll: number[], rules: Rules = defaultRules) {
    return act(withPlayer(started(rules), 'ann', { position: from }), { type: 'ROLL_DICE', playerId: 'ann' }, dice(...roll), rules);
  }

  it('pays goSalary when the Player passes GO', () => {
    // 36 + 7 wraps round to 3
    const { state, events } = rollFrom(36, [3, 4]);

    expect(player(state, 'ann').cash).toBe(1700);
    expect(events).toContainEqual({ type: 'GO_SALARY', playerId: 'ann', amount: 200 });
  });

  it('pays goSalary when the Player lands exactly on GO', () => {
    const { state, events } = rollFrom(36, [2, 2]);

    expect(position(state, 'ann')).toBe(0);
    expect(player(state, 'ann').cash).toBe(1700);
    expect(events).toContainEqual({ type: 'GO_SALARY', playerId: 'ann', amount: 200 });
  });

  it('pays double for an exact landing when doubleSalaryOnExactGo is on', () => {
    const rules = { ...defaultRules, doubleSalaryOnExactGo: true };

    const { state, events } = rollFrom(36, [2, 2], rules);

    expect(player(state, 'ann').cash).toBe(1900);
    expect(events).toContainEqual({ type: 'GO_SALARY', playerId: 'ann', amount: 400 });
  });

  it('pays only single salary for passing GO when doubleSalaryOnExactGo is on', () => {
    const rules = { ...defaultRules, doubleSalaryOnExactGo: true };

    const { state } = rollFrom(36, [3, 4], rules);

    expect(player(state, 'ann').cash).toBe(1700);
  });

  it('reads the salary from the Rules', () => {
    const rules = { ...defaultRules, goSalary: 350 };

    const { state } = rollFrom(36, [3, 4], rules);

    expect(player(state, 'ann').cash).toBe(1850);
  });

  it('pays nothing on a move that does not reach GO', () => {
    const { state, events } = rollFrom(0, [3, 4]);

    expect(player(state, 'ann').cash).toBe(1500);
    expect(events.some((e) => e.type === 'GO_SALARY')).toBe(false);
  });

  it('pays once per lap when a single roll goes round more than once', () => {
    const rules = { ...defaultRules, diceCount: 1, diceSides: 100 };

    // 0 + 85 laps twice and ends on 5
    const { state, events } = rollFrom(0, [85], rules);

    expect(position(state, 'ann')).toBe(5);
    expect(events).toContainEqual({ type: 'GO_SALARY', playerId: 'ann', amount: 400 });
  });

  it('finds GO wherever it is on the Board', () => {
    const board = [...defaultBoard.slice(5), ...defaultBoard.slice(0, 5)].map((s, index) => ({ ...s, index }));
    const game = withPlayer({ ...started(), board }, 'ann', { position: 30 });

    // 30 + 7 = 37 passes GO at 35
    const { state } = act(game, { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 4));

    expect(player(state, 'ann').cash).toBe(1700);
    expect(player(state, 'ann').hasPassedGo).toBe(true);
  });
});

describe('tax spaces', () => {
  it('charges Income Tax from its Space definition', () => {
    const { state, events } = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 3));

    expect(player(state, 'ann').cash).toBe(1300);
    expect(state.turn?.step).toBe('awaitEndTurn');
    expect(events).toContainEqual({ type: 'TAX_PAID', playerId: 'ann', index: 4, amount: 200 });
  });

  it('charges Luxury Tax from its Space definition', () => {
    const game = withPlayer(started(), 'ann', { position: 33 });

    const { state } = act(game, { type: 'ROLL_DICE', playerId: 'ann' }, dice(2, 3));

    expect(player(state, 'ann').cash).toBe(1400);
  });

  it('charges the current tax amount from the Board', () => {
    const game = started();
    const board = game.board.map((s) => (s.index === 4 ? { ...s, taxAmount: 75 } : s));

    const { state } = act({ ...game, board }, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 3));

    expect(player(state, 'ann').cash).toBe(1425);
  });

  it('lets cash go negative when the Player cannot afford the tax', () => {
    const { state } = act(withPlayer(started(), 'ann', { cash: 50 }), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 3));

    expect(player(state, 'ann').cash).toBe(-150);
  });

  it('does not feed the Jackpot when freeParkingMode is not jackpot', () => {
    const { state } = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 3));

    expect(state.bank.jackpot).toBe(0);
  });
});

describe('Free Parking', () => {
  /** ann rolls from 13 onto Free Parking (20). */
  function landOnFreeParking(game: GameState, rules: Rules) {
    return act(withPlayer(game, 'ann', { position: 13 }), { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 4), rules);
  }

  it('does nothing by default', () => {
    const { state, events } = landOnFreeParking(started(), defaultRules);

    expect(position(state, 'ann')).toBe(20);
    expect(player(state, 'ann').cash).toBe(1500);
    expect(events.map((e) => e.type)).toEqual(['DICE_ROLLED', 'MOVED']);
  });

  it('pays freeParkingAmount from the bank in fixed mode', () => {
    const rules: Rules = { ...defaultRules, freeParkingMode: 'fixed', freeParkingAmount: 150 };

    const { state, events } = landOnFreeParking(started(rules), rules);

    expect(player(state, 'ann').cash).toBe(1650);
    expect(events).toContainEqual({ type: 'FREE_PARKING_PAID', playerId: 'ann', amount: 150 });
  });

  describe('Jackpot mode', () => {
    const rules: Rules = { ...defaultRules, freeParkingMode: 'jackpot' };

    it('collects tax payments in the Jackpot', () => {
      const { state } = act(started(rules), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 3), rules);

      expect(state.bank.jackpot).toBe(200);
    });

    it('pays the whole Jackpot to the Player who lands on Free Parking and resets it', () => {
      const game = { ...started(rules), bank: { jackpot: 300 } };

      const { state, events } = landOnFreeParking(game, rules);

      expect(player(state, 'ann').cash).toBe(1800);
      expect(state.bank.jackpot).toBe(0);
      expect(events).toContainEqual({ type: 'JACKPOT_WON', playerId: 'ann', amount: 300 });
    });

    it('pays out what tax put in', () => {
      // ann pays 200 Income Tax, then bob rolls from 13 onto Free Parking
      let state = act(started(rules), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 3), rules).state;
      state = act(state, { type: 'END_TURN', playerId: 'ann' }, noDice, rules).state;
      state = withPlayer(state, 'bob', { position: 13 });

      const { state: next } = act(state, { type: 'ROLL_DICE', playerId: 'bob' }, dice(3, 4), rules);

      expect(player(next, 'bob').cash).toBe(1700);
      expect(next.bank.jackpot).toBe(0);
    });

    it('is not fed by property purchases', () => {
      const landed = act(started(rules), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2), rules).state;

      const { state } = act(landed, { type: 'BUY_PROPERTY', playerId: 'ann' }, noDice, rules);

      expect(state.bank.jackpot).toBe(0);
    });

    it('is not fed by Auction purchases', () => {
      let state = act(started(rules), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2), rules).state;
      state = act(state, { type: 'DECLINE_PROPERTY', playerId: 'ann' }, noDice, rules).state;
      state = act(state, { type: 'PLACE_BID', playerId: 'bob', amount: 40 }, noDice, rules).state;
      state = act(state, { type: 'PASS_AUCTION', playerId: 'ann' }, noDice, rules).state;

      expect(state.deeds[3]?.ownerId).toBe('bob');
      expect(state.bank.jackpot).toBe(0);
    });

    it('is not fed by rent', () => {
      const game = owning(started(rules), 'bob', [3]);

      const { state } = act(game, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2), rules);

      expect(state.bank.jackpot).toBe(0);
    });

    it('pays nothing when the Jackpot is empty', () => {
      const { state, events } = landOnFreeParking(started(rules), rules);

      expect(player(state, 'ann').cash).toBe(1500);
      expect(events.some((e) => e.type === 'JACKPOT_WON')).toBe(false);
    });
  });
});

describe('auctions', () => {
  const COUNTDOWN = defaultRules.auctionSeconds * 1000;

  /** ann, bob and cat in a started game (that order); ann landed on Baltic Avenue (3) and declined at t=0. */
  function auction(rules: Rules = defaultRules): GameState {
    // ann 12, bob 7, cat 2
    const lobbied = lobby(['ann', 'bob', 'cat'], rules);
    let state = act(lobbied, { type: 'START_GAME', playerId: 'ann' }, dice(6, 6, 3, 4, 1, 1), rules).state;
    state = act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2), rules).state;
    return act(state, { type: 'DECLINE_PROPERTY', playerId: 'ann' }, noDice, rules, 0).state;
  }

  const bid = (state: GameState, playerId: string, amount: number, now = 0, rules = defaultRules) =>
    act(state, { type: 'PLACE_BID', playerId, amount }, noDice, rules, now);
  const pass = (state: GameState, playerId: string) => act(state, { type: 'PASS_AUCTION', playerId });
  const expire = (state: GameState, now: number) => act(state, { type: 'EXPIRE_AUCTION' }, noDice, defaultRules, now);

  it('opens an Auction to every Player, including the one who declined', () => {
    const state = auction();

    expect(state.turn?.step).toBe('auction');
    expect(state.auction).toEqual({ index: 3, bidders: ['ann', 'bob', 'cat'], endsAt: COUNTDOWN });
    expect(state.log.map((e) => e.event)).toContainEqual({ type: 'AUCTION_STARTED', index: 3, endsAt: COUNTDOWN });
  });

  it('does not let the active Player end their turn while the Auction is open', () => {
    expect(() => act(auction(), { type: 'END_TURN', playerId: 'ann' })).toThrow(IllegalActionError);
  });

  it('does not let anyone buy or decline during the Auction', () => {
    const state = auction();

    expect(() => act(state, { type: 'BUY_PROPERTY', playerId: 'ann' })).toThrow(IllegalActionError);
    expect(() => act(state, { type: 'DECLINE_PROPERTY', playerId: 'ann' })).toThrow(IllegalActionError);
  });

  it('records the highest bid and its leader', () => {
    const { state, events } = bid(auction(), 'bob', 20, 1000);

    expect(state.auction?.highBid).toEqual({ playerId: 'bob', amount: 20 });
    expect(events).toEqual([{ type: 'BID_PLACED', playerId: 'bob', amount: 20, endsAt: 1000 + COUNTDOWN }]);
  });

  it('rejects a bid that does not beat the current bid', () => {
    const state = bid(auction(), 'bob', 20).state;

    expect(() => bid(state, 'cat', 19)).toThrow(IllegalActionError);
    expect(() => bid(state, 'cat', 20)).toThrow(IllegalActionError);
  });

  it('rejects a bid below auctionStartBid', () => {
    const rules = { ...defaultRules, auctionStartBid: 10 };

    expect(() => bid(auction(rules), 'bob', 9, 0, rules)).toThrow(IllegalActionError);
    expect(bid(auction(rules), 'bob', 10, 0, rules).state.auction?.highBid?.amount).toBe(10);
  });

  it.each([0, -5, 2.5, Number.NaN])('rejects a bid of %d', (amount) => {
    expect(() => bid(auction(), 'bob', amount)).toThrow(IllegalActionError);
  });

  it('does not let a Player bid more than their cash', () => {
    const state = withPlayer(auction(), 'bob', { cash: 50 });

    expect(() => bid(state, 'bob', 51)).toThrow(IllegalActionError);
    expect(bid(state, 'bob', 50).state.auction?.highBid?.amount).toBe(50);
  });

  it('does not let the leader outbid themselves', () => {
    const state = bid(auction(), 'bob', 20).state;

    expect(() => bid(state, 'bob', 30)).toThrow(IllegalActionError);
  });

  it('restarts the countdown on each bid', () => {
    let state = bid(auction(), 'bob', 20, 4000).state;
    expect(state.auction?.endsAt).toBe(4000 + COUNTDOWN);
    state = bid(state, 'cat', 30, 9000).state;

    expect(state.auction?.endsAt).toBe(9000 + COUNTDOWN);
    // The first deadline has passed, but the restarted countdown has not.
    expect(() => expire(state, 4000 + COUNTDOWN)).toThrow(IllegalActionError);
  });

  it('reads the countdown length from the Rules', () => {
    const rules = { ...defaultRules, auctionSeconds: 3 };

    expect(auction(rules).auction?.endsAt).toBe(3000);
    expect(bid(auction(rules), 'bob', 5, 1000, rules).state.auction?.endsAt).toBe(4000);
  });

  it('sells to the highest bidder when the countdown expires', () => {
    let state = bid(auction(), 'bob', 20, 1000).state;
    state = bid(state, 'cat', 30, 2000).state;

    const { state: next, events } = expire(state, 2000 + COUNTDOWN);

    expect(next.deeds[3]).toEqual({ ownerId: 'cat', buildings: 0, mortgaged: false });
    expect(player(next, 'cat').cash).toBe(1470);
    expect(player(next, 'bob').cash).toBe(1500);
    expect(next.auction).toBeUndefined();
    expect(next.turn).toMatchObject({ playerId: 'ann', step: 'awaitEndTurn' });
    expect(events).toEqual([{ type: 'AUCTION_WON', playerId: 'cat', index: 3, amount: 30 }]);
  });

  it('does not expire before the countdown runs out', () => {
    expect(() => expire(auction(), COUNTDOWN - 1)).toThrow(IllegalActionError);
  });

  it('cannot expire when no Auction is open', () => {
    expect(() => expire(started(), 999_999)).toThrow(IllegalActionError);
  });

  it('keeps the property with the bank when nobody bids', () => {
    const { state, events } = expire(auction(), COUNTDOWN);

    expect(state.deeds[3]).toBeUndefined();
    expect(state.players.map((p) => p.cash)).toEqual([1500, 1500, 1500]);
    expect(state.turn?.step).toBe('awaitEndTurn');
    expect(events).toEqual([{ type: 'AUCTION_UNSOLD', index: 3 }]);
  });

  it('keeps the property with the bank when everyone passes', () => {
    let state = pass(auction(), 'ann').state;
    state = pass(state, 'bob').state;
    const { state: next, events } = pass(state, 'cat');

    expect(next.deeds[3]).toBeUndefined();
    expect(next.turn?.step).toBe('awaitEndTurn');
    expect(events).toEqual([
      { type: 'AUCTION_PASSED', playerId: 'cat' },
      { type: 'AUCTION_UNSOLD', index: 3 },
    ]);
  });

  it('makes passing final', () => {
    const state = pass(auction(), 'bob').state;

    expect(state.auction?.bidders).toEqual(['ann', 'cat']);
    expect(() => bid(state, 'bob', 20)).toThrow(IllegalActionError);
    expect(() => pass(state, 'bob')).toThrow(IllegalActionError);
  });

  it('ends the Auction when only the leader remains', () => {
    let state = bid(auction(), 'bob', 20).state;
    state = pass(state, 'ann').state;

    const { state: next, events } = pass(state, 'cat');

    expect(next.deeds[3]?.ownerId).toBe('bob');
    expect(player(next, 'bob').cash).toBe(1480);
    expect(next.turn?.step).toBe('awaitEndTurn');
    expect(events).toEqual([
      { type: 'AUCTION_PASSED', playerId: 'cat' },
      { type: 'AUCTION_WON', playerId: 'bob', index: 3, amount: 20 },
    ]);
  });

  it('lets the last Player in bid when nobody has yet, selling to them at once', () => {
    let state = pass(auction(), 'bob').state;
    state = pass(state, 'cat').state;
    expect(state.turn?.step).toBe('auction');

    const { state: next } = bid(state, 'ann', 5);

    expect(next.deeds[3]?.ownerId).toBe('ann');
    expect(player(next, 'ann').cash).toBe(1495);
  });

  it('does not let the leader pass', () => {
    const state = bid(auction(), 'bob', 20).state;

    expect(() => pass(state, 'bob')).toThrow(IllegalActionError);
  });

  it('lets the declining Player win the Auction', () => {
    let state = bid(auction(), 'bob', 20).state;
    state = bid(state, 'ann', 25).state;

    const { state: next } = expire(state, COUNTDOWN);

    expect(next.deeds[3]?.ownerId).toBe('ann');
    expect(player(next, 'ann').cash).toBe(1475);
  });

  it('only allows bids and passes while an Auction is open', () => {
    const landed = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;

    expect(() => bid(landed, 'bob', 20)).toThrow(IllegalActionError);
    expect(() => pass(landed, 'bob')).toThrow(IllegalActionError);
  });
});

/** Rolls, then declines any property offered (everyone passes in the Auction), leaving the turn to continue. */
function rollResolved(state: GameState, playerId: string, rng: Rng, rules: Rules = defaultRules) {
  const rolled = act(state, { type: 'ROLL_DICE', playerId }, rng, rules);
  let next = rolled.state;
  if (next.turn?.step === 'awaitBuyDecision') next = act(next, { type: 'DECLINE_PROPERTY', playerId }, noDice, rules).state;
  for (const bidder of next.auction?.bidders ?? []) {
    next = act(next, { type: 'PASS_AUCTION', playerId: bidder }, noDice, rules).state;
  }
  return { state: next, events: rolled.events };
}

describe('Doubles', () => {
  it('give the Player another roll once the space is resolved', () => {
    // 2 + 2 lands on Income Tax
    const { state, events } = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(2, 2));

    expect(player(state, 'ann').cash).toBe(1300);
    expect(state.turn).toMatchObject({ playerId: 'ann', step: 'awaitRoll' });
    expect(events).toContainEqual({ type: 'ROLL_AGAIN', playerId: 'ann' });
    expect(() => act(state, { type: 'END_TURN', playerId: 'ann' })).toThrow(IllegalActionError);
  });

  it('give the extra roll after the Player buys the property', () => {
    const landed = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 3)).state;
    expect(landed.turn?.step).toBe('awaitBuyDecision');

    const { state } = act(landed, { type: 'BUY_PROPERTY', playerId: 'ann' });

    expect(state.turn).toMatchObject({ playerId: 'ann', step: 'awaitRoll' });
  });

  it('give the extra roll after the Auction settles', () => {
    const { state } = rollResolved(started(), 'ann', dice(3, 3));

    expect(state.turn).toMatchObject({ playerId: 'ann', step: 'awaitRoll' });
  });

  it('give the extra roll when declining without an Auction', () => {
    const rules = { ...defaultRules, auctionOnDecline: false };

    const { state } = rollResolved(started(rules), 'ann', dice(3, 3), rules);

    expect(state.turn).toMatchObject({ playerId: 'ann', step: 'awaitRoll' });
  });

  it('end the run once a roll is not Doubles', () => {
    let state = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(2, 2)).state;

    state = act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;

    expect(position(state, 'ann')).toBe(7);
    expect(state.turn).toMatchObject({ playerId: 'ann', step: 'awaitEndTurn' });
  });

  it('give no extra roll when doublesRollAgain is off', () => {
    const rules = { ...defaultRules, doublesRollAgain: false };

    const { state, events } = act(started(rules), { type: 'ROLL_DICE', playerId: 'ann' }, dice(2, 2), rules);

    expect(state.turn?.step).toBe('awaitEndTurn');
    expect(events.some((e) => e.type === 'ROLL_AGAIN')).toBe(false);
  });

  it('send the Player straight to Jail without moving on the third in a row', () => {
    let state = rollResolved(started(), 'ann', dice(1, 1)).state;
    state = rollResolved(state, 'ann', dice(2, 2)).state;
    expect(position(state, 'ann')).toBe(6);

    const { state: next, events } = act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 3));

    expect(position(next, 'ann')).toBe(10);
    expect(player(next, 'ann').inJail).toBe(true);
    expect(next.turn).toMatchObject({ playerId: 'ann', step: 'awaitEndTurn' });
    expect(events).toEqual([
      { type: 'DICE_ROLLED', playerId: 'ann', dice: [3, 3], total: 6 },
      { type: 'JAILED', playerId: 'ann', reason: 'doubles' },
    ]);
  });

  it('reads the streak length from doublesToJail', () => {
    const rules = { ...defaultRules, doublesToJail: 1 };

    const { state } = act(started(rules), { type: 'ROLL_DICE', playerId: 'ann' }, dice(2, 2), rules);

    expect(player(state, 'ann').inJail).toBe(true);
    expect(position(state, 'ann')).toBe(10);
  });

  it('never send the Player to Jail when doublesToJail is 0', () => {
    const rules = { ...defaultRules, doublesToJail: 0 };
    let state = started(rules);
    for (const [d1, d2] of [[1, 1], [2, 2], [3, 3], [1, 1]] as const) {
      state = rollResolved(state, 'ann', dice(d1, d2), rules).state;
    }

    expect(player(state, 'ann').inJail).toBe(false);
    expect(position(state, 'ann')).toBe(14);
    expect(state.turn).toMatchObject({ playerId: 'ann', step: 'awaitRoll' });
  });

  it('start a new streak on each turn', () => {
    let state = rollResolved(started(), 'ann', dice(1, 1)).state;
    state = rollResolved(state, 'ann', dice(2, 2)).state;
    state = rollResolved(state, 'ann', dice(1, 2)).state;
    state = act(state, { type: 'END_TURN', playerId: 'ann' }).state;
    state = playTurn(state, 'bob', dice(1, 2));

    const { state: next } = rollResolved(state, 'ann', dice(1, 1));

    expect(player(next, 'ann').inJail).toBe(false);
    expect(next.turn?.step).toBe('awaitRoll');
  });

  describe('with 3 dice', () => {
    const rules = { ...defaultRules, diceCount: 3 };

    it('need all three faces to match', () => {
      const { state } = rollResolved(started(rules), 'ann', dice(2, 2, 3), rules);

      expect(state.turn?.step).toBe('awaitEndTurn');
    });

    it('count when all three match', () => {
      const { state } = rollResolved(started(rules), 'ann', dice(2, 2, 2), rules);

      expect(state.turn?.step).toBe('awaitRoll');
    });
  });

  it('never happen with 1 die', () => {
    const rules = { ...defaultRules, diceCount: 1, doublesToJail: 1 };

    const { state } = act(started(rules), { type: 'ROLL_DICE', playerId: 'ann' }, dice(4), rules);

    expect(player(state, 'ann').inJail).toBe(false);
    expect(state.turn?.step).toBe('awaitEndTurn');
  });
});

describe('Jail', () => {
  /** ann is sent to Jail by the Go To Jail space; after bob's turn it is ann's turn again. */
  function jailed(rules: Rules = defaultRules): GameState {
    // Not Doubles for any dice count: all 1s but the last die, which shows 2.
    const faces = Array.from({ length: rules.diceCount }, (_, i) => (i === rules.diceCount - 1 ? 2 : 1));
    const total = faces.reduce((a, b) => a + b, 0);
    let state = withPlayer(started(rules), 'ann', { position: 30 - total });
    state = act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(...faces), rules).state;
    state = act(state, { type: 'END_TURN', playerId: 'ann' }, noDice, rules).state;
    state = rollResolved(state, 'bob', dice(...faces), rules).state;
    return act(state, { type: 'END_TURN', playerId: 'bob' }, noDice, rules).state;
  }

  /** ann fails `count` rolls in Jail, with bob taking a turn after each. */
  function failRolls(state: GameState, count: number): GameState {
    for (let i = 0; i < count; i++) {
      state = act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;
      state = act(state, { type: 'END_TURN', playerId: 'ann' }).state;
      state = playTurn(state, 'bob', dice(1, 2));
    }
    return state;
  }

  it('is entered from the Go To Jail space, with no GO salary, and the turn ends', () => {
    const game = withPlayer(started(), 'ann', { position: 25 });

    const { state, events } = act(game, { type: 'ROLL_DICE', playerId: 'ann' }, dice(2, 3));

    expect(position(state, 'ann')).toBe(10);
    expect(player(state, 'ann').inJail).toBe(true);
    expect(player(state, 'ann').cash).toBe(1500);
    expect(state.turn?.step).toBe('awaitEndTurn');
    expect(events).toEqual([
      { type: 'DICE_ROLLED', playerId: 'ann', dice: [2, 3], total: 5 },
      { type: 'MOVED', playerId: 'ann', from: 25, to: 30 },
      { type: 'JAILED', playerId: 'ann', reason: 'goToJail' },
    ]);
  });

  it('ends the turn even when the Player rolled Doubles onto Go To Jail', () => {
    const game = withPlayer(started(), 'ann', { position: 26 });

    const { state } = act(game, { type: 'ROLL_DICE', playerId: 'ann' }, dice(2, 2));

    expect(player(state, 'ann').inJail).toBe(true);
    expect(state.turn?.step).toBe('awaitEndTurn');
  });

  it('keeps the Player in Jail after a failed roll', () => {
    const { state, events } = act(jailed(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2));

    expect(position(state, 'ann')).toBe(10);
    expect(player(state, 'ann').inJail).toBe(true);
    expect(player(state, 'ann').cash).toBe(1500);
    expect(state.turn?.step).toBe('awaitEndTurn');
    expect(events).toEqual([
      { type: 'DICE_ROLLED', playerId: 'ann', dice: [1, 2], total: 3 },
      { type: 'STILL_IN_JAIL', playerId: 'ann', failedRolls: 1 },
    ]);
  });

  describe('paying the fine', () => {
    it('releases the Player before rolling, who then rolls and moves as usual', () => {
      const { state, events } = act(jailed(), { type: 'PAY_JAIL_FINE', playerId: 'ann' });

      expect(player(state, 'ann').cash).toBe(1400);
      expect(player(state, 'ann').inJail).toBe(false);
      expect(state.turn).toMatchObject({ playerId: 'ann', step: 'awaitRoll' });
      expect(events).toEqual([
        { type: 'JAIL_FINE_PAID', playerId: 'ann', amount: 100, forced: false },
        { type: 'LEFT_JAIL', playerId: 'ann' },
      ]);

      const { state: moved } = act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 4));
      expect(position(moved, 'ann')).toBe(17);
    });

    it('then lets Doubles give an extra roll as usual', () => {
      const paid = act(jailed(), { type: 'PAY_JAIL_FINE', playerId: 'ann' }).state;

      // 10 + 10 lands on Free Parking
      const { state } = act(paid, { type: 'ROLL_DICE', playerId: 'ann' }, dice(5, 5));

      expect(state.turn?.step).toBe('awaitRoll');
    });

    it('reads the fine from the Rules', () => {
      const rules = { ...defaultRules, jailFine: 30 };

      const { state } = act(jailed(rules), { type: 'PAY_JAIL_FINE', playerId: 'ann' }, noDice, rules);

      expect(player(state, 'ann').cash).toBe(1470);
    });

    it('feeds the Jackpot', () => {
      const rules: Rules = { ...defaultRules, freeParkingMode: 'jackpot' };

      const { state } = act(jailed(rules), { type: 'PAY_JAIL_FINE', playerId: 'ann' }, noDice, rules);

      expect(state.bank.jackpot).toBe(100);
    });

    it('is refused when the Player is not in Jail', () => {
      expect(() => act(started(), { type: 'PAY_JAIL_FINE', playerId: 'ann' })).toThrow(IllegalActionError);
    });

    it('is refused after the Player has rolled', () => {
      const rolled = act(jailed(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;

      expect(() => act(rolled, { type: 'PAY_JAIL_FINE', playerId: 'ann' })).toThrow(IllegalActionError);
    });

    it('is refused out of turn', () => {
      const game = withPlayer(jailed(), 'bob', { inJail: true });

      expect(() => act(game, { type: 'PAY_JAIL_FINE', playerId: 'bob' })).toThrow(IllegalActionError);
    });

    it('is refused when the Player cannot afford it', () => {
      const game = withPlayer(jailed(), 'ann', { cash: 99 });

      expect(() => act(game, { type: 'PAY_JAIL_FINE', playerId: 'ann' })).toThrow(IllegalActionError);
    });
  });

  describe('rolling Doubles', () => {
    it('releases the Player, who moves by that roll with no extra roll', () => {
      // 10 + 10 lands on Free Parking
      const { state, events } = act(jailed(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(5, 5));

      expect(player(state, 'ann').inJail).toBe(false);
      expect(player(state, 'ann').cash).toBe(1500);
      expect(position(state, 'ann')).toBe(20);
      expect(state.turn?.step).toBe('awaitEndTurn');
      expect(events).toEqual([
        { type: 'DICE_ROLLED', playerId: 'ann', dice: [5, 5], total: 10 },
        { type: 'LEFT_JAIL', playerId: 'ann' },
        { type: 'MOVED', playerId: 'ann', from: 10, to: 20 },
      ]);
    });

    it('gives no extra roll after a buy decision either', () => {
      // 10 + 6 lands on Orange 1
      const landed = act(jailed(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 3)).state;

      const { state } = act(landed, { type: 'BUY_PROPERTY', playerId: 'ann' });

      expect(state.turn?.step).toBe('awaitEndTurn');
    });

    it('needs all three faces to match with 3 dice', () => {
      const rules = { ...defaultRules, diceCount: 3 };

      const { state } = act(jailed(rules), { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 3, 4), rules);

      expect(player(state, 'ann').inJail).toBe(true);
    });

    it('is impossible with 1 die', () => {
      const rules = { ...defaultRules, diceCount: 1 };

      const { state } = act(jailed(rules), { type: 'ROLL_DICE', playerId: 'ann' }, dice(4), rules);

      expect(player(state, 'ann').inJail).toBe(true);
      expect(position(state, 'ann')).toBe(10);
    });
  });

  describe('after the last allowed failed roll', () => {
    it('forces the fine and moves the Player by that roll', () => {
      const game = failRolls(jailed(), 2);

      const { state, events } = act(game, { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 4));

      expect(player(state, 'ann').inJail).toBe(false);
      expect(player(state, 'ann').cash).toBe(1400);
      expect(position(state, 'ann')).toBe(17);
      expect(state.turn?.step).toBe('awaitEndTurn');
      expect(events).toEqual([
        { type: 'DICE_ROLLED', playerId: 'ann', dice: [3, 4], total: 7 },
        { type: 'JAIL_FINE_PAID', playerId: 'ann', amount: 100, forced: true },
        { type: 'LEFT_JAIL', playerId: 'ann' },
        { type: 'MOVED', playerId: 'ann', from: 10, to: 17 },
      ]);
    });

    it('reads the number of allowed rolls from maxJailTurns', () => {
      const rules = { ...defaultRules, maxJailTurns: 1 };

      const { state } = act(jailed(rules), { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 4), rules);

      expect(player(state, 'ann').inJail).toBe(false);
      expect(position(state, 'ann')).toBe(17);
    });

    it('lets cash go negative when the Player cannot afford the forced fine', () => {
      const game = withPlayer(failRolls(jailed(), 2), 'ann', { cash: 40 });

      const { state } = act(game, { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 4));

      expect(player(state, 'ann').cash).toBe(-60);
    });
  });

  it('starts the failed-roll count afresh on the next stay in Jail', () => {
    // ann fails twice, pays out, then goes back to Jail from 25
    let state = failRolls(jailed(), 2);
    state = act(state, { type: 'PAY_JAIL_FINE', playerId: 'ann' }).state;
    state = withPlayer(state, 'ann', { position: 25 });
    state = act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(2, 3)).state;
    state = act(state, { type: 'END_TURN', playerId: 'ann' }).state;
    state = playTurn(state, 'bob', dice(1, 2));

    const { state: next } = act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2));

    expect(player(next, 'ann').inJail).toBe(true);
    expect(player(next, 'ann').cash).toBe(1400);
  });
});

describe('building', () => {
  /** ann (to move) owns the brown group (1, 3; house cost 50). */
  function browns(rules: Rules = defaultRules, patch: Partial<Deed> = {}): GameState {
    return owning(started(rules), 'ann', [1, 3], patch);
  }

  function build(state: GameState, index: number, rules: Rules = defaultRules, playerId = 'ann') {
    return act(state, { type: 'BUILD', playerId, index }, noDice, rules);
  }

  it('builds a house on a street in a full Colour group for its house cost', () => {
    const { state, events } = build(browns(), 1);

    expect(state.deeds[1]?.buildings).toBe(1);
    expect(player(state, 'ann').cash).toBe(1450);
    expect(state.turn?.step).toBe('awaitRoll');
    expect(events).toEqual([{ type: 'BUILDING_BUILT', playerId: 'ann', index: 1, buildings: 1, cost: 50 }]);
  });

  it('reads the house cost from the Board', () => {
    const game = browns();
    const board = game.board.map((s) => (s.index === 1 ? { ...s, houseCost: 70 } : s));

    const { state } = build({ ...game, board }, 1);

    expect(player(state, 'ann').cash).toBe(1430);
  });

  it('is refused without the whole Colour group', () => {
    expect(() => build(owning(started(), 'ann', [1]), 1)).toThrow(IllegalActionError);
    expect(() => build(owning(owning(started(), 'ann', [1]), 'bob', [3]), 1)).toThrow(IllegalActionError);
  });

  it('is refused while any street in the group is mortgaged', () => {
    const game = owning(browns(), 'ann', [3], { mortgaged: true });

    expect(() => build(game, 1)).toThrow(IllegalActionError);
  });

  it('is refused on a station or utility', () => {
    const game = owning(started(), 'ann', [5, 15, 25, 35, 12, 28]);

    expect(() => build(game, 5)).toThrow(IllegalActionError);
    expect(() => build(game, 12)).toThrow(IllegalActionError);
  });

  it("is refused on another Player's street", () => {
    expect(() => build(owning(started(), 'bob', [1, 3]), 1)).toThrow(IllegalActionError);
  });

  it('is refused where there is no Deed or off the Board', () => {
    expect(() => build(browns(), 6)).toThrow(IllegalActionError);
    expect(() => build(browns(), 40)).toThrow(IllegalActionError);
  });

  it('is refused when the Player cannot afford the house cost', () => {
    const game = withPlayer(browns(), 'ann', { cash: 49 });

    expect(() => build(game, 1)).toThrow(IllegalActionError);
  });

  it('is allowed after the landing is resolved', () => {
    // 0 + 7 lands on Chance
    const rolled = act(browns(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 4)).state;

    const { state } = build(rolled, 1);

    expect(state.deeds[1]?.buildings).toBe(1);
    expect(state.turn?.step).toBe('awaitEndTurn');
  });

  it('is allowed in Jail', () => {
    const game = withPlayer(browns(), 'ann', { inJail: true, position: 10 });

    expect(build(game, 1).state.deeds[1]?.buildings).toBe(1);
  });

  it('is refused while a buy decision or Auction is open', () => {
    // 0 + 6 lands on unowned Light Blue 1
    const offered = act(browns(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(2, 4)).state;
    const auction = act(offered, { type: 'DECLINE_PROPERTY', playerId: 'ann' }).state;

    expect(() => build(offered, 1)).toThrow(IllegalActionError);
    expect(() => build(auction, 1)).toThrow(IllegalActionError);
  });

  it('is refused out of turn', () => {
    const game = owning(started(), 'bob', [1, 3]);

    expect(() => build(game, 1, defaultRules, 'bob')).toThrow(IllegalActionError);
  });

  /** Builds on each index in order, as ann. */
  function buildAll(state: GameState, indexes: number[], rules: Rules = defaultRules): GameState {
    return indexes.reduce((s, index) => build(s, index, rules).state, state);
  }

  it('builds a hotel after housesPerHotel houses, for the house cost', () => {
    const game = buildAll(browns(), [1, 3, 1, 3, 1, 3, 1, 3]);

    const { state, events } = build(game, 1);

    expect(state.deeds[1]?.buildings).toBe(HOTEL);
    expect(events).toEqual([{ type: 'BUILDING_BUILT', playerId: 'ann', index: 1, buildings: HOTEL, cost: 50 }]);
  });

  it('reads housesPerHotel from the Rules', () => {
    const rules = { ...defaultRules, housesPerHotel: 1 };

    const { state } = build(buildAll(browns(rules), [1, 3], rules), 1, rules);

    expect(state.deeds[1]?.buildings).toBe(HOTEL);
  });

  it('is refused on a street that already has a hotel', () => {
    const game = browns(defaultRules, { buildings: HOTEL });

    expect(() => build(game, 1)).toThrow(IllegalActionError);
  });

  describe('after housesPerHotel is lowered', () => {
    const rules = { ...defaultRules, housesPerHotel: 2 };

    it('keeps existing houses and makes the next build a hotel', () => {
      const game = browns(rules, { buildings: 4 });

      const { state } = build(game, 1, rules);

      expect(state.deeds[1]?.buildings).toBe(HOTEL);
      expect(state.deeds[3]?.buildings).toBe(4);
    });

    it('keeps charging the rent for the houses still standing', () => {
      // bob owns the browns with 4 houses each; ann lands on Brown 2
      const game = owning(started(rules), 'bob', [1, 3], { buildings: 4 });

      const { state } = act(game, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2), rules);

      expect(player(state, 'ann').cash).toBe(1500 - 320);
    });
  });

  describe('evenly', () => {
    it('refuses a house that would put a street two levels above another in its group', () => {
      const game = build(browns(), 1).state;

      expect(() => build(game, 1)).toThrow(IllegalActionError);
    });

    it('allows building up the lower street', () => {
      const game = build(browns(), 1).state;

      expect(build(game, 3).state.deeds[3]?.buildings).toBe(1);
    });

    it('refuses a hotel until every street in the group has housesPerHotel houses', () => {
      const game = buildAll(browns(), [1, 3, 1, 3, 1, 3, 1]);

      expect(() => build(game, 1)).toThrow(IllegalActionError);
    });

    it('counts houses above a lowered housesPerHotel as the house limit', () => {
      const rules = { ...defaultRules, housesPerHotel: 2 };
      const game = owning(browns(rules, { buildings: 2 }), 'ann', [1], { buildings: 4 });

      expect(build(game, 3, rules).state.deeds[3]?.buildings).toBe(HOTEL);
      expect(build(game, 1, rules).state.deeds[1]?.buildings).toBe(HOTEL);
    });

    it('is not enforced when evenBuildRule is off', () => {
      const rules = { ...defaultRules, evenBuildRule: false };

      const { state } = build(buildAll(browns(rules), [1, 1, 1, 1], rules), 1, rules);

      expect(state.deeds[1]?.buildings).toBe(HOTEL);
      expect(state.deeds[3]?.buildings).toBe(0);
    });
  });

  describe('with limited bank buildings', () => {
    it("stops building houses when the bank has none left, counting every Player's houses", () => {
      const rules = { ...defaultRules, bankHouses: 3 };
      const game = owning(browns(rules), 'bob', [39], { buildings: 1 });

      const built = buildAll(game, [1, 3], rules);

      expect(() => build(built, 1, rules)).toThrow(IllegalActionError);
    });

    it('stops building hotels when the bank has none left', () => {
      const rules = { ...defaultRules, bankHotels: 1 };
      const game = owning(browns(rules, { buildings: 4 }), 'ann', [1], { buildings: HOTEL });

      expect(() => build(game, 3, rules)).toThrow(IllegalActionError);
    });

    it('gets back the houses a hotel replaces', () => {
      const rules = { ...defaultRules, bankHouses: 8 };
      const game = owning(browns(rules, { buildings: 4 }), 'ann', [6, 8, 9]);
      expect(() => build(game, 6, rules)).toThrow(IllegalActionError);

      const hotel = build(game, 1, rules).state;

      expect(build(hotel, 6, rules).state.deeds[6]?.buildings).toBe(1);
    });
  });
});

describe('rent with buildings', () => {
  /** ann rolls onto Brown 2 (3; rents 4/20/60/180/320/450) where bob owns the browns with `buildings` on it. */
  function landOnBrown2(buildings: number, rules: Rules = defaultRules) {
    const game = owning(owning(started(rules), 'bob', [1]), 'bob', [3], { buildings });
    return act(game, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2), rules).state;
  }

  it.each([
    [1, 20],
    [2, 60],
    [3, 180],
    [4, 320],
  ])('charges the rent-table value for %i houses', (houses, rent) => {
    expect(player(landOnBrown2(houses), 'ann').cash).toBe(1500 - rent);
  });

  it('charges the last rent-table value for a hotel, whatever housesPerHotel is', () => {
    const rules = { ...defaultRules, housesPerHotel: 2 };

    expect(player(landOnBrown2(HOTEL, rules), 'ann').cash).toBe(1500 - 450);
  });
});

describe('selling buildings', () => {
  /** ann (to move) owns the brown group (1, 3; house cost 50) with `buildings` on each street. */
  function browns(buildings: number, rules: Rules = defaultRules): GameState {
    return owning(started(rules), 'ann', [1, 3], { buildings });
  }

  function sell(state: GameState, index: number, rules: Rules = defaultRules, playerId = 'ann') {
    return act(state, { type: 'SELL_BUILDING', playerId, index }, noDice, rules);
  }

  it('sells a house back to the bank at buildingSellbackRate of the house cost', () => {
    const { state, events } = sell(browns(2), 1);

    expect(state.deeds[1]?.buildings).toBe(1);
    expect(player(state, 'ann').cash).toBe(1525);
    expect(events).toEqual([{ type: 'BUILDING_SOLD', playerId: 'ann', index: 1, buildings: 1, amount: 25 }]);
  });

  it('reads the sell-back rate from the Rules, rounding down', () => {
    const rules = { ...defaultRules, buildingSellbackRate: 0.33 };

    const { state } = sell(browns(1, rules), 1, rules);

    expect(player(state, 'ann').cash).toBe(1516);
  });

  it('takes a hotel back down to housesPerHotel houses', () => {
    const { state, events } = sell(browns(HOTEL), 1);

    expect(state.deeds[1]?.buildings).toBe(4);
    expect(events).toEqual([{ type: 'BUILDING_SOLD', playerId: 'ann', index: 1, buildings: 4, amount: 25 }]);
  });

  it('takes a hotel down to a lowered housesPerHotel', () => {
    const rules = { ...defaultRules, housesPerHotel: 2 };

    const { state } = sell(browns(HOTEL, rules), 1, rules);

    expect(state.deeds[1]?.buildings).toBe(2);
  });

  it('is refused on a street with no buildings', () => {
    expect(() => sell(browns(0), 1)).toThrow(IllegalActionError);
  });

  it("is refused on another Player's street", () => {
    expect(() => sell(owning(started(), 'bob', [1, 3], { buildings: 1 }), 1)).toThrow(IllegalActionError);
  });

  it('is refused where there is no Deed or off the Board', () => {
    expect(() => sell(browns(1), 6)).toThrow(IllegalActionError);
    expect(() => sell(browns(1), 40)).toThrow(IllegalActionError);
  });

  it('is allowed after the landing is resolved', () => {
    // 0 + 7 lands on Chance
    const rolled = act(browns(1), { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 4)).state;

    expect(sell(rolled, 1).state.deeds[1]?.buildings).toBe(0);
  });

  it('is refused while a buy decision is open', () => {
    // 0 + 6 lands on unowned Light Blue 1
    const offered = act(browns(1), { type: 'ROLL_DICE', playerId: 'ann' }, dice(2, 4)).state;

    expect(() => sell(offered, 1)).toThrow(IllegalActionError);
  });

  it('is refused out of turn', () => {
    const game = owning(started(), 'bob', [1, 3], { buildings: 1 });

    expect(() => sell(game, 1, defaultRules, 'bob')).toThrow(IllegalActionError);
  });

  describe('evenly', () => {
    it('refuses selling from a street below another in its group', () => {
      const game = owning(browns(2), 'ann', [3], { buildings: 1 });

      expect(() => sell(game, 3)).toThrow(IllegalActionError);
      expect(sell(game, 1).state.deeds[1]?.buildings).toBe(1);
    });

    it('refuses selling houses while another street in the group has a hotel', () => {
      const game = owning(browns(4), 'ann', [1], { buildings: HOTEL });

      expect(() => sell(game, 3)).toThrow(IllegalActionError);
    });

    it('is not enforced when evenBuildRule is off', () => {
      const rules = { ...defaultRules, evenBuildRule: false };
      const game = owning(browns(4, rules), 'ann', [1], { buildings: HOTEL });

      expect(sell(game, 3, rules).state.deeds[3]?.buildings).toBe(3);
    });
  });
});

/** Sets the List price of the space at `index`. */
function priced(state: GameState, index: number, price: number): GameState {
  return { ...state, board: state.board.map((s) => (s.index === index ? { ...s, price } : s)) };
}

describe('mortgaging', () => {
  function mortgage(state: GameState, index: number, rules: Rules = defaultRules, playerId = 'ann') {
    return act(state, { type: 'MORTGAGE', playerId, index }, noDice, rules);
  }

  it('pays the owner mortgageRate of the List price', () => {
    const { state, events } = mortgage(owning(started(), 'ann', [1]), 1);

    expect(state.deeds[1]).toEqual({ ownerId: 'ann', buildings: 0, mortgaged: true });
    expect(player(state, 'ann').cash).toBe(1530);
    expect(state.turn?.step).toBe('awaitRoll');
    expect(events).toEqual([{ type: 'PROPERTY_MORTGAGED', playerId: 'ann', index: 1, amount: 30 }]);
  });

  it('reads the mortgage rate from the Rules, rounding down', () => {
    const rules = { ...defaultRules, mortgageRate: 0.33 };

    const { state } = mortgage(owning(started(rules), 'ann', [1]), 1, rules);

    expect(player(state, 'ann').cash).toBe(1519);
  });

  it('follows the current List price after it was edited', () => {
    const game = priced(owning(started(), 'ann', [1]), 1, 90);

    expect(player(mortgage(game, 1).state, 'ann').cash).toBe(1545);
  });

  it('mortgages stations and utilities', () => {
    const game = owning(started(), 'ann', [5, 12]);

    const once = mortgage(game, 5).state;
    const { state } = mortgage(once, 12);

    expect(player(state, 'ann').cash).toBe(1500 + 100 + 75);
  });

  it('is refused while any street in the Colour group has buildings', () => {
    const game = owning(owning(started(), 'ann', [1]), 'ann', [3], { buildings: 1 });

    expect(() => mortgage(game, 1)).toThrow(IllegalActionError);
    expect(() => mortgage(game, 3)).toThrow(IllegalActionError);
  });

  it('is refused on a property that is already mortgaged', () => {
    const game = owning(started(), 'ann', [1], { mortgaged: true });

    expect(() => mortgage(game, 1)).toThrow(IllegalActionError);
  });

  it("is refused on another Player's property, an unowned one, or off the Board", () => {
    const game = owning(started(), 'bob', [1]);

    expect(() => mortgage(game, 1)).toThrow(IllegalActionError);
    expect(() => mortgage(game, 3)).toThrow(IllegalActionError);
    expect(() => mortgage(game, 40)).toThrow(IllegalActionError);
  });

  it('is allowed after the landing is resolved', () => {
    // 0 + 7 lands on Chance
    const rolled = act(owning(started(), 'ann', [1]), { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 4)).state;

    const { state } = mortgage(rolled, 1);

    expect(state.deeds[1]?.mortgaged).toBe(true);
    expect(state.turn?.step).toBe('awaitEndTurn');
  });

  it('is refused while a buy decision is open', () => {
    // 0 + 6 lands on unowned Light Blue 1
    const offered = act(owning(started(), 'ann', [1]), { type: 'ROLL_DICE', playerId: 'ann' }, dice(2, 4)).state;

    expect(() => mortgage(offered, 1)).toThrow(IllegalActionError);
  });

  it('is refused out of turn', () => {
    expect(() => mortgage(owning(started(), 'bob', [1]), 1, defaultRules, 'bob')).toThrow(IllegalActionError);
  });

  it('stops the property charging rent', () => {
    // ann mortgages Brown 2 and plays out the turn; bob rolls 0 + 3 onto it
    let game = mortgage(owning(started(), 'ann', [3]), 3).state;
    game = playTurn(game, 'ann', dice(3, 4));

    const { state } = act(game, { type: 'ROLL_DICE', playerId: 'bob' }, dice(1, 2));

    expect(player(state, 'bob').cash).toBe(1500);
  });
});

describe('unmortgaging', () => {
  function unmortgage(state: GameState, index: number, rules: Rules = defaultRules, playerId = 'ann') {
    return act(state, { type: 'UNMORTGAGE', playerId, index }, noDice, rules);
  }

  function mortgaged(rules: Rules = defaultRules): GameState {
    return owning(started(rules), 'ann', [1], { mortgaged: true });
  }

  it('charges the mortgage value plus unmortgageInterest', () => {
    const { state, events } = unmortgage(mortgaged(), 1);

    expect(state.deeds[1]).toEqual({ ownerId: 'ann', buildings: 0, mortgaged: false });
    expect(player(state, 'ann').cash).toBe(1500 - 33);
    expect(events).toEqual([{ type: 'PROPERTY_UNMORTGAGED', playerId: 'ann', index: 1, cost: 33 }]);
  });

  it('rounds the interest up', () => {
    // List price 70: mortgage value 35, interest 3.5
    expect(player(unmortgage(priced(mortgaged(), 1, 70), 1).state, 'ann').cash).toBe(1500 - 39);
  });

  it('reads the interest from the Rules', () => {
    const rules = { ...defaultRules, unmortgageInterest: 0.5 };

    expect(player(unmortgage(mortgaged(rules), 1, rules).state, 'ann').cash).toBe(1500 - 45);
  });

  it('does not feed the Jackpot', () => {
    const rules = { ...defaultRules, freeParkingMode: 'jackpot' as const };

    expect(unmortgage(mortgaged(rules), 1, rules).state.bank.jackpot).toBe(0);
  });

  it('is refused on a property that is not mortgaged', () => {
    expect(() => unmortgage(owning(started(), 'ann', [1]), 1)).toThrow(IllegalActionError);
  });

  it("is refused on another Player's property", () => {
    expect(() => unmortgage(owning(started(), 'bob', [1], { mortgaged: true }), 1)).toThrow(IllegalActionError);
  });

  it('is refused when the Player cannot afford it', () => {
    const game = withPlayer(mortgaged(), 'ann', { cash: 32 });

    expect(() => unmortgage(game, 1)).toThrow(IllegalActionError);
  });

  it('is refused out of turn', () => {
    expect(() => unmortgage(owning(started(), 'bob', [1], { mortgaged: true }), 1, defaultRules, 'bob')).toThrow(
      IllegalActionError,
    );
  });

  it('lets the owner build on the Colour group again', () => {
    const game = owning(mortgaged(), 'ann', [3]);

    const lifted = unmortgage(game, 1).state;

    expect(act(lifted, { type: 'BUILD', playerId: 'ann', index: 1 }).state.deeds[1]?.buildings).toBe(1);
  });
});
