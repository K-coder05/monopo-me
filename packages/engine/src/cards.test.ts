import { describe, expect, it } from 'vitest';
import {
  applyAction,
  buildDeck,
  createGame,
  defaultBoard,
  defaultCards,
  defaultDecks,
  defaultRules,
  HOTEL,
  IllegalActionError,
  type Action,
  type Card,
  type Debt,
  type Deed,
  type Effect,
  type GameEvent,
  type GameState,
  type Player,
  type Rng,
  type Rules,
} from './index';

/** An Rng that returns the given values in order (die faces for rolls, indexes for picks). */
function script(...values: number[]): Rng {
  const queue = [...values];
  return {
    int(maxExclusive) {
      const value = queue.shift();
      if (value === undefined) throw new Error('scripted rng ran out');
      if (value < 0 || value >= maxExclusive) throw new Error(`${value} out of range for ${maxExclusive}`);
      return value;
    },
  };
}

/** Rolls the given die faces (1-based). */
function dice(...faces: number[]): Rng {
  return script(...faces.map((f) => f - 1));
}

const noRng: Rng = script();

function act(state: GameState, action: Action, rng: Rng = noRng, rules: Rules = defaultRules) {
  return applyAction(state, action, rules, rng, 0);
}

let cardNumber = 0;
function card(effects: Effect[], extra: Partial<Card> = {}): Card {
  cardNumber++;
  return {
    id: `c-${cardNumber}`,
    deck: 'chance',
    title: `Card ${cardNumber}`,
    text: 'Some text',
    effects,
    keepable: false,
    enabled: true,
    copies: 1,
    ...extra,
  };
}

const NAMES = ['ann', 'bob', 'cat'];

/** ann, bob and cat in that turn order, ann to roll, with Chance holding `cards` (top first) and Treasure empty. */
function table(cards: Card[], rules: Rules = defaultRules, names = NAMES): GameState {
  const decks = {
    chance: { cards, drawPile: cards.flatMap((c) => Array<string>(c.copies).fill(c.id)) },
    treasure: { cards: [] as Card[], drawPile: [] as string[] },
  };
  let state = createGame('ABCDE', { id: names[0]!, name: names[0]!, color: 'c0' }, rules, defaultBoard, decks);
  for (const [i, name] of names.slice(1).entries()) {
    state = act(state, { type: 'JOIN_ROOM', playerId: name, name, color: `c${i + 1}` }, noRng, rules).state;
  }
  // Roll-off: descending totals so the order is the join order; the Decks are then re-laid as given.
  const rolls = names.flatMap((_, i) => [6 - i, 6 - i]);
  const started = act(state, { type: 'START_GAME', playerId: 'ann' }, scriptWithZeros(rolls.map((f) => f - 1)), rules).state;
  return { ...started, decks };
}

/** Scripted values, then zeros once they run out (for the deck shuffle that follows the roll-off). */
function scriptWithZeros(values: number[]): Rng {
  const queue = [...values];
  return { int: () => queue.shift() ?? 0 };
}

