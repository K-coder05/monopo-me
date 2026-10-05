import { defaultCards } from './defaults';
import { buildDeck, IllegalActionError, shuffle } from './engine';
import type { Card, CardDraft, DeckKind, Effect, GameEvent, GameState, HeldCardChoice, PartySelector, Rng } from './types';

/** Host edits to the Chance and Treasure Decks: validation and mid-game behaviour (build spec §6). */

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isNumberIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

const MAX_TITLE = 40;
const MAX_TEXT = 300;
const MAX_EFFECTS = 10;
const MAX_COPIES = 10;

const SELECTORS = ['drawer', 'bank', 'allOthers', 'everyone', 'drawerChoice', 'random', 'richest', 'poorest', 'left', 'right'];

function requireHost(state: GameState, playerId: string) {
  if (playerId !== state.hostId) throw new IllegalActionError('Only the Host can change the cards');
}

function validParty(state: GameState, value: unknown, what: string, allowBank = true): PartySelector {
  if (typeof value === 'string' && SELECTORS.includes(value) && (allowBank || value !== 'bank')) return value as PartySelector;
  if (isPlainObject(value) && typeof value.player === 'string' && state.players.some((p) => p.id === value.player)) {
    return { player: value.player };
  }
  throw new IllegalActionError(`${what} must be a Player in the Room or one of the selectors`);
}

/** A whole number 0 or more, `dice`, `dice * N` or `percentOfCash(N)`. */
function validAmount(value: unknown): number | string {
  if (isInt(value, 0, 1_000_000)) return value;
  if (typeof value === 'string') {
    const expr = value.trim();
    if (/^dice(\s*\*\s*\d+(\.\d+)?)?$/.test(expr) || /^percentOfCash\(\s*\d+(\.\d+)?\s*\)$/.test(expr)) return expr;
  }
  throw new IllegalActionError('Amount must be a whole number, dice, dice * N or percentOfCash(N)');
}

/** Checks one Effect from an untrusted sender, keeping only the fields its type has. */
function validEffect(state: GameState, raw: unknown): Effect {
  if (!isPlainObject(raw)) throw new IllegalActionError('Each effect must be an object');
  const target = (): { target?: PartySelector } =>
    raw.target === undefined ? {} : { target: validParty(state, raw.target, 'The target', false) };
  switch (raw.type) {
    case 'TRANSFER':
      return {
        type: 'TRANSFER',
        amount: validAmount(raw.amount),
        from: validParty(state, raw.from, 'Who pays'),
        to: validParty(state, raw.to, 'Who receives'),
      };
    case 'MOVE_TO':
      if (!isInt(raw.index, 0, state.board.length - 1)) throw new IllegalActionError('Move to: no such space');
      return { type: 'MOVE_TO', index: raw.index, collectGo: raw.collectGo === true, ...target() };
    case 'MOVE_RELATIVE':
      if (!isInt(raw.steps, -(state.board.length - 1), state.board.length - 1) || raw.steps === 0) {
        throw new IllegalActionError(`Move by: steps must be a whole number from -${state.board.length - 1} to ${state.board.length - 1}, not 0`);
      }
      return { type: 'MOVE_RELATIVE', steps: raw.steps, ...target() };
    case 'MOVE_TO_NEAREST': {
      if (raw.kind !== 'station' && raw.kind !== 'utility') throw new IllegalActionError('Move to nearest: pick station or utility');
      const effect: Effect = { type: 'MOVE_TO_NEAREST', kind: raw.kind, ...target() };
      for (const key of ['rentMultiplier', 'diceMultiplier'] as const) {
        if (raw[key] === undefined) continue;
        if (!isNumberIn(raw[key], 0, 100)) throw new IllegalActionError(`Move to nearest: ${key} must be a number from 0 to 100`);
        effect[key] = raw[key];
      }
      return effect;
    }
    case 'REPAIRS':
      if (!isInt(raw.perHouse, 0, 10_000) || !isInt(raw.perHotel, 0, 10_000)) {
        throw new IllegalActionError('Repairs: the cost per house and per hotel must be whole numbers, 0 or more');
      }
      return { type: 'REPAIRS', perHouse: raw.perHouse, perHotel: raw.perHotel, ...target() };
    case 'SKIP_TURNS':
      if (!isInt(raw.count, 1, 10)) throw new IllegalActionError('Skip turns: count must be a whole number from 1 to 10');
      return { type: 'SKIP_TURNS', count: raw.count, ...target() };
    case 'GO_TO_JAIL':
    case 'EXTRA_TURN':
    case 'SWAP_POSITION':
      return { type: raw.type, ...target() };
    case 'GET_OUT_OF_JAIL':
    case 'MANUAL':
      return { type: raw.type };
    default:
      throw new IllegalActionError(`${String(raw.type)} is not an effect type`);
  }
}

