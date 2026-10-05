import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  defaultBoard,
  defaultRules,
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
    state = applyAction(state, { type: 'JOIN_ROOM', playerId: name, name, color: `${name}-colour` }, rules, noDice)
      .state;
  }
  return state;
}

function act(state: GameState, action: Action, rng: Rng = noDice, rules: Rules = defaultRules) {
  return applyAction(state, action, rules, rng);
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

/** Rolls, declines any property offered, and ends the turn. */
function playTurn(state: GameState, playerId: string, rng: Rng): GameState {
  let next = act(state, { type: 'ROLL_DICE', playerId }, rng).state;
  if (next.turn?.step === 'awaitBuyDecision') next = act(next, { type: 'DECLINE_PROPERTY', playerId }).state;
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
    // ann: 0 → 12 → 24 → 36, bob rolls in between
    for (let i = 0; i < 3; i++) {
      state = playTurn(state, 'ann', dice(6, 6));
      state = playTurn(state, 'bob', dice(1, 2));
    }
    expect(position(state, 'ann')).toBe(36);

    const { state: next, events } = act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(5, 3));

    expect(position(next, 'ann')).toBe(4);
    expect(events).toContainEqual({ type: 'MOVED', playerId: 'ann', from: 36, to: 4 });
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

  it('ends the decision without a Deed when the Player declines', () => {
    const landed = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;

    const { state, events } = act(landed, { type: 'DECLINE_PROPERTY', playerId: 'ann' });

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