function withPlayer(state: GameState, id: string, patch: Partial<Player>): GameState {
  return { ...state, players: state.players.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

function owning(state: GameState, ownerId: string, indexes: number[], patch: Partial<Deed> = {}): GameState {
  const deeds = { ...state.deeds };
  for (const index of indexes) deeds[index] = { ownerId, buildings: 0, mortgaged: false, ...patch };
  return { ...state, deeds };
}

function player(state: GameState, id: string): Player {
  return state.players.find((p) => p.id === id)!;
}

/** ann starts at 4 and rolls 3 to land on the Chance space at 7, drawing the top card. */
function drawn(cards: Card[], prepare: (s: GameState) => GameState = (s) => s, rules: Rules = defaultRules) {
  const ready = prepare(withPlayer(table(cards, rules), 'ann', { position: 4 }));
  return act(ready, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2), rules);
}

function continued(
  state: GameState,
  opts: { by?: string; choiceId?: string; rng?: Rng; rules?: Rules } = {},
) {
  return act(state, { type: 'CONTINUE_CARD', playerId: opts.by ?? 'ann', choiceId: opts.choiceId }, opts.rng, opts.rules);
}

/** Draws the card, then continues it as the drawer. */
function resolved(
  cards: Card[],
  prepare?: (s: GameState) => GameState,
  opts: { choiceId?: string; rng?: Rng; rules?: Rules } = {},
) {
  const reveal = drawn(cards, prepare, opts.rules);
  const result = continued(reveal.state, opts);
  return { ...result, events: [...reveal.events, ...result.events] };
}

const types = (events: GameEvent[]) => events.map((e) => e.type);

/** Ends `playerId`'s turn as if they had already rolled and resolved it. */
function endTurn(state: GameState, playerId: string) {
  return act({ ...state, turn: { ...state.turn!, step: 'awaitEndTurn' } }, { type: 'END_TURN', playerId });
}

describe('drawing a card', () => {
  it('reveals the top card and sends it to the bottom of its Deck', () => {
    const [first, second] = [card([{ type: 'MANUAL' }], { title: 'First' }), card([{ type: 'MANUAL' }])];

    const { state, events } = drawn([first, second]);

    expect(state.turn).toMatchObject({ step: 'awaitCard' });
    expect(state.turn?.cards.map((c) => c.cardId)).toEqual([first.id]);
    expect(state.decks.chance.drawPile).toEqual([second.id, first.id]);
    expect(events).toContainEqual({
      type: 'CARD_DRAWN',
      playerId: 'ann',
      deck: 'chance',
      cardId: first.id,
      title: 'First',
      text: 'Some text',
    });
  });

  it('does nothing and logs it when the Deck is empty', () => {
    const { state, events } = drawn([]);

    expect(events).toContainEqual({ type: 'DECK_EMPTY', playerId: 'ann', deck: 'chance' });
    expect(state.turn?.step).toBe('awaitEndTurn');
  });

  it('skips disabled cards when building a Deck and counts each copy', () => {
    const deck = buildDeck([card([], { copies: 2 }), card([], { enabled: false }), card([])]);

    expect(deck.drawPile).toHaveLength(3);
  });

  it('lets only the drawer continue an ordinary card', () => {
    const { state } = drawn([card([{ type: 'TRANSFER', amount: 10, from: 'bank', to: 'drawer' }])]);

    expect(() => continued(state, { by: 'bob' })).toThrow(IllegalActionError);
    expect(() => act(state, { type: 'END_TURN', playerId: 'ann' })).toThrow(IllegalActionError);
    expect(player(continued(state).state, 'ann').cash).toBe(1510);
  });

  it('has nothing to continue before a card is drawn', () => {
    expect(() => continued(withPlayer(table([]), 'ann', {}))).toThrow(IllegalActionError);
  });
});

describe('TRANSFER', () => {
  it('collects from the bank', () => {
    const { state } = resolved([card([{ type: 'TRANSFER', amount: 50, from: 'bank', to: 'drawer' }])]);

    expect(player(state, 'ann').cash).toBe(1550);
    expect(state.turn?.step).toBe('awaitEndTurn');
  });

  it('pays the bank, feeding the Jackpot when the Rules turn it on', () => {
    const rules = { ...defaultRules, freeParkingMode: 'jackpot' as const };
    const pay = card([{ type: 'TRANSFER', amount: 15, from: 'drawer', to: 'bank' }]);

    const { state } = resolved([pay], undefined, { rules });
    expect(player(state, 'ann').cash).toBe(1485);
    expect(state.bank.jackpot).toBe(15);

    expect(resolved([pay]).state.bank.jackpot).toBe(0);
  });

  it('collects the full amount from every other Player', () => {
    const { state } = resolved([card([{ type: 'TRANSFER', amount: 10, from: 'allOthers', to: 'drawer' }])]);

    expect(state.players.map((p) => p.cash)).toEqual([1520, 1490, 1490]);
  });

  it('pays every other Player the full amount', () => {
    const { state } = resolved([card([{ type: 'TRANSFER', amount: 50, from: 'drawer', to: 'allOthers' }])]);

    expect(state.players.map((p) => p.cash)).toEqual([1400, 1550, 1550]);
  });

  it('skips the drawer paying themselves under everyone, and says so', () => {
    const { state, events } = resolved([card([{ type: 'TRANSFER', amount: 10, from: 'drawer', to: 'everyone' }])]);

    expect(state.players.map((p) => p.cash)).toEqual([1480, 1510, 1510]);
    expect(events).toContainEqual({ type: 'CARD_EFFECT_SKIPPED', playerId: 'ann', effect: 'TRANSFER', reason: 'selfTransfer' });
  });

  it('acceptance check: "Give 100 to {to}" aimed at a named Player makes the drawer pay them', () => {
    const give = card([{ type: 'TRANSFER', amount: 100, from: 'drawer', to: { player: 'cat' } }], { text: 'Give {amount} to {to}.' });

    const reveal = drawn([give]);
    expect(reveal.events).toContainEqual(expect.objectContaining({ type: 'CARD_DRAWN', text: 'Give 100 to cat.' }));

    const { state } = continued(reveal.state);
    expect(state.players.map((p) => p.cash)).toEqual([1400, 1500, 1600]);
  });

  it('fills {from}, {to} and {amount} with names and values', () => {
    const text = 'Hand {amount} over: {from} pays {to}.';
    const { events } = drawn([card([{ type: 'TRANSFER', amount: 'dice * 10', from: { player: 'bob' }, to: 'drawer' }], { text })]);

    expect(events).toContainEqual(expect.objectContaining({ type: 'CARD_DRAWN', text: 'Hand 30 over: bob pays ann.' }));
  });

  it('lets the drawer name the Player with drawerChoice', () => {
    const steal = card([{ type: 'TRANSFER', amount: 40, from: 'drawerChoice', to: 'drawer' }]);
    const reveal = drawn([steal]);

    expect(() => continued(reveal.state)).toThrow(IllegalActionError);
    expect(() => continued(reveal.state, { choiceId: 'nobody' })).toThrow(IllegalActionError);
    const { state, events } = continued(reveal.state, { choiceId: 'bob' });
    expect(state.players.map((p) => p.cash)).toEqual([1540, 1460, 1500]);
    expect(events).toContainEqual({ type: 'CARD_CONTINUED', playerId: 'ann', choiceId: 'bob' });
  });

  it('picks a random other Player', () => {
    const steal = card([{ type: 'TRANSFER', amount: 40, from: 'random', to: 'drawer' }]);

    const { state } = resolved([steal], undefined, { rng: script(1) });

    expect(state.players.map((p) => p.cash)).toEqual([1540, 1500, 1460]);
  });

  it('takes from the richest and the poorest Player', () => {
    const prepare = (s: GameState) => withPlayer(withPlayer(s, 'bob', { cash: 3000 }), 'cat', { cash: 100 });

    const richest = resolved([card([{ type: 'TRANSFER', amount: 200, from: 'richest', to: 'drawer' }])], prepare);
    const poorest = resolved([card([{ type: 'TRANSFER', amount: 50, from: 'poorest', to: 'drawer' }])], prepare);

    expect(richest.state.players.map((p) => p.cash)).toEqual([1700, 2800, 100]);
    expect(poorest.state.players.map((p) => p.cash)).toEqual([1550, 3000, 50]);
  });

  it('skips the richest Player when that is the drawer', () => {
    const { state, events } = resolved([card([{ type: 'TRANSFER', amount: 200, from: 'richest', to: 'drawer' }])], (s) =>
      withPlayer(s, 'ann', { cash: 9000, position: 4 }),
    );

    expect(player(state, 'ann').cash).toBe(9000);
    expect(events).toContainEqual(expect.objectContaining({ type: 'CARD_EFFECT_SKIPPED', reason: 'selfTransfer' }));
  });

  it('pays the next Player in turn order for left and the previous one for right', () => {
    const left = resolved([card([{ type: 'TRANSFER', amount: 30, from: 'drawer', to: 'left' }])]);
    const right = resolved([card([{ type: 'TRANSFER', amount: 30, from: 'drawer', to: 'right' }])]);

    expect(left.state.players.map((p) => p.cash)).toEqual([1470, 1530, 1500]);
    expect(right.state.players.map((p) => p.cash)).toEqual([1470, 1500, 1530]);
  });

  it('steps over bankrupt Players for left and right', () => {
    const { state } = resolved([card([{ type: 'TRANSFER', amount: 30, from: 'drawer', to: 'left' }])], (s) =>
      withPlayer(s, 'bob', { bankrupt: true }),
    );

    expect(state.players.map((p) => p.cash)).toEqual([1470, 1500, 1530]);
  });

  it('skips a named Player who is bankrupt or gone but resolves the rest of the card', () => {
    const chain = card([
      { type: 'TRANSFER', amount: 100, from: 'drawer', to: { player: 'bob' } },
      { type: 'TRANSFER', amount: 100, from: 'drawer', to: { player: 'ghost' } },
      { type: 'TRANSFER', amount: 5, from: 'bank', to: 'drawer' },
    ]);

    const { state, events } = resolved([chain], (s) => withPlayer(s, 'bob', { bankrupt: true }));

    expect(player(state, 'ann').cash).toBe(1505);
    expect(events.filter((e) => e.type === 'CARD_EFFECT_SKIPPED')).toHaveLength(2);
    expect(events).toContainEqual({ type: 'CARD_EFFECT_SKIPPED', playerId: 'ann', effect: 'TRANSFER', reason: 'playerGone' });
  });

  it('reads the amount from a dice expression', () => {
    const { state } = resolved([card([{ type: 'TRANSFER', amount: 'dice', from: 'bank', to: 'drawer' }])]);
    expect(player(state, 'ann').cash).toBe(1503);

    const tenfold = resolved([card([{ type: 'TRANSFER', amount: 'dice * 10', from: 'bank', to: 'drawer' }])]);
    expect(player(tenfold.state, 'ann').cash).toBe(1530);
  });

  it('takes a percentage of the paying Party\'s cash, rounded up', () => {
    const { state } = resolved([card([{ type: 'TRANSFER', amount: 'percentOfCash(10)', from: 'drawer', to: 'bank' }])], (s) =>
      withPlayer(s, 'ann', { cash: 1234, position: 4 }),
    );
    expect(player(state, 'ann').cash).toBe(1234 - 124);

    const each = resolved([card([{ type: 'TRANSFER', amount: 'percentOfCash(10)', from: 'allOthers', to: 'drawer' }])], (s) =>
      withPlayer(s, 'bob', { cash: 1000 }),
    );
    expect(each.state.players.map((p) => p.cash)).toEqual([1500 + 100 + 150, 900, 1350]);
  });

  it('skips an amount it cannot read', () => {
    const { state, events } = resolved([card([{ type: 'TRANSFER', amount: 'lots', from: 'bank', to: 'drawer' }])]);

    expect(player(state, 'ann').cash).toBe(1500);
    expect(events).toContainEqual(expect.objectContaining({ type: 'CARD_EFFECT_SKIPPED', reason: 'badAmount' }));
  });

  it('feeds the Jackpot only from Transfers to the bank, not from the bank or to Players', () => {
    const rules = { ...defaultRules, freeParkingMode: 'jackpot' as const };
    const { state } = resolved(
      [
        card([
          { type: 'TRANSFER', amount: 10, from: 'bank', to: 'drawer' },
          { type: 'TRANSFER', amount: 10, from: 'drawer', to: { player: 'bob' } },
          { type: 'TRANSFER', amount: 7, from: 'drawer', to: 'bank' },
        ]),
      ],
      undefined,
      { rules },
    );

    expect(state.bank.jackpot).toBe(7);
  });
});

describe('a Transfer the payer cannot afford', () => {
  it('enters the Debt flow, with one Debt per Creditor in turn order', () => {
    const payEach = card([{ type: 'TRANSFER', amount: 50, from: 'drawer', to: 'allOthers' }]);

    const { state } = resolved([payEach], (s) => withPlayer(s, 'ann', { cash: 60, position: 4 }));

    expect(state.turn?.step).toBe('awaitDebt');
    expect(state.players.map((p) => p.cash)).toEqual([10, 1550, 1500]);
    expect(state.debts).toEqual([
      { debtorId: 'ann', creditor: { type: 'player', playerId: 'cat' }, amount: 50, feedsJackpot: false },
    ]);
  });

  it('lets the card carry on once the Debts are paid', () => {
    const chain = card([
      { type: 'TRANSFER', amount: 50, from: 'drawer', to: 'allOthers' },
      { type: 'TRANSFER', amount: 5, from: 'bank', to: 'drawer' },
    ]);
    const stuck = resolved([chain], (s) => withPlayer(s, 'ann', { cash: 60, position: 4, ...{} })).state;
    const funded = withPlayer(stuck, 'ann', { cash: 60 });

    const { state } = act(funded, { type: 'PAY_DEBT', playerId: 'ann' });

    expect(state.players.map((p) => p.cash)).toEqual([15, 1550, 1550]);
    expect(state.turn?.step).toBe('awaitEndTurn');
  });

  it('makes the other Players the debtors when they cannot pay the drawer', () => {
    const collect = card([{ type: 'TRANSFER', amount: 100, from: 'allOthers', to: 'drawer' }]);

    const { state } = resolved([collect], (s) => withPlayer(s, 'bob', { cash: 30 }));

    expect(state.turn?.step).toBe('awaitDebt');
    expect(state.debts[0]).toMatchObject({ debtorId: 'bob', creditor: { type: 'player', playerId: 'ann' }, amount: 100 });
    expect(act(state, { type: 'DECLARE_BANKRUPTCY', playerId: 'bob' }).state.turn?.step).toBe('awaitEndTurn');
  });

  it('owes the bank when it is the Creditor', () => {
    const { state } = resolved([card([{ type: 'TRANSFER', amount: 500, from: 'drawer', to: 'bank' }])], (s) =>
      withPlayer(s, 'ann', { cash: 100, position: 4 }),
    );

    expect(state.debts).toEqual([{ debtorId: 'ann', creditor: { type: 'bank' }, amount: 500, feedsJackpot: true }]);
  });
});

describe('MOVE_TO', () => {
  it('moves forward to the space and collects a salary for passing GO', () => {
    const { state } = resolved([card([{ type: 'MOVE_TO', index: 5, collectGo: true }])]);

    expect(player(state, 'ann')).toMatchObject({ position: 5, cash: 1500 + 200 });
    expect(state.turn?.step).toBe('awaitBuyDecision');
  });

  it('does not pay a salary when collectGo is off', () => {
    const { state } = resolved([card([{ type: 'MOVE_TO', index: 5, collectGo: false }])]);

    expect(player(state, 'ann')).toMatchObject({ position: 5, cash: 1500 });
    expect(player(state, 'ann').hasPassedGo).toBe(false);
  });

  it('pays the salary on a card move that ends on GO, doubled by doubleSalaryOnExactGo', () => {
    const go = card([{ type: 'MOVE_TO', index: 0, collectGo: true }]);
    const plain = resolved([go], undefined, { rules: { ...defaultRules, doubleSalaryOnExactGo: false } });
    const doubled = resolved([go], undefined, { rules: { ...defaultRules, doubleSalaryOnExactGo: true } });

    expect(player(plain.state, 'ann').cash).toBe(1500 + 200);
    expect(player(doubled.state, 'ann').cash).toBe(1500 + 400);
  });

  it('resolves the space it lands on, such as rent', () => {
    const { state } = resolved([card([{ type: 'MOVE_TO', index: 11, collectGo: true }])], (s) => owning(s, 'bob', [11]));

    expect(player(state, 'ann').cash).toBe(1500 - 10);
    expect(player(state, 'bob').cash).toBe(1510);
  });

  it('lets a buy decision finish before the next Effect', () => {
    const chain = card([
      { type: 'MOVE_TO', index: 5, collectGo: false },
      { type: 'TRANSFER', amount: 5, from: 'bank', to: 'drawer' },
    ]);
    const offered = resolved([chain]).state;
    expect(offered.turn?.step).toBe('awaitBuyDecision');
    expect(player(offered, 'ann').cash).toBe(1500);

    const { state } = act(offered, { type: 'BUY_PROPERTY', playerId: 'ann' });

    expect(player(state, 'ann').cash).toBe(1500 - 200 + 5);
    expect(state.turn?.step).toBe('awaitEndTurn');
  });

  it('skips a space that does not exist', () => {
    const { events } = resolved([card([{ type: 'MOVE_TO', index: 99, collectGo: true }])]);

    expect(events).toContainEqual(expect.objectContaining({ type: 'CARD_EFFECT_SKIPPED', reason: 'noSuchSpace' }));
  });

  it('moves another Player named as the target without landing them', () => {
    const { state } = resolved([card([{ type: 'MOVE_TO', index: 5, collectGo: false, target: { player: 'bob' } }])]);

    expect(player(state, 'bob').position).toBe(5);
    expect(player(state, 'ann').position).toBe(7);
    expect(state.turn?.step).toBe('awaitEndTurn');
  });
});

describe('MOVE_RELATIVE', () => {
  it('goes back three spaces from the Chance space and resolves that space', () => {
    const { state, events } = resolved([card([{ type: 'MOVE_RELATIVE', steps: -3 }])]);

    // Back on Income Tax, marked as a move backwards so the token can step the right way.
    expect(player(state, 'ann')).toMatchObject({ position: 4, cash: 1500 - 200 });
    expect(events).toContainEqual({ type: 'MOVED', playerId: 'ann', from: 7, to: 4, backward: true });
  });

  it('wraps backwards round the Board without a salary', () => {
    const { state } = resolved([card([{ type: 'MOVE_RELATIVE', steps: -10 }])]);

    expect(player(state, 'ann')).toMatchObject({ position: 37, cash: 1500 });
  });

  it('moves forward and collects a salary for passing GO', () => {
    const { state, events } = resolved([card([{ type: 'MOVE_RELATIVE', steps: 35 }])]);

    expect(player(state, 'ann')).toMatchObject({ position: 2, cash: 1700 });
    expect(events).toContainEqual({ type: 'MOVED', playerId: 'ann', from: 7, to: 2 });
  });
});

describe('MOVE_TO_NEAREST', () => {
  it('offers an unowned station for sale', () => {
    const { state } = resolved([card([{ type: 'MOVE_TO_NEAREST', kind: 'station', rentMultiplier: 2 }])]);

    expect(player(state, 'ann').position).toBe(15);
    expect(state.turn?.step).toBe('awaitBuyDecision');
  });

  it('pays the usual rent times the multiplier for an owned station', () => {
    const { state } = resolved([card([{ type: 'MOVE_TO_NEAREST', kind: 'station', rentMultiplier: 2 }])], (s) => owning(s, 'bob', [15]));

    expect(player(state, 'ann').cash).toBe(1500 - 50);
    expect(player(state, 'bob').cash).toBe(1550);
  });

  it('counts the owner\'s other stations before doubling', () => {
    const { state } = resolved([card([{ type: 'MOVE_TO_NEAREST', kind: 'station', rentMultiplier: 2 }])], (s) => owning(s, 'bob', [5, 15]));

    expect(player(state, 'ann').cash).toBe(1500 - 100);
  });

  it('pays the dice multiplier for an owned utility, from the last roll', () => {
    const { state } = resolved([card([{ type: 'MOVE_TO_NEAREST', kind: 'utility', diceMultiplier: 10 }])], (s) => owning(s, 'bob', [12]));

    expect(player(state, 'ann')).toMatchObject({ position: 12, cash: 1500 - 30 });
  });

  it('wraps past GO to the nearest space and collects a salary', () => {
    const { state } = resolved([card([{ type: 'MOVE_TO_NEAREST', kind: 'station', rentMultiplier: 2 }])], (s) =>
      withPlayer(s, 'ann', { position: 33 }),
    );

    // From 33 + 3 = 36 (Chance), the next station is 5, past GO.
    expect(player(state, 'ann')).toMatchObject({ position: 5, cash: 1500 + 200 });
  });

  it('charges nothing for the drawer\'s own property or a mortgaged one', () => {
    const own = resolved([card([{ type: 'MOVE_TO_NEAREST', kind: 'station', rentMultiplier: 2 }])], (s) => owning(s, 'ann', [15]));
    const mortgaged = resolved([card([{ type: 'MOVE_TO_NEAREST', kind: 'station', rentMultiplier: 2 }])], (s) =>
      owning(s, 'bob', [15], { mortgaged: true }),
    );

    expect(player(own.state, 'ann').cash).toBe(1500);
    expect(player(mortgaged.state, 'ann').cash).toBe(1500);
  });
});

describe('Jail', () => {
  it('sends the drawer to Jail without a salary and ends their turn', () => {
    const { state, events } = resolved([card([{ type: 'GO_TO_JAIL' }])], (s) => withPlayer(s, 'ann', { position: 33 }));

    expect(player(state, 'ann')).toMatchObject({ position: 10, inJail: true, cash: 1500 });
    expect(state.turn?.step).toBe('awaitEndTurn');
    expect(events).toContainEqual({ type: 'JAILED', playerId: 'ann', reason: 'card' });
  });

  it('sends a named Player to Jail without ending the drawer\'s turn', () => {
    const { state } = resolved([card([{ type: 'GO_TO_JAIL', target: { player: 'cat' } }])]);

    expect(player(state, 'cat')).toMatchObject({ position: 10, inJail: true });
    expect(player(state, 'ann').inJail).toBe(false);
  });

  it('holds a get-out-of-jail card until used, then returns it to the bottom of its Deck', () => {
    const free = card([{ type: 'GET_OUT_OF_JAIL' }], { keepable: true });
    const other = card([{ type: 'MANUAL' }]);

    const { state, events } = resolved([free, other]);
    expect(player(state, 'ann').heldCards).toEqual([free.id]);
    expect(state.decks.chance.drawPile).toEqual([other.id]);
    expect(events).toContainEqual({ type: 'CARD_KEPT', playerId: 'ann', cardId: free.id });

    const jailed = withPlayer({ ...state, turn: { ...state.turn!, step: 'awaitRoll' } }, 'ann', { inJail: true, position: 10 });
    const used = act(jailed, { type: 'USE_JAIL_CARD', playerId: 'ann' });

    expect(player(used.state, 'ann')).toMatchObject({ inJail: false, heldCards: [] });
    expect(used.state.decks.chance.drawPile).toEqual([other.id, free.id]);
    expect(used.state.turn?.step).toBe('awaitRoll');
    expect(types(used.events)).toEqual(['JAIL_CARD_USED', 'LEFT_JAIL']);
  });

  it('cannot use a card when not in Jail, with no card, or off turn', () => {
    const free = card([{ type: 'GET_OUT_OF_JAIL' }], { keepable: true });
    const held = withPlayer(resolved([free]).state, 'ann', {});
    const ready = { ...held, turn: { ...held.turn!, step: 'awaitRoll' as const } };

    expect(() => act(ready, { type: 'USE_JAIL_CARD', playerId: 'ann' })).toThrow(IllegalActionError);
    const noCard = withPlayer(table([]), 'ann', { inJail: true });
    expect(() => act(noCard, { type: 'USE_JAIL_CARD', playerId: 'ann' })).toThrow('no get-out-of-jail card');
    const jailed = withPlayer(ready, 'ann', { inJail: true });
    expect(() => act(jailed, { type: 'USE_JAIL_CARD', playerId: 'bob' })).toThrow(IllegalActionError);
  });

  it('hands held cards to the Creditor on Bankruptcy, or back to the Decks for the bank', () => {
    const free = card([{ type: 'GET_OUT_OF_JAIL' }], { keepable: true });
    const held = resolved([free]).state;
    expect(held.decks.chance.drawPile).toEqual([]);
    const owing = (creditor: Debt['creditor']): GameState => ({
      ...held,
      turn: { ...held.turn!, step: 'awaitDebt' },
      debts: [{ debtorId: 'ann', creditor, amount: 5000, feedsJackpot: false }],
    });

    const toPlayer = act(owing({ type: 'player', playerId: 'bob' }), { type: 'DECLARE_BANKRUPTCY', playerId: 'ann' }).state;
    expect(player(toPlayer, 'bob').heldCards).toEqual([free.id]);

    const toBank = act(owing({ type: 'bank' }), { type: 'DECLARE_BANKRUPTCY', playerId: 'ann' }).state;
    expect(toBank.decks.chance.drawPile).toEqual([free.id]);
    expect(player(toBank, 'ann').heldCards).toEqual([]);
  });
});

describe('REPAIRS', () => {
  const repairs = card([{ type: 'REPAIRS', perHouse: 25, perHotel: 100 }]);

  it('charges the bank per house and per hotel the drawer owns', () => {
    const { state } = resolved([repairs], (s) => ({
      ...owning(owning(owning(s, 'ann', [1], { buildings: 3 }), 'ann', [3], { buildings: HOTEL }), 'bob', [6], { buildings: 2 }),
    }));

    expect(player(state, 'ann').cash).toBe(1500 - 3 * 25 - 100);
    expect(player(state, 'bob').cash).toBe(1500);
  });

  it('charges nothing without buildings', () => {
    expect(player(resolved([repairs]).state, 'ann').cash).toBe(1500);
  });

  it('enters the Debt flow when the drawer cannot pay', () => {
    const { state } = resolved([repairs], (s) => withPlayer(owning(s, 'ann', [1], { buildings: 4 }), 'ann', { cash: 10, position: 4 }));

    expect(state.debts).toEqual([{ debtorId: 'ann', creditor: { type: 'bank' }, amount: 100, feedsJackpot: false }]);
  });

  it('can charge a named Player instead', () => {
    const bobPays = card([{ type: 'REPAIRS', perHouse: 25, perHotel: 100, target: { player: 'bob' } }]);

    const { state } = resolved([bobPays], (s) => owning(s, 'bob', [6], { buildings: 2 }));

    expect(state.players.map((p) => p.cash)).toEqual([1500, 1450, 1500]);
  });
});

describe('turn-order Effects', () => {
  it('makes the target miss turns', () => {
    const skip = card([{ type: 'SKIP_TURNS', count: 2, target: { player: 'bob' } }]);
    const { state } = resolved([skip]);
    expect(player(state, 'bob').skipTurns).toBe(2);

    const first = act(state, { type: 'END_TURN', playerId: 'ann' });
    expect(first.state.turn?.playerId).toBe('cat');
    expect(first.events).toContainEqual({ type: 'TURN_SKIPPED', playerId: 'bob' });
    expect(player(first.state, 'bob').skipTurns).toBe(1);

    const second = endTurn(first.state, 'cat');
    expect(second.state.turn).toMatchObject({ playerId: 'ann', round: 2 });
    const third = endTurn(second.state, 'ann');
    expect(third.state.turn?.playerId).toBe('cat');
    expect(player(third.state, 'bob').skipTurns).toBe(0);
  });

  it('makes the drawer miss their own next turn', () => {
    const { state } = resolved([card([{ type: 'SKIP_TURNS', count: 1 }])]);

    const afterBob = endTurn(act(state, { type: 'END_TURN', playerId: 'ann' }).state, 'bob').state;
    const next = endTurn(afterBob, 'cat').state;

    expect(next.turn?.playerId).toBe('bob');
  });

  it('gives the drawer an extra turn after this one', () => {
    const { state, events } = resolved([card([{ type: 'EXTRA_TURN' }])]);
    expect(events).toContainEqual({ type: 'EXTRA_TURN_GRANTED', playerId: 'ann' });

    const next = act(state, { type: 'END_TURN', playerId: 'ann' }).state;

    expect(next.turn).toMatchObject({ playerId: 'ann', step: 'awaitRoll', round: 1 });
    expect(endTurn(next, 'ann').state.turn?.playerId).toBe('bob');
  });

  it('gives a named Player a turn without changing the order afterwards', () => {
    const base = resolved([card([{ type: 'EXTRA_TURN', target: { player: 'cat' } }])]).state;

    const cats = act(base, { type: 'END_TURN', playerId: 'ann' }).state;
    expect(cats.turn).toMatchObject({ playerId: 'cat', step: 'awaitRoll' });

    expect(endTurn(cats, 'cat').state.turn?.playerId).toBe('bob');
  });

  it('swaps places with a named Player and resolves the drawer\'s new space', () => {
    const swap = card([{ type: 'SWAP_POSITION', target: { player: 'bob' } }]);

    const { state, events } = resolved([swap], (s) => withPlayer(s, 'bob', { position: 5 }));

    expect(player(state, 'ann').position).toBe(5);
    expect(player(state, 'bob').position).toBe(7);
    expect(state.turn?.step).toBe('awaitBuyDecision');
    expect(events).toContainEqual({ type: 'POSITIONS_SWAPPED', playerId: 'ann', otherId: 'bob' });
  });

  it('does not swap with a Player in Jail', () => {
    const swap = card([{ type: 'SWAP_POSITION', target: { player: 'bob' } }]);

    const { state, events } = resolved([swap], (s) => withPlayer(s, 'bob', { position: 10, inJail: true }));

    expect(player(state, 'ann').position).toBe(7);
    expect(events).toContainEqual(expect.objectContaining({ type: 'CARD_EFFECT_SKIPPED', reason: 'inJail' }));
  });
});

describe('MANUAL', () => {
  const manual = card([{ type: 'MANUAL' }, { type: 'TRANSFER', amount: 50, from: 'bank', to: 'drawer' }], { text: 'The table decides.' });

  it('pauses for the Host once the drawer continues it', () => {
    const { state } = resolved([manual]);

    expect(state.turn?.step).toBe('awaitManual');
    expect(state.players.map((p) => p.cash)).toEqual([1500, 1500, 1500]);
  });

  it('lets the Host resolve it with Overrides, then carry on with the rest of the card', () => {
    const bobHosts = { ...resolved([manual]).state, hostId: 'bob' };
    const adjusted = act(bobHosts, {
      type: 'HOST_OVERRIDE',
      playerId: 'bob',
      override: { kind: 'ADJUST_CASH', playerId: 'cat', amount: 25 },
    }).state;

    expect(() => continued(adjusted, { by: 'ann' })).toThrow('Only the Host');
    const { state } = continued(adjusted, { by: 'bob' });

    expect(state.players.map((p) => p.cash)).toEqual([1550, 1500, 1525]);
    expect(state.turn?.step).toBe('awaitEndTurn');
  });

  it('is revealed to the drawer like any other card', () => {
    const bobHosts = { ...drawn([manual]).state, hostId: 'bob' };

    expect(() => continued(bobHosts, { by: 'bob' })).toThrow(IllegalActionError);
    expect(continued(bobHosts, { by: 'ann' }).state.turn?.step).toBe('awaitManual');
  });
});

describe('chained Effects', () => {
  it('resolve in order', () => {
    const chain = card([
      { type: 'TRANSFER', amount: 100, from: 'bank', to: 'drawer' },
      { type: 'TRANSFER', amount: 'percentOfCash(10)', from: 'drawer', to: 'bank' },
      { type: 'SKIP_TURNS', count: 1 },
      { type: 'MOVE_RELATIVE', steps: 3 },
    ]);

    const { state, events } = resolved([chain]);

    // 10% is taken after the 100 arrives: 1600 → 160.
    expect(player(state, 'ann')).toMatchObject({ cash: 1440, position: 10, skipTurns: 1 });
    const order = types(events).filter((t) => ['CARD_TRANSFER', 'MOVED', 'SKIP_TURNS_SET'].includes(t));
    expect(order).toEqual(['MOVED', 'CARD_TRANSFER', 'CARD_TRANSFER', 'SKIP_TURNS_SET', 'MOVED']);
  });

  it('carry on after the landing of an earlier move, even through a rent Debt', () => {
    const chain = card([
      { type: 'MOVE_TO', index: 11, collectGo: false },
      { type: 'TRANSFER', amount: 1, from: 'bank', to: 'drawer' },
    ]);

    const stuck = resolved([chain], (s) => withPlayer(owning(s, 'bob', [11]), 'ann', { cash: 5, position: 4 })).state;
    expect(stuck.turn?.step).toBe('awaitDebt');

    const { state } = act({ ...stuck, players: stuck.players.map((p) => (p.id === 'ann' ? { ...p, cash: 50 } : p)) }, { type: 'PAY_DEBT', playerId: 'ann' });
    expect(player(state, 'ann').cash).toBe(50 - 10 + 1);
    expect(state.turn?.step).toBe('awaitEndTurn');
  });

  it('stack when a move lands on another card space, and the first card resumes afterwards', () => {
    const first = card([
      { type: 'MOVE_RELATIVE', steps: 15 },
      { type: 'TRANSFER', amount: 7, from: 'bank', to: 'drawer' },
    ]);
    const second = card([{ type: 'TRANSFER', amount: 20, from: 'bank', to: 'drawer' }]);
    // 7 + 15 = 22, the next Chance space; the Chance Deck holds both.
    const reveal = drawn([first, second]);
    const afterFirst = continued(reveal.state);

    expect(afterFirst.state.turn?.step).toBe('awaitCard');
    expect(afterFirst.state.turn?.cards.map((c) => c.cardId)).toEqual([first.id, second.id]);
    expect(player(afterFirst.state, 'ann').cash).toBe(1500);

    const { state } = continued(afterFirst.state);
    expect(player(state, 'ann').cash).toBe(1500 + 20 + 7);
    expect(state.turn).toMatchObject({ step: 'awaitEndTurn', cards: [] });
  });

  it('hand back to the Doubles roll-again once the card is done', () => {
    const ready = withPlayer(table([card([{ type: 'TRANSFER', amount: 5, from: 'bank', to: 'drawer' }])]), 'ann', { position: 5 });

    const onDoubles = act(ready, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 1));
    expect(onDoubles.state.turn?.step).toBe('awaitCard');

    expect(continued(onDoubles.state).state.turn?.step).toBe('awaitRoll');
  });
});

