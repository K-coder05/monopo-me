import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  defaultBoard,
  defaultRules,
  IllegalActionError,
  toPreset,
  validPreset,
  type Action,
  type CardDraft,
  type GameState,
  type Preset,
  type Rng,
} from './index';

/** An Rng that returns the given values in order (die faces are 0-based), then 0 forever. */
function script(...values: number[]): Rng {
  const queue = [...values];
  return { int: () => queue.shift() ?? 0 };
}

const zeros = script();

function act(state: GameState, action: Action, rng: Rng = zeros) {
  return applyAction(state, action, state.rules, rng, 0);
}

/** A Lobby with the given Players (`[id, name]`); the first one is the Host. */
function lobby(...players: [string, string][]): GameState {
  const [[hostId, hostName], ...rest] = players as [[string, string], ...[string, string][]];
  let state = createGame('ABCDE', { id: hostId, name: hostName, color: 'c0' }, structuredClone(defaultRules), structuredClone(defaultBoard));
  rest.forEach(([id, name], i) => {
    state = act(state, { type: 'JOIN_ROOM', playerId: id, name, color: `c${i + 1}` }).state;
  });
  return state;
}

const giveTo = (playerId: string): CardDraft => ({
  title: 'Gift',
  text: 'Give {amount} to {to}.',
  effects: [{ type: 'TRANSFER', amount: 100, from: 'drawer', to: { player: playerId } }],
  enabled: true,
  copies: 2,
});

/** A Room with edited Rules, Board and both Decks, including a card naming Bob. */
function edited(): GameState {
  let state = lobby(['ann', 'Ann'], ['bob', 'Bob']);
  state = act(state, { type: 'UPDATE_RULES', playerId: 'ann', changes: { goSalary: 400, bankHouses: 20 } }).state;
  state = act(state, { type: 'UPDATE_BOARD', playerId: 'ann', edits: [{ index: 1, name: 'Mud Lane', price: 70 }] }).state;
  state = act(state, { type: 'ADD_CARD', playerId: 'ann', deck: 'chance', card: giveTo('bob') }).state;
  state = act(state, { type: 'DELETE_CARD', playerId: 'ann', cardId: 'tr-02' }).state;
  return state;
}

const load = (state: GameState, preset: unknown, playerId = state.hostId) =>
  act(state, { type: 'LOAD_PRESET', playerId, preset: preset as Preset });

