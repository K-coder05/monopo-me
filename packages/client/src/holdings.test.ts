import { describe, expect, it } from 'vitest';
import { createGame, defaultBoard, defaultCards, defaultRules, type GameState } from '@landlord/engine';
import { holdingsOf } from './holdings';

/** A Room where ann holds the given Deeds and kept cards; the Decks hold the default cards. */
function gameWith(deeds: Record<number, string>, heldCards: string[] = []): GameState {
  const game = createGame('ABCDE', { id: 'ann', name: 'ann', color: 'red' }, defaultRules, defaultBoard, {
    chance: { cards: defaultCards.chance, drawPile: [] },
    treasure: { cards: defaultCards.treasure, drawPile: [] },
  });
  return {
    ...game,
    players: game.players.map((p) => ({ ...p, heldCards })),
    deeds: Object.fromEntries(
      Object.entries(deeds).map(([index, ownerId]) => [index, { ownerId, buildings: 0, mortgaged: false }]),
    ),
  };
}

const names = (game: GameState) => holdingsOf(game, 'ann').groups.map((g) => [g.group, g.spaces.map((s) => s.name)]);

describe('holdingsOf', () => {
  it('is empty for a Player who owns nothing and holds no cards', () => {
    expect(holdingsOf(gameWith({}), 'ann')).toEqual({ groups: [], cards: [] });
  });

  it('groups owned properties by Colour group in Board order, with stations and utilities as their own groups', () => {
    const game = gameWith({ 39: 'ann', 5: 'ann', 1: 'ann', 12: 'ann', 3: 'ann' });
    expect(names(game)).toEqual([
      ['brown', [defaultBoard[1]!.name, defaultBoard[3]!.name]],
      ['station', [defaultBoard[5]!.name]],
      ['utility', [defaultBoard[12]!.name]],
      ['darkBlue', [defaultBoard[39]!.name]],
    ]);
  });

  it("leaves out other Players' properties", () => {
    expect(names(gameWith({ 1: 'bob', 3: 'ann' }))).toEqual([['brown', [defaultBoard[3]!.name]]]);
  });

  it('says whether the Player holds the whole Colour group', () => {
    const game = gameWith({ 1: 'ann', 3: 'ann', 6: 'ann' });
    expect(holdingsOf(game, 'ann').groups.map((g) => [g.group, g.complete])).toEqual([
      ['brown', true],
      ['lightBlue', false],
    ]);
  });

  it('shows each held card with its title and text', () => {
    const game = gameWith({}, ['ch-10', 'tr-05']);
    const chance = defaultCards.chance.find((c) => c.id === 'ch-10')!;
    const treasure = defaultCards.treasure.find((c) => c.id === 'tr-05')!;
    expect(holdingsOf(game, 'ann').cards).toEqual([
      { key: '0-ch-10', deck: 'chance', title: chance.title, text: chance.text },
      { key: '1-tr-05', deck: 'treasure', title: treasure.title, text: treasure.text },
    ]);
  });

  it('still shows a held card the Player cannot look up (Deck contents hidden, or the card deleted)', () => {
    const game = { ...gameWith({}, ['ch-10', 'ch-10']), decks: { chance: { cards: [], drawPile: [] }, treasure: { cards: [], drawPile: [] } } };
    expect(holdingsOf(game, 'ann').cards).toEqual([
      { key: '0-ch-10', title: 'Jail card', text: 'Use it to leave Jail for free.' },
      { key: '1-ch-10', title: 'Jail card', text: 'Use it to leave Jail for free.' },
    ]);
  });

  it('is empty for a Spectator', () => {
    expect(holdingsOf(gameWith({ 1: 'ann' }, ['ch-10']), 'someone-else')).toEqual({ groups: [], cards: [] });
  });
});