/** Checks a card form from an untrusted sender. */
function validDraft(state: GameState, raw: unknown): CardDraft {
  if (!isPlainObject(raw)) throw new IllegalActionError('The card must be an object');
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (title.length < 1 || title.length > MAX_TITLE) throw new IllegalActionError(`The title must be 1–${MAX_TITLE} characters`);
  if (typeof raw.text !== 'string' || raw.text.length > MAX_TEXT) throw new IllegalActionError(`The text must be at most ${MAX_TEXT} characters`);
  if (!Array.isArray(raw.effects) || raw.effects.length < 1 || raw.effects.length > MAX_EFFECTS) {
    throw new IllegalActionError(`A card needs 1–${MAX_EFFECTS} effects`);
  }
  if (!isInt(raw.copies, 1, MAX_COPIES)) throw new IllegalActionError(`Copies must be a whole number from 1 to ${MAX_COPIES}`);
  if (typeof raw.enabled !== 'boolean') throw new IllegalActionError('Enabled must be on or off');
  return { title, text: raw.text.trim(), effects: raw.effects.map((e) => validEffect(state, e)), enabled: raw.enabled, copies: raw.copies };
}

/** A get-out-of-jail card is kept by its drawer until used. */
const isKeepable = (fields: CardDraft) => fields.effects.some((e) => e.type === 'GET_OUT_OF_JAIL');

function validDeck(value: unknown): DeckKind {
  if (value !== 'chance' && value !== 'treasure') throw new IllegalActionError('No such deck');
  return value;
}

/** An id no card, held card or card being resolved uses, so a held copy of a deleted card never comes back to life. */
function newCardId(state: GameState, deck: DeckKind): string {
  const used = new Set([
    ...state.decks.chance.cards.map((c) => c.id),
    ...state.decks.treasure.cards.map((c) => c.id),
    ...state.players.flatMap((p) => p.heldCards),
    ...(state.turn?.cards.map((c) => c.cardId) ?? []),
  ]);
  const prefix = deck === 'chance' ? 'ch' : 'tr';
  for (let n = state.decks[deck].cards.length + 1; ; n++) {
    const id = `${prefix}-${String(n).padStart(2, '0')}`;
    if (!used.has(id)) return id;
  }
}

/** The card text for an announcement, or nothing while deck contents are hidden. */
const shownText = (state: GameState, card: Card) => (state.decksHidden ? {} : { text: card.text });

/** `pile` with `count` more copies of `id`, each at a random position. */
function insertCopies(pile: string[], id: string, count: number, rng: Rng): string[] {
  const out = [...pile];
  for (let i = 0; i < count; i++) out.splice(rng.int(out.length + 1), 0, id);
  return out;
}

function withDeck(state: GameState, deck: DeckKind, cards: Card[], drawPile: string[]): GameState {
  return { ...state, decks: { ...state.decks, [deck]: { cards, drawPile } } };
}

export function addCard(state: GameState, playerId: string, deckValue: unknown, raw: unknown, rng: Rng, events: GameEvent[]): GameState {
  requireHost(state, playerId);
  const deck = validDeck(deckValue);
  const fields = validDraft(state, raw);
  const card: Card = { id: newCardId(state, deck), deck, ...fields, keepable: isKeepable(fields) };
  const { cards, drawPile } = state.decks[deck];
  events.push({ type: 'CARD_ADDED', deck, cardId: card.id, title: card.title, ...shownText(state, card) });
  return withDeck(state, deck, [...cards, card], card.enabled ? insertCopies(drawPile, card.id, card.copies, rng) : drawPile);
}

