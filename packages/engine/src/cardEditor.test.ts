import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  defaultBoard,
  defaultCards,
  defaultRules,
  IllegalActionError,
  type Action,
  type Card,
  type CardDraft,
  type Effect,
  type GameState,
  type Player,
  type Rng,
  viewFor,
} from './index';

/** An Rng that returns the given values in order (die faces are 0-based here). */
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

const dice = (...faces: number[]) => script(...faces.map((f) => f - 1));

function act(state: GameState, action: Action, rng: Rng = script()) {
  return applyAction(state, action, state.rules, rng, 0);
}

function card(id: string, effects: Effect[], extra: Partial<Card> = {}): Card {
  return { id, deck: 'chance', title: `Card ${id}`, text: `Text ${id}`, effects, keepable: false, enabled: true, copies: 1, ...extra };
}

const pay = (amount: number): Effect => ({ type: 'TRANSFER', amount, from: 'drawer', to: 'bank' });
const jailCard = (id: string, extra: Partial<Card> = {}) =>
  card(id, [{ type: 'GET_OUT_OF_JAIL' }], { keepable: true, ...extra });

function draft(extra: Partial<CardDraft> = {}): CardDraft {
  return { title: 'Lucky find', text: 'Collect {amount}.', effects: [{ type: 'TRANSFER', amount: 75, from: 'bank', to: 'drawer' }], enabled: true, copies: 1, ...extra };
}

const copiesOf = (cards: Card[]) => cards.flatMap((c) => (c.enabled ? Array<string>(c.copies).fill(c.id) : []));

/**
 * ann (Host) and bob, ann to roll from space 4, with Chance holding `cards` in pile order (top
 * first) and Treasure `treasure`.
 */
function table(cards: Card[], pile = copiesOf(cards), treasure: Card[] = []): GameState {
  const decks = { chance: { cards, drawPile: pile }, treasure: { cards: treasure, drawPile: copiesOf(treasure) } };
  let state = createGame('ABCDE', { id: 'ann', name: 'Ann', color: 'a' }, structuredClone(defaultRules), structuredClone(defaultBoard), decks);
  state = act(state, { type: 'JOIN_ROOM', playerId: 'bob', name: 'Bob', color: 'b' }).state;
  // Roll-off ann 12, bob 2, then the deck shuffle takes zeros.
  const queue = [5, 5, 0, 0];
  state = applyAction(state, { type: 'START_GAME', playerId: 'ann' }, state.rules, { int: () => queue.shift() ?? 0 }, 0).state;
  return withPlayer({ ...state, decks }, 'ann', { position: 4 });
}

function withPlayer(state: GameState, id: string, patch: Partial<Player>): GameState {
  return { ...state, players: state.players.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

const player = (state: GameState, id: string) => state.players.find((p) => p.id === id)!;
const pile = (state: GameState) => state.decks.chance.drawPile;

/** ann rolls 1 + 2 from space 4 onto Chance (7) and draws. */
const draw = (state: GameState) => act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2));

/** Draws, then continues the card; `events` covers both steps. */
function drawAndResolve(state: GameState) {
  const drawn = draw(state);
  const resolved = act(drawn.state, { type: 'CONTINUE_CARD', playerId: 'ann' });
  return { state: resolved.state, events: [...drawn.events, ...resolved.events] };
}

describe('adding a card', () => {
  it('inserts it at a random place in the draw pile, where it can be drawn in the same game', () => {
    const state = table([card('a', [pay(10)]), card('b', [pay(20)])]);
    // Random position 0: the top of the pile.
    const { state: added, events } = act(state, { type: 'ADD_CARD', playerId: 'ann', deck: 'chance', card: draft() }, script(0));

    const created = added.decks.chance.cards.find((c) => c.title === 'Lucky find')!;
    expect(created).toMatchObject({ deck: 'chance', text: 'Collect {amount}.', copies: 1, enabled: true, keepable: false });
    expect(pile(added)).toEqual([created.id, 'a', 'b']);
    expect(events).toContainEqual({ type: 'CARD_ADDED', deck: 'chance', cardId: created.id, title: 'Lucky find', text: 'Collect {amount}.' });

    const { state: after, events: drawEvents } = drawAndResolve(added);
    expect(drawEvents).toContainEqual(expect.objectContaining({ type: 'CARD_DRAWN', cardId: created.id, text: 'Collect 75.' }));
    expect(player(after, 'ann').cash).toBe(1500 + 75);
  });

  it('is Host only', () => {
    const state = table([]);
    expect(() => act(state, { type: 'ADD_CARD', playerId: 'bob', deck: 'chance', card: draft() }, script(0))).toThrow(IllegalActionError);
  });
});