describe('default Decks', () => {
  it('hold 16 cards each, all with original wording and valid Effects', () => {
    const decks = defaultDecks();

    expect(decks.chance.drawPile).toHaveLength(16);
    expect(decks.treasure.drawPile).toHaveLength(16);
    expect(defaultCards.chance.map((c) => c.copies).reduce((a, b) => a + b)).toBe(16);
    for (const c of [...defaultCards.chance, ...defaultCards.treasure]) {
      expect(c.effects.length).toBeGreaterThan(0);
      expect(c.text.toLowerCase()).not.toContain('monopoly');
    }
    expect(new Set([...defaultCards.chance, ...defaultCards.treasure].map((c) => c.id)).size).toBe(31);
  });

  it('are shuffled on the server when the game starts', () => {
    let state = createGame('ABCDE', { id: 'ann', name: 'ann', color: 'c0' }, defaultRules, defaultBoard);
    state = act(state, { type: 'JOIN_ROOM', playerId: 'bob', name: 'bob', color: 'c1' }).state;
    const lobbyPile = state.decks.chance.drawPile;

    const started = act(state, { type: 'START_GAME', playerId: 'ann' }, scriptWithZeros([5, 5, 0, 0])).state;

    expect(started.decks.chance.drawPile).not.toEqual(lobbyPile);
    expect([...started.decks.chance.drawPile].sort()).toEqual([...lobbyPile].sort());
    expect(started.decks.treasure.drawPile).toHaveLength(16);
  });

  it('deal a real card when a Player lands on Chance or Treasure', () => {
    const started = withPlayer(
      act(
        act(createGame('ABCDE', { id: 'ann', name: 'ann', color: 'c0' }, defaultRules, defaultBoard), {
          type: 'JOIN_ROOM',
          playerId: 'bob',
          name: 'bob',
          color: 'c1',
        }).state,
        { type: 'START_GAME', playerId: 'ann' },
        scriptWithZeros([5, 5, 0, 0]),
      ).state,
      'ann',
      { position: 4 },
    );

    const { state } = act(started, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2));

    expect(state.turn?.step).toBe('awaitCard');
    expect(state.turn?.cards).toHaveLength(1);
  });
});