describe('Presets', () => {
  it('round-trip the Rules, Board and both Decks through save, export, import and load', () => {
    const source = edited();
    const preset = toPreset(source, 'House rules');
    const imported = validPreset(JSON.parse(JSON.stringify(preset)));
    expect(imported).toEqual(preset);

    // Another Room, where Bob has a different id: the card follows Bob by name.
    const target = lobby(['cy', 'Cy'], ['bob-2', 'Bob']);
    const { state } = load(target, imported);
    const bobCard = (s: GameState) => s.decks.chance.cards.find((c) => c.title === 'Gift')!;

    expect(state.rules).toEqual(source.rules);
    expect(state.board).toEqual(source.board);
    expect(state.decks.treasure.cards).toEqual(source.decks.treasure.cards);
    expect(bobCard(state)).toEqual({ ...bobCard(source), effects: [{ ...giveTo('bob-2').effects[0] }] });
    expect(toPreset(state, 'House rules')).toEqual(preset);
  });

  it('contain no game state, and loading one leaves the game state alone', () => {
    let state = inAuction(edited());
    state = { ...state, deeds: { 1: { ownerId: 'bob', buildings: 2, mortgaged: false } }, bank: { jackpot: 75 } };
    const preset = toPreset(state, 'Mid-game');

    expect(Object.keys(preset).sort()).toEqual(['board', 'cards', 'name', 'rules']);
    expect(JSON.stringify(preset)).not.toMatch(/deeds|cash|position|jackpot|heldCards|drawPile|"bob"/);

    const loaded = load(state, preset).state;
    for (const key of ['players', 'deeds', 'turn', 'auction', 'debts', 'bank'] as const) expect(loaded[key]).toEqual(state[key]);
  });

  it('load mid-game like any edit: Decks at once, Rules and Board once the Auction ends, all logged', () => {
    const preset = toPreset(edited(), 'House rules');
    const queued = load(inAuction(lobby(['ann', 'Ann'], ['bob', 'Bob'])), preset);

    expect(queued.events).toEqual([{ type: 'PRESET_LOADED', name: 'House rules', flaggedCards: 0 }, { type: 'CHANGES_QUEUED' }]);
    expect(queued.state.decks.chance.cards.map((c) => c.title)).toContain('Gift');
    expect(queued.state.rules.goSalary).toBe(200);
    expect(queued.state.log.at(-1)!.event).toEqual({ type: 'CHANGES_QUEUED' });

    let state = act(queued.state, { type: 'PASS_AUCTION', playerId: 'ann' }).state;
    const ended = act(state, { type: 'PASS_AUCTION', playerId: 'bob' });
    state = ended.state;
    expect(state.rules.goSalary).toBe(400);
    expect(state.board[1]!.name).toBe('Mud Lane');
    expect(ended.events).toContainEqual({ type: 'RULE_CHANGED', key: 'goSalary', from: 200, to: 400 });
    expect(ended.events).toContainEqual({ type: 'SPACE_CHANGED', index: 1, field: 'name', from: 'Brown 1', to: 'Mud Lane' });
    // Marks the batch, so the Rules and Board changes are announced as one Preset, not value by value.
    expect(ended.events).toContainEqual({ type: 'PRESET_APPLIED', name: 'House rules' });
  });

  it('announce an immediate load once, with no separate applied entry', () => {
    const { events } = load(lobby(['ann', 'Ann'], ['bob', 'Bob']), toPreset(edited(), 'House rules'));
    expect(events[0]).toEqual({ type: 'PRESET_LOADED', name: 'House rules', flaggedCards: 0 });
    expect(events.map((e) => e.type)).not.toContain('PRESET_APPLIED');
  });

  describe('a card naming a Player missing from the Room', () => {
    /** A Room with Ann and Cy, loaded with a Preset whose only Chance card names Bob (2 copies). */
    function loaded() {
      const preset = toPreset(edited(), 'House rules');
      const onlyGift = { ...preset, cards: preset.cards.filter((c) => c.deck === 'treasure' || c.title === 'Gift') };
      return load(lobby(['ann', 'Ann'], ['cy', 'Cy']), onlyGift);
    }
    const gift = (state: GameState) => state.decks.chance.cards[0]!;
    const editGift = (state: GameState, patch: Partial<CardDraft>) =>
      act(state, { type: 'EDIT_CARD', playerId: 'ann', cardId: gift(state).id, card: { ...giveTo('cy'), ...patch, effects: patch.effects ?? gift(state).effects } });

    it('is flagged and cannot be drawn', () => {
      const { state, events } = loaded();
      expect(events[0]).toEqual({ type: 'PRESET_LOADED', name: 'House rules', flaggedCards: 1 });
      expect(gift(state).effects[0]).toMatchObject({ to: { playerName: 'Bob' } });
      expect(state.decks.chance.drawPile).toEqual([]);

      // Ann rolls 3 + 4 onto the Chance space at index 7.
      const started = act(state, { type: 'START_GAME', playerId: 'ann' }, script(5, 4, 0, 1)).state;
      expect(started.decks.chance.drawPile).toEqual([]);
      const rolled = act(started, { type: 'ROLL_DICE', playerId: 'ann' }, script(2, 3));
      expect(rolled.events).toContainEqual({ type: 'DECK_EMPTY', playerId: 'ann', deck: 'chance' });
    });

    it('goes into play once the Host picks a Player for it', () => {
      const { state, events } = editGift(loaded().state, { effects: giveTo('cy').effects });
      expect(gift(state).effects[0]).toMatchObject({ to: { player: 'cy' } });
      expect(state.decks.chance.drawPile).toEqual([gift(state).id, gift(state).id]);
      expect(events.map((e) => e.type)).toContain('CARD_EDITED');
    });

    it('can be disabled instead, and stays out of play until retargeted even if enabled again', () => {
      let state = editGift(loaded().state, { enabled: false }).state;
      expect(gift(state)).toMatchObject({ enabled: false, effects: [{ to: { playerName: 'Bob' } }] });
      state = editGift(state, { enabled: true }).state;
      expect(state.decks.chance.drawPile).toEqual([]);
    });

    it('cannot be copied or have a missing Player added to another card', () => {
      const state = loaded().state;
      const copy = { ...giveTo('cy'), effects: gift(state).effects };
      expect(() => act(state, { type: 'ADD_CARD', playerId: 'ann', deck: 'chance', card: copy })).toThrow(IllegalActionError);
      const other = state.decks.treasure.cards[0]!;
      expect(() =>
        act(state, { type: 'EDIT_CARD', playerId: 'ann', cardId: other.id, card: { ...giveTo('cy'), effects: gift(state).effects } }),
      ).toThrow(IllegalActionError);
    });

    it('is flagged when two Players share the name', () => {
      const preset = toPreset(edited(), 'House rules');
      const twoBobs = load(lobby(['ann', 'Ann'], ['bob-1', 'Bob'], ['bob-2', 'Bob']), preset);
      expect(twoBobs.events[0]).toMatchObject({ flaggedCards: 1 });
    });
  });

  it('contain no Monopoly name', () => {
    for (const state of [lobby(['ann', 'Ann'], ['bob', 'Bob']), edited()]) {
      expect(JSON.stringify(toPreset(state, 'Classic'))).not.toMatch(/monopoly/i);
    }
  });

  it('can only be loaded by the Host, and refuse a damaged file', () => {
    const state = lobby(['ann', 'Ann'], ['bob', 'Bob']);
    const preset = toPreset(state, 'Plain');
    expect(() => load(state, preset, 'bob')).toThrow(IllegalActionError);

    const broken = (patch: (p: Record<string, any>) => void) => {
      const copy = structuredClone(preset) as Record<string, any>;
      patch(copy);
      return () => validPreset(copy);
    };
    expect(broken((p) => (p.name = ' '))).toThrow(/name/);
    expect(broken((p) => delete p.rules.goSalary)).toThrow(/goSalary is missing/);
    expect(broken((p) => (p.rules.minPlayers = 1))).toThrow(/minPlayers/);
    expect(broken((p) => (p.rules.jailFine = -5))).toThrow(/jailFine/);
    expect(broken((p) => p.board.pop())).toThrow(/40 spaces/);
    expect(broken((p) => (p.board[1].type = 'tax'))).toThrow(/Space 1/);
    expect(broken((p) => (p.board[1].rents = [1, 2]))).toThrow(/Space 1: rents/);
    expect(broken((p) => (p.cards[1].id = p.cards[0].id))).toThrow(/Two cards/);
    expect(broken((p) => (p.cards[0].effects = [{ type: 'EXPLODE' }]))).toThrow(/Card ch-01/);
    expect(broken((p) => (p.cards[0].effects[0].target = { player: 'ann' }))).toThrow(/Card ch-01/);
    expect(() => validPreset('nope')).toThrow(IllegalActionError);
  });
});

/** Starts the game (Ann first), then Ann lands on unowned Brown 2 and declines: an Auction is open. */
function inAuction(state: GameState): GameState {
  state = act(state, { type: 'START_GAME', playerId: 'ann' }, script(5, 4, 0, 1)).state;
  state = act(state, { type: 'ROLL_DICE', playerId: 'ann' }, script(0, 1)).state;
  state = act(state, { type: 'DECLINE_PROPERTY', playerId: 'ann' }).state;
  expect(state.turn!.step).toBe('auction');
  return state;
}