describe('editing a card', () => {
  it('changes a Treasure card in place, and its next draw uses the new text and amount', () => {
    const fee = card('fee', [pay(50)], { deck: 'treasure', title: 'Doctor', text: 'Pay {amount}.' });
    const state = table([], [], [card('t1', [pay(1)], { deck: 'treasure' }), fee]);
    const edit = draft({ title: 'Specialist', text: 'The specialist charges {amount}.', effects: [pay(120)] });
    const { state: edited, events } = act(state, { type: 'EDIT_CARD', playerId: 'ann', cardId: 'fee', card: edit });

    expect(edited.decks.treasure.drawPile).toEqual(['t1', 'fee']);
    expect(events).toEqual([
      { type: 'CARD_EDITED', deck: 'treasure', cardId: 'fee', title: 'Specialist', text: 'The specialist charges {amount}.' },
    ]);

    // ann rolls 1 + 2 from 14 onto Treasure (17) twice: t1 first, then the edited card.
    let next = withPlayer(edited, 'ann', { position: 14 });
    next = act(act(next, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state, { type: 'CONTINUE_CARD', playerId: 'ann' }).state;
    next = act(next, { type: 'END_TURN', playerId: 'ann' }).state;
    next = act(next, { type: 'ROLL_DICE', playerId: 'bob' }, dice(1, 3)).state;
    next = act(next, { type: 'END_TURN', playerId: 'bob' }).state;
    next = withPlayer(next, 'ann', { position: 14 });
    const drawn = act(next, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2));
    expect(drawn.events).toContainEqual(expect.objectContaining({ type: 'CARD_DRAWN', cardId: 'fee', text: 'The specialist charges 120.' }));
    const cash = player(drawn.state, 'ann').cash;
    expect(player(act(drawn.state, { type: 'CONTINUE_CARD', playerId: 'ann' }).state, 'ann').cash).toBe(cash - 120);
  });

  it('lets a card being resolved finish under its old definition', () => {
    const state = table([card('a', [pay(10), pay(20)])]);
    const drawn = draw(state).state;
    const edited = act(drawn, { type: 'EDIT_CARD', playerId: 'ann', cardId: 'a', card: draft({ effects: [pay(500)] }) }).state;
    const after = act(edited, { type: 'CONTINUE_CARD', playerId: 'ann' }).state;
    expect(player(after, 'ann').cash).toBe(1500 - 30);
  });

  it('rejects bad values and non-hosts', () => {
    const state = table([card('a', [pay(10)])]);
    const edit = (card: unknown, playerId = 'ann') => () => act(state, { type: 'EDIT_CARD', playerId, cardId: 'a', card } as Action);
    expect(edit(draft(), 'bob')).toThrow('Only the Host');
    expect(edit(draft({ title: ' ' }))).toThrow(IllegalActionError);
    expect(edit(draft({ effects: [] }))).toThrow(IllegalActionError);
    expect(edit(draft({ effects: [{ type: 'TRANSFER', amount: 'lots', from: 'drawer', to: 'bank' }] }))).toThrow('Amount');
    expect(edit(draft({ effects: [{ type: 'TRANSFER', amount: 5, from: { player: 'nobody' }, to: 'bank' }] }))).toThrow(IllegalActionError);
    expect(edit(draft({ effects: [{ type: 'MOVE_TO', index: 40, collectGo: true }] }))).toThrow('no such space');
    expect(edit(draft({ effects: [{ type: 'EXPLODE' }] as unknown as Effect[] }))).toThrow('not an effect type');
    expect(() => act(state, { type: 'EDIT_CARD', playerId: 'ann', cardId: 'zzz', card: draft() })).toThrow('No such card');
  });

  it('can target a specific Player, who is paid by whoever draws it next', () => {
    const state = table([card('a', [pay(10)])]);
    const give = draft({ text: 'Give {amount} to {to}.', effects: [{ type: 'TRANSFER', amount: 100, from: 'drawer', to: { player: 'bob' } }] });
    const edited = act(state, { type: 'EDIT_CARD', playerId: 'ann', cardId: 'a', card: give }).state;
    const { state: after, events } = drawAndResolve(edited);
    expect(events).toContainEqual(expect.objectContaining({ type: 'CARD_DRAWN', text: 'Give 100 to Bob.' }));
    expect([player(after, 'ann').cash, player(after, 'bob').cash]).toEqual([1400, 1600]);
  });
});

const edit = (state: GameState, current: Card, patch: Partial<CardDraft>, held?: 'keep' | 'remove', rng?: Rng) =>
  act(
    state,
    { type: 'EDIT_CARD', playerId: 'ann', cardId: current.id, held, card: { title: current.title, text: current.text, effects: current.effects, enabled: current.enabled, copies: current.copies, ...patch } },
    rng,
  );

/** ann in Jail, about to use a held card. */
const useJailCard = (state: GameState) =>
  act(withPlayer(state, 'ann', { inJail: true, position: 10 }), { type: 'USE_JAIL_CARD', playerId: 'ann' });

