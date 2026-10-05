import { isKeepable, mapParties, missingPlayers, replaceDeck, validDeck, validDraft, type CardContext } from './cardEdits';
import { defaultBoard } from './defaults';
import { EDITABLE_RULES, stagePreset, validFullBoard, validFullRules } from './edits';
import { IllegalActionError } from './engine';
import { MAX_NAME_LENGTH } from './protocol';
import type { Card, DeckKind, GameEvent, GameState, PartySelector, Preset, PresetRules, Rng } from './types';

/** Presets: named copies of Rules, Board and both Decks, with no game state (build spec §5, §6). */

export const MAX_PRESET_NAME = 40;
const MAX_CARDS_PER_DECK = 60;
const DECKS: DeckKind[] = ['chance', 'treasure'];

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validPresetName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name.length < 1 || name.length > MAX_PRESET_NAME) throw new IllegalActionError(`A Preset name must be 1–${MAX_PRESET_NAME} characters`);
  return name;
}

/** The Room's current Rules, Board and both Decks as a Preset, with named Players stored by display name. */
export function toPreset(state: GameState, name: unknown): Preset {
  const names = new Map(state.players.map((p) => [p.id, p.name]));
  const byName = (party: PartySelector): PartySelector =>
    typeof party === 'object' && 'player' in party ? { playerName: names.get(party.player) ?? 'Unknown player' } : party;
  const rules = Object.fromEntries(EDITABLE_RULES.map((key) => [key, state.rules[key]])) as PresetRules;
  const cards = DECKS.flatMap((deck) => state.decks[deck].cards).map((card) => ({ ...card, effects: card.effects.map((e) => mapParties(e, byName)) }));
  return structuredClone({ name: validPresetName(name), rules, board: state.board, cards });
}

/** A Preset's cards may name any Player by display name, and no Player by id. */
const presetContext: CardContext = {
  boardSize: defaultBoard.length,
  hasPlayer: () => false,
  keepsName: (name) => name.trim().length >= 1 && name.length <= MAX_NAME_LENGTH,
};

function validCards(raw: unknown): Card[] {
  if (!Array.isArray(raw)) throw new IllegalActionError('The cards must be a list');
  const ids = new Set<string>();
  const cards = raw.map((item: unknown): Card => {
    if (!isPlainObject(item)) throw new IllegalActionError('Each card must be an object');
    const { id } = item;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,20}$/.test(id)) throw new IllegalActionError('Each card needs an id of 1–20 letters, digits, - or _');
    if (ids.has(id)) throw new IllegalActionError(`Two cards have the id ${id}`);
    ids.add(id);
    const deck = validDeck(item.deck);
    let fields;
    try {
      fields = validDraft(presetContext, item);
    } catch (err) {
      if (err instanceof IllegalActionError) throw new IllegalActionError(`Card ${id}: ${err.message}`);
      throw err;
    }
    return { id, deck, ...fields, keepable: isKeepable(fields) };
  });
  for (const deck of DECKS) {
    if (cards.filter((c) => c.deck === deck).length > MAX_CARDS_PER_DECK) {
      throw new IllegalActionError(`A deck can hold at most ${MAX_CARDS_PER_DECK} cards`);
    }
  }
  return cards;
}

/** Checks a Preset from an untrusted source (an imported file, or one read back from disk). */
export function validPreset(raw: unknown): Preset {
  if (!isPlainObject(raw)) throw new IllegalActionError('A Preset must be an object');
  return {
    name: validPresetName(raw.name),
    rules: validFullRules(raw.rules),
    board: validFullBoard(raw.board),
    cards: validCards(raw.cards),
  };
}

/**
 * Loads a Preset into the Room. The Rules and Board are staged like any Rules edit (so they wait
 * for a running Auction, Debt or Card); both Decks are replaced at once, like any card edit.
 * Named Players are matched by display name; a card naming a Player not in the Room (or a name
 * two Players share) keeps the name and stays out of the draw pile until the Host fixes it.
 */
export function loadPreset(state: GameState, playerId: string, raw: unknown, rng: Rng, events: GameEvent[]): GameState {
  if (playerId !== state.hostId) throw new IllegalActionError('Only the Host can load a Preset');
  const preset = validPreset(raw);
  const link = (party: PartySelector): PartySelector => {
    if (typeof party !== 'object' || !('playerName' in party)) return party;
    const matches = state.players.filter((p) => p.name === party.playerName);
    return matches.length === 1 ? { player: matches[0]!.id } : party;
  };
  const cards = preset.cards.map((card) => ({ ...card, effects: card.effects.map((e) => mapParties(e, link)) }));
  const flaggedCards = cards.filter((c) => c.enabled && missingPlayers(c).length > 0).length;
  events.push({ type: 'PRESET_LOADED', name: preset.name, flaggedCards });

  let next = stagePreset(state, preset.name, preset.rules, preset.board);
  for (const deck of DECKS) next = replaceDeck(next, deck, cards.filter((c) => c.deck === deck), rng);
  return next;
}