function findCard(state: GameState, cardId: unknown): Card {
  const card = [...state.decks.chance.cards, ...state.decks.treasure.cards].find((c) => c.id === cardId);
  if (!card) throw new IllegalActionError('No such card');
  return card;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** How many copies of a card are in play: in its draw pile (drawn ones included) or held by Players. */
export function copiesInPlay(state: GameState, card: Card): number {
  const held = state.players.reduce((n, p) => n + p.heldCards.filter((id) => id === card.id).length, 0);
  return state.decks[card.deck].drawPile.filter((id) => id === card.id).length + held;
}

/** How many copies of a card should be in play: none while it is disabled. */
export const wantedCopies = (card: Card | undefined) => (card?.enabled ? card.copies : 0);

/**
 * Brings the copies of `card` in play to `wanted`: extra copies go into the draw pile at random;
 * surplus copies leave the draw pile from the top (so not-yet-drawn copies go first), then
 * Players' hands as `held` says.
 */
function settleCopies(state: GameState, card: Card, wanted: number, held: unknown, rng: Rng, events: GameEvent[]): GameState {
  const deck = state.decks[card.deck];
  const inPlay = copiesInPlay(state, card);
  if (inPlay < wanted) return withDeck(state, card.deck, deck.cards, insertCopies(deck.drawPile, card.id, wanted - inPlay, rng));

  let surplus = inPlay - wanted;
  const drawPile = deck.drawPile.filter((id) => {
    if (id !== card.id || surplus === 0) return true;
    surplus--;
    return false;
  });
  let next = withDeck(state, card.deck, deck.cards, drawPile);
  if (surplus === 0) return next;

  const choice = validHeldChoice(held);
  if (choice === 'keep') return next;
  return {
    ...next,
    players: next.players.map((p) => {
      if (surplus === 0 || !p.heldCards.includes(card.id)) return p;
      // A Player may hold more than one copy.
      const heldCards = p.heldCards.filter((id) => {
        if (id !== card.id || surplus === 0) return true;
        surplus--;
        events.push({ type: 'HELD_CARD_REMOVED', playerId: p.id, cardId: card.id, title: card.title });
        return false;
      });
      return { ...p, heldCards };
    }),
  };
}

/** The refusal when an edit touches a held card and `held` is missing; the client asks the Host and resends. */
export const HELD_CHOICE_NEEDED = 'A Player holds this card: choose whether they keep it until used or lose it now';

function validHeldChoice(held: unknown): HeldCardChoice {
  if (held !== 'keep' && held !== 'remove') throw new IllegalActionError(HELD_CHOICE_NEEDED);
  return held;
}

/**
 * Changes a card wherever it sits: its place in the pile and in Players' hands stays the same.
 * Changing copies or the enabled switch adds or takes away copies as `settleCopies` describes.
 */
export function editCard(
  state: GameState,
  playerId: string,
  cardId: unknown,
  raw: unknown,
  held: unknown,
  rng: Rng,
  events: GameEvent[],
): GameState {
  requireHost(state, playerId);
  const old = findCard(state, cardId);
  const fields = validDraft(state, raw);
  const card: Card = { ...old, ...fields, keepable: isKeepable(fields) };
  const { deck, id, title } = card;
  if (old.title !== card.title || old.text !== card.text || !same(old.effects, card.effects)) {
    events.push({ type: 'CARD_EDITED', deck, cardId: id, title, ...shownText(state, card) });
  }
  if (old.enabled !== card.enabled) events.push({ type: 'CARD_ENABLED_CHANGED', deck, cardId: id, title, enabled: card.enabled });
  if (old.copies !== card.copies) events.push({ type: 'CARD_COPIES_CHANGED', deck, cardId: id, title, from: old.copies, to: card.copies });
  const { cards, drawPile } = state.decks[deck];
  const edited = withDeck(state, deck, cards.map((c) => (c.id === id ? card : c)), drawPile);
  return settleCopies(edited, card, wantedCopies(card), held, rng, events);
}

/** Removes a card from its Deck and draw pile; held copies go as `held` says. */
export function deleteCard(state: GameState, playerId: string, cardId: unknown, held: unknown, rng: Rng, events: GameEvent[]): GameState {
  requireHost(state, playerId);
  const card = findCard(state, cardId);
  events.push({ type: 'CARD_DELETED', deck: card.deck, cardId: card.id, title: card.title });
  const next = settleCopies(state, card, 0, held, rng, events);
  const deck = next.decks[card.deck];
  return withDeck(next, card.deck, deck.cards.filter((c) => c.id !== card.id), deck.drawPile);
}

/** The Default cards for one Deck, reshuffled. Copies Players hold stay with them and out of the pile. */
export function resetDeck(state: GameState, playerId: string, deckValue: unknown, rng: Rng, events: GameEvent[]): GameState {
  requireHost(state, playerId);
  const deck = validDeck(deckValue);
  const { cards, drawPile } = buildDeck(structuredClone(defaultCards[deck]));
  const held = state.players.flatMap((p) => p.heldCards);
  const pile = drawPile.filter((id) => {
    const at = held.indexOf(id);
    if (at < 0) return true;
    held.splice(at, 1);
    return false;
  });
  events.push({ type: 'DECK_RESET', deck });
  return withDeck(state, deck, cards, shuffle(pile, rng));
}

export function shuffleDeck(state: GameState, playerId: string, deckValue: unknown, rng: Rng, events: GameEvent[]): GameState {
  requireHost(state, playerId);
  const deck = validDeck(deckValue);
  events.push({ type: 'DECK_SHUFFLED', deck });
  return withDeck(state, deck, state.decks[deck].cards, shuffle(state.decks[deck].drawPile, rng));
}

export function hideDeckContents(state: GameState, playerId: string, hidden: unknown, events: GameEvent[]): GameState {
  requireHost(state, playerId);
  if (typeof hidden !== 'boolean') throw new IllegalActionError('Hide deck contents must be on or off');
  if (hidden === !!state.decksHidden) return state;
  events.push({ type: 'DECK_CONTENTS_HIDDEN', hidden });
  return { ...state, decksHidden: hidden || undefined };
}

/** The state as `viewerId` may see it: with deck contents hidden, only the Host sees the Decks. */
export function viewFor(state: GameState, viewerId: string | undefined): GameState {
  if (!state.decksHidden || viewerId === state.hostId) return state;
  const none = { cards: [], drawPile: [] };
  return { ...state, decks: { chance: none, treasure: none } };
}