describe('changing copies', () => {
  it('puts each extra copy at a random place in the draw pile', () => {
    const a = card('a', [pay(10)]);
    const state = table([a, card('b', [pay(20)])]);
    const { state: after, events } = edit(state, a, { copies: 3 }, undefined, script(0, 3));
    expect(pile(after)).toEqual(['a', 'a', 'b', 'a']);
    expect(events).toEqual([{ type: 'CARD_COPIES_CHANGED', deck: 'chance', cardId: 'a', title: 'Card a', from: 1, to: 3 }]);
  });

  it('takes copies out from the top of the draw pile first, leaving those already drawn at the bottom', () => {
    const a = card('a', [pay(10)], { copies: 3 });
    const state = table([a, card('b', [pay(1)]), card('c', [pay(1)])], ['b', 'a', 'c', 'a', 'a']);
    expect(pile(edit(state, a, { copies: 1 }).state)).toEqual(['b', 'c', 'a']);
  });

  it('asks the Host about held copies only when the pile alone cannot give up enough', () => {
    const j = jailCard('j', { copies: 2 });
    let state = table([card('x', [pay(1)]), j], ['x', 'j']);
    state = withPlayer(state, 'bob', { heldCards: ['j'] });
    // One copy in the pile, one held: lowering to 1 takes the pile copy.
    expect(pile(edit(state, j, { copies: 1 }).state)).toEqual(['x']);

    state = withPlayer(withPlayer(state, 'ann', { heldCards: ['j'] }), 'bob', { heldCards: ['j'] });
    state = { ...state, decks: { ...state.decks, chance: { ...state.decks.chance, drawPile: ['x'] } } };
    expect(() => edit(state, j, { copies: 1 })).toThrow('choose whether');

    const removed = edit(state, j, { copies: 1 }, 'remove');
    expect(removed.state.players.map((p) => p.heldCards)).toEqual([[], ['j']]);
    expect(removed.events).toContainEqual({ type: 'HELD_CARD_REMOVED', playerId: 'ann', cardId: 'j', title: 'Card j' });

    // Kept: both stay held, and the first one used does not go back while the other is still out.
    const kept = edit(state, j, { copies: 1 }, 'keep').state;
    expect(kept.players.map((p) => p.heldCards)).toEqual([['j'], ['j']]);
    expect(pile(useJailCard(kept).state)).toEqual(['x']);
  });
});

describe('disabling and deleting', () => {
  it('takes a disabled card out of the draw pile at once, and puts it back at random when enabled', () => {
    const a = card('a', [pay(10)], { copies: 2 });
    const state = table([a, card('b', [pay(1)])], ['a', 'b', 'a']);
    const { state: off, events } = edit(state, a, { enabled: false });
    expect(pile(off)).toEqual(['b']);
    expect(events).toEqual([{ type: 'CARD_ENABLED_CHANGED', deck: 'chance', cardId: 'a', title: 'Card a', enabled: false }]);

    const on = edit(off, { ...a, enabled: false }, { enabled: true }, undefined, script(1, 0)).state;
    expect(pile(on)).toEqual(['a', 'b', 'a']);
  });

  it('deletes a card from the Deck and its draw pile', () => {
    const state = table([card('a', [pay(10)], { copies: 2 }), card('b', [pay(1)])], ['a', 'b', 'a']);
    const { state: after, events } = act(state, { type: 'DELETE_CARD', playerId: 'ann', cardId: 'a' });
    expect(after.decks.chance.cards.map((c) => c.id)).toEqual(['b']);
    expect(pile(after)).toEqual(['b']);
    expect(events).toEqual([{ type: 'CARD_DELETED', deck: 'chance', cardId: 'a', title: 'Card a' }]);
    expect(() => act(state, { type: 'DELETE_CARD', playerId: 'bob', cardId: 'a' })).toThrow('Only the Host');
  });

  it('lets the Host choose what happens to a held copy of a deleted card', () => {
    const state = withPlayer(table([jailCard('j'), card('x', [pay(1)])], ['x']), 'ann', { heldCards: ['j'] });
    expect(() => act(state, { type: 'DELETE_CARD', playerId: 'ann', cardId: 'j' })).toThrow('choose whether');

    const removed = act(state, { type: 'DELETE_CARD', playerId: 'ann', cardId: 'j', held: 'remove' });
    expect(player(removed.state, 'ann').heldCards).toEqual([]);
    expect(removed.events).toContainEqual({ type: 'HELD_CARD_REMOVED', playerId: 'ann', cardId: 'j', title: 'Card j' });

    // Kept until used, and then it is gone for good.
    const kept = act(state, { type: 'DELETE_CARD', playerId: 'ann', cardId: 'j', held: 'keep' }).state;
    expect(player(kept, 'ann').heldCards).toEqual(['j']);
    const used = useJailCard(kept).state;
    expect([player(used, 'ann').inJail, player(used, 'ann').heldCards, pile(used)]).toEqual([false, [], ['x']]);
  });

  it('asks about held copies when disabling a held card too', () => {
    const j = jailCard('j');
    const state = withPlayer(table([j]), 'bob', { heldCards: ['j'] });
    expect(() => edit(state, j, { enabled: false })).toThrow('choose whether');
    expect(player(edit(state, j, { enabled: false }, 'remove').state, 'bob').heldCards).toEqual([]);
  });

  it('leaves an emptied Deck drawing nothing', () => {
    const state = table([card('a', [pay(10)])]);
    const empty = act(state, { type: 'DELETE_CARD', playerId: 'ann', cardId: 'a' }).state;
    const { state: after, events } = draw(empty);
    expect(events).toContainEqual({ type: 'DECK_EMPTY', playerId: 'ann', deck: 'chance' });
    expect(after.turn!.step).toBe('awaitEndTurn');
  });

  it('lets a card deleted while being resolved finish', () => {
    const state = table([card('a', [pay(10), pay(20)])]);
    const drawn = draw(state).state;
    const deleted = act(drawn, { type: 'DELETE_CARD', playerId: 'ann', cardId: 'a' }).state;
    const after = act(deleted, { type: 'CONTINUE_CARD', playerId: 'ann' }).state;
    expect(player(after, 'ann').cash).toBe(1500 - 30);
    expect(pile(after)).toEqual([]);
  });
});

