import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  defaultBoard,
  defaultRules,
  IllegalActionError,
  recordUndo,
  undo,
  UNDO_LIMIT,
  type Action,
  type Card,
  type GameState,
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

/** A Room's state with the Undo history the server keeps beside it. */
type Room = { state: GameState; history: GameState[] };

function play(room: Room, action: Action, rng: Rng = script(), now = 0): Room {
  const { state } = applyAction(room.state, action, room.state.rules, rng, now);
  return { state, history: recordUndo(room.history, room.state, state, action) };
}

function undone(room: Room, by = 'ann', now = 0): Room {
  const { state, history } = undo(room.state, room.history, by, now);
  return { state, history };
}

function withPlayer(state: GameState, id: string, patch: Partial<Player>): GameState {
  return { ...state, players: state.players.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

const player = (state: GameState, id: string) => state.players.find((p) => p.id === id)!;

const chanceCard = (id: string): Card => ({
  id, deck: 'chance', title: id, text: '', effects: [{ type: 'TRANSFER', amount: 10, from: 'bank', to: 'drawer' }],
  keepable: false, enabled: true, copies: 1,
});

/** ann (the Host) and bob, ann to roll from GO. */
function table(): Room {
  let state = createGame('ABCDE', { id: 'ann', name: 'ann', color: 'c0' }, defaultRules, defaultBoard);
  state = applyAction(state, { type: 'JOIN_ROOM', playerId: 'bob', name: 'bob', color: 'c1' }, defaultRules, script(), 0).state;
  state = applyAction(state, { type: 'START_GAME', playerId: 'ann' }, defaultRules, script(5, 5, 4, 4), 0).state;
  return { state, history: [] };
}

const roll = (room: Room, by: string, ...faces: number[]) => play(room, { type: 'ROLL_DICE', playerId: by }, dice(...faces));

describe('Undo', () => {
  it('restores the state before the last game action, and logs it', () => {
    // ann rolls 1 + 2 onto Baltic Avenue (3) and is offered it.
    const rolled = roll(table(), 'ann', 1, 2);

    const { state } = undone(rolled);

    expect(player(state, 'ann').position).toBe(0);
    expect(state.turn).toMatchObject({ playerId: 'ann', step: 'awaitRoll' });
    // The log keeps the roll and adds the Undo.
    expect(state.log.map((e) => e.event.type).slice(-4)).toEqual(['DICE_ROLLED', 'MOVED', 'PROPERTY_OFFERED', 'UNDONE']);
  });

  it('restores the state before an Override', () => {
    const adjusted = play(table(), {
      type: 'HOST_OVERRIDE',
      playerId: 'ann',
      override: { kind: 'ADJUST_CASH', playerId: 'bob', amount: 100 },
    });

    expect(player(undone(adjusted).state, 'bob').cash).toBe(1500);
  });

  it('steps back repeatedly, up to 20 steps', () => {
    let room = table();
    for (let i = 0; i < UNDO_LIMIT + 5; i++) {
      room = play(room, { type: 'HOST_OVERRIDE', playerId: 'ann', override: { kind: 'ADJUST_CASH', playerId: 'bob', amount: 1 } });
    }
    expect(player(room.state, 'bob').cash).toBe(1525);
    expect(room.history).toHaveLength(UNDO_LIMIT);

    for (let i = 0; i < UNDO_LIMIT; i++) room = undone(room);

    expect(player(room.state, 'bob').cash).toBe(1505);
    expect(() => undone(room)).toThrow('Nothing to undo');
  });

  it('leaves Rules, Board and card edits alone', () => {
    let room = roll(table(), 'ann', 1, 2);
    room = play(room, { type: 'UPDATE_RULES', playerId: 'ann', changes: { goSalary: 400 } });
    room = play(room, { type: 'UPDATE_BOARD', playerId: 'ann', edits: [{ index: 1, name: 'Old Kent Road' }] });
    room = play(room, {
      type: 'ADD_CARD',
      playerId: 'ann',
      deck: 'chance',
      card: { title: 'New', text: '', effects: [{ type: 'MANUAL' }], enabled: true, copies: 1 },
    });
    // The edits are not steps of their own: one Undo goes back past the roll.
    expect(room.history).toHaveLength(1);

    const { state } = undone(room);

    expect(player(state, 'ann').position).toBe(0);
    expect(state.rules.goSalary).toBe(400);
    expect(state.board[1]?.name).toBe('Old Kent Road');
    const added = state.decks.chance.cards.find((c) => c.title === 'New')!;
    expect(state.decks.chance.drawPile).toContain(added.id);
  });

  /** ann at 4 with Chance holding `cards` (top first), about to roll 1 + 2 onto Chance (7). */
  const withChance = (cards: Card[]): Room => {
    const room = table();
    const chance = { cards, drawPile: cards.map((c) => c.id) };
    return { ...room, state: withPlayer({ ...room.state, decks: { ...room.state.decks, chance } }, 'ann', { position: 4 }) };
  };

  it('leaves the Decks as they are now: a drawn card stays drawn, and shuffles and deletions stay', () => {
    const [a, b, c] = [chanceCard('a'), chanceCard('b'), chanceCard('c')];
    let room = roll(withChance([a, b, c]), 'ann', 1, 2);
    expect(room.state.decks.chance.drawPile).toEqual(['b', 'c', 'a']);
    // A shuffle to c, a, b; the snapshot before the roll had a, b, c.
    room = play(room, { type: 'SHUFFLE_DECK', playerId: 'ann', deck: 'chance' }, script(0, 0));
    expect(room.state.decks.chance.drawPile).toEqual(['c', 'a', 'b']);
    room = play(room, { type: 'DELETE_CARD', playerId: 'ann', cardId: 'a' });

    const { state } = undone(room);

    expect(state.decks.chance.cards.map((card) => card.id)).toEqual(['b', 'c']);
    expect(state.decks.chance.drawPile).toEqual(['c', 'b']);
  });

  it('returns a kept card it takes back from a Player to the bottom of its Deck', () => {
    const jail: Card = { ...chanceCard('j'), effects: [{ type: 'GET_OUT_OF_JAIL' }], keepable: true };
    let room = roll(withChance([jail, chanceCard('b')]), 'ann', 1, 2);
    room = play(room, { type: 'CONTINUE_CARD', playerId: 'ann' });
    expect(player(room.state, 'ann').heldCards).toEqual(['j']);

    const { state } = undone(room);

    expect(player(state, 'ann').heldCards).toEqual([]);
    expect(state.decks.chance.drawPile).toEqual(['b', 'j']);
  });

  it('does not give back a held card the Host has since taken away', () => {
    const jail: Card = { ...chanceCard('j'), effects: [{ type: 'GET_OUT_OF_JAIL' }], keepable: true };
    let room = withChance([chanceCard('b')]);
    room = { ...room, state: withPlayer({ ...room.state, decks: { ...room.state.decks, chance: { cards: [jail, chanceCard('b')], drawPile: ['b'] } } }, 'bob', { heldCards: ['j'] }) };
    room = roll(room, 'ann', 1, 2);
    room = play(room, { type: 'DELETE_CARD', playerId: 'ann', cardId: 'j', held: 'remove' });

    const { state } = undone(room);

    expect(player(state, 'bob').heldCards).toEqual([]);
    expect(state.decks.chance.drawPile).toEqual(['b']);
  });

  it('does not rewind randomness: a re-roll can come up differently', () => {
    const first = roll(table(), 'ann', 1, 2);

    const again = roll(undone(first), 'ann', 3, 3);

    expect(player(again.state, 'ann').position).toBe(6);
  });

  it('restarts the countdown of an Auction it goes back into', () => {
    let room = roll(table(), 'ann', 1, 2);
    room = play(room, { type: 'DECLINE_PROPERTY', playerId: 'ann' }, script(), 1_000);
    room = play(room, { type: 'PLACE_BID', playerId: 'bob', amount: 20 }, script(), 2_000);

    const { state } = undone(room, 'ann', 50_000);

    expect(state.auction?.highBid).toBeUndefined();
    expect(state.auction?.endsAt).toBe(50_000 + defaultRules.auctionSeconds * 1000);
  });

  it('is for the Host only', () => {
    const rolled = roll(table(), 'ann', 1, 2);

    expect(() => undone(rolled, 'bob')).toThrow(IllegalActionError);
  });

  it('starts afresh for a new game', () => {
    let room = roll(table(), 'ann', 1, 2);
    room = { ...room, state: { ...room.state, phase: 'finished', turn: undefined, winnerId: 'ann' } };

    expect(play(room, { type: 'BACK_TO_LOBBY', playerId: 'ann' }).history).toEqual([]);
  });
});
