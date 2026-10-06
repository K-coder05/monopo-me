import type { DeckKind, GameState, SpaceDefinition } from '@landlord/engine';

export type HandGroup = {
  /** The Colour group; stations and utilities each form their own. */
  group: string;
  /** Owned spaces in this group, in Board order. */
  spaces: SpaceDefinition[];
  /** True when the Player owns every space in the group. */
  complete: boolean;
};

export type HandCard = {
  /** Unique within the hand: a Player can hold two copies of one card. */
  key: string;
  /** Unknown when the Player cannot look the card up. */
  deck?: DeckKind;
  title: string;
  text: string;
};

/** What a Player holds: their properties grouped by Colour group, and their kept cards. */
export type Holdings = { groups: HandGroup[]; cards: HandCard[] };

/** Only keepable cards can be held, and every keepable card gets a Player out of Jail. */
const UNKNOWN_CARD = { title: 'Jail card', text: 'Use it to leave Jail for free.' };

const groupOf = (s: SpaceDefinition) => s.group ?? s.type;

export function holdingsOf(game: GameState, playerId: string): Holdings {
  const player = game.players.find((p) => p.id === playerId);
  if (!player) return { groups: [], cards: [] };

  const groups = new Map<string, SpaceDefinition[]>();
  for (const s of game.board) {
    if (game.deeds[s.index]?.ownerId !== playerId) continue;
    groups.set(groupOf(s), [...(groups.get(groupOf(s)) ?? []), s]);
  }

  const cards = player.heldCards.map((id, i): HandCard => {
    // Card details are missing when the Deck contents are hidden or the Host deleted a held card.
    const card = game.decks.chance.cards.find((c) => c.id === id) ?? game.decks.treasure.cards.find((c) => c.id === id);
    const key = `${i}-${id}`;
    return card ? { key, deck: card.deck, title: card.title, text: card.text } : { key, ...UNKNOWN_CARD };
  });

  return {
    groups: [...groups].map(([group, spaces]) => ({
      group,
      spaces,
      complete: game.board.filter((s) => groupOf(s) === group).every((s) => game.deeds[s.index]?.ownerId === playerId),
    })),
    cards,
  };
}