const zeros: Rng = { int: () => 0 };

describe('whole Decks', () => {
  it('resets a Deck to the Default cards, reshuffled, leaving out copies Players hold', () => {
    const state = withPlayer(table([card('a', [pay(10)])]), 'bob', { heldCards: ['ch-10'] });
    const { state: after, events } = act(state, { type: 'RESET_DECK', playerId: 'ann', deck: 'chance' }, zeros);

    expect(after.decks.chance.cards).toEqual(defaultCards.chance);
    expect(pile(after)).toHaveLength(15);
    expect(pile(after)).not.toContain('ch-10');
    expect(player(after, 'bob').heldCards).toEqual(['ch-10']);
    expect(events).toEqual([{ type: 'DECK_RESET', deck: 'chance' }]);
  });

  it('shuffles the whole draw pile now', () => {
    const state = table([card('a', [pay(1)]), card('b', [pay(1)]), card('c', [pay(1)])]);
    const { state: after, events } = act(state, { type: 'SHUFFLE_DECK', playerId: 'ann', deck: 'chance' }, zeros);
    expect(pile(after)).toEqual(['b', 'c', 'a']);
    expect(events).toEqual([{ type: 'DECK_SHUFFLED', deck: 'chance' }]);
  });

  it('keeps every Deck action Host only', () => {
    const state = table([card('a', [pay(1)])]);
    for (const action of [
      { type: 'RESET_DECK', playerId: 'bob', deck: 'chance' },
      { type: 'SHUFFLE_DECK', playerId: 'bob', deck: 'chance' },
      { type: 'HIDE_DECK_CONTENTS', playerId: 'bob', hidden: true },
    ] as Action[]) {
      expect(() => act(state, action, zeros)).toThrow('Only the Host');
    }
  });
});

describe('hiding deck contents', () => {
  it('hides the Decks from everyone but the Host', () => {
    const state = table([card('a', [pay(1)])]);
    expect(viewFor(state, 'bob').decks).toEqual(state.decks);

    const { state: hidden, events } = act(state, { type: 'HIDE_DECK_CONTENTS', playerId: 'ann', hidden: true });
    expect(events).toEqual([{ type: 'DECK_CONTENTS_HIDDEN', hidden: true }]);
    expect(viewFor(hidden, 'ann').decks).toEqual(state.decks);
    expect(viewFor(hidden, 'bob').decks).toEqual({ chance: { cards: [], drawPile: [] }, treasure: { cards: [], drawPile: [] } });
    expect(viewFor(hidden, 'bob').players).toEqual(hidden.players);
  });

  it('announces card changes by title only', () => {
    const a = card('a', [pay(1)]);
    const hidden = act(table([a]), { type: 'HIDE_DECK_CONTENTS', playerId: 'ann', hidden: true }).state;
    const added = act(hidden, { type: 'ADD_CARD', playerId: 'ann', deck: 'chance', card: draft() }, zeros);
    expect(added.events).toEqual([{ type: 'CARD_ADDED', deck: 'chance', cardId: 'ch-02', title: 'Lucky find' }]);
    expect(edit(hidden, a, { text: 'Secret' }).events).toEqual([{ type: 'CARD_EDITED', deck: 'chance', cardId: 'a', title: 'Card a' }]);
  });
});
