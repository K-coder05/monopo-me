import { appendLog, IllegalActionError } from './engine';
import { applyPending } from './edits';
import { wantedCopies } from './cardEdits';
import type { Action, ActionResult, Deck, DeckKind, GameEvent, GameState } from './types';

/** Undo: stepping back over game actions and Overrides, never over Host edits (build spec §5). */

export const UNDO_LIMIT = 20;

/** Host edits to Rules, the Board and the Decks: Undo steps over them and never takes them back. */
const EDITS = new Set<Action['type']>([
  'UPDATE_RULES',
  'UPDATE_BOARD',
  'RESET_TO_DEFAULTS',
  'ADD_CARD',
  'EDIT_CARD',
  'DELETE_CARD',
  'RESET_DECK',
  'SHUFFLE_DECK',
  'HIDE_DECK_CONTENTS',
  'LOAD_PRESET',
]);

/**
 * The Undo history after `action` took the game from `before` to `after`: the snapshots of game
 * state, oldest first, that the server keeps beside a Room's GameState. A game action or Override
 * during a game adds `before`, keeping the last UNDO_LIMIT; a return to the Lobby starts afresh.
 */
export function recordUndo(history: GameState[], before: GameState, after: GameState, action: Action): GameState[] {
  if (after.phase === 'lobby' || action.type === 'REMATCH') return [];
  if (before.phase !== 'playing' || EDITS.has(action.type)) return history;
  // The log is never rewound, so snapshots leave it out.
  return [...history, { ...before, log: [] }].slice(-UNDO_LIMIT);
}

/**
 * Host only: restores the game state of the last snapshot. The Rules, Board and Decks stay as
 * they are now, the log carries on, and randomness is not rewound. An Auction it goes back into
 * gets a fresh countdown from `now`.
 */
export function undo(state: GameState, history: GameState[], playerId: string, now: number): ActionResult & { history: GameState[] } {
  if (playerId !== state.hostId) throw new IllegalActionError('Only the Host can Undo');
  const snapshot = history[history.length - 1];
  if (state.phase === 'lobby' || !snapshot) throw new IllegalActionError('Nothing to undo');

  const events: GameEvent[] = [{ type: 'UNDONE' }];
  let restored: GameState = {
    ...snapshot,
    hostId: state.hostId,
    rules: state.rules,
    board: state.board,
    pendingEdit: state.pendingEdit,
    rulesChangedMidGame: state.rulesChangedMidGame,
    decksHidden: state.decksHidden,
    decks: state.decks,
    auction: snapshot.auction && { ...snapshot.auction, endsAt: now + state.rules.auctionSeconds * 1000 },
    log: state.log,
  };
  restored = withHeldCardsInPlay(restored, state);
  for (const kind of ['chance', 'treasure'] as const) restored = withSettledPile(restored, kind);
  // Edits waiting for an action the Undo went back past now apply.
  restored = applyPending(restored, events, false);
  return { state: appendLog(restored, events), events, history: history.slice(0, -1) };
}

/**
 * The snapshot's held cards, less any copy that is in play nowhere now: one the Host has since
 * taken out of a Player's hand by deleting or editing its card.
 */
function withHeldCardsInPlay(restored: GameState, current: GameState): GameState {
  const left = new Map<string, number>();
  const piles = [...current.decks.chance.drawPile, ...current.decks.treasure.drawPile];
  for (const id of [...piles, ...current.players.flatMap((p) => p.heldCards)]) left.set(id, (left.get(id) ?? 0) + 1);
  const players = restored.players.map((p) => ({
    ...p,
    heldCards: p.heldCards.filter((id) => {
      const n = left.get(id) ?? 0;
      left.set(id, n - 1);
      return n > 0;
    }),
  }));
  return { ...restored, players };
}

/**
 * The Deck's current draw pile, so Undo takes back no card edit or shuffle and a drawn card stays
 * drawn, with each card's copies brought back in line with the restored hands: a copy no Player
 * holds any more goes to the bottom, and one a Player holds again leaves the pile.
 */
function withSettledPile(state: GameState, kind: DeckKind): GameState {
  const { cards, drawPile } = state.decks[kind];
  const held = state.players.flatMap((p) => p.heldCards);
  let pile = drawPile;
  for (const card of cards) {
    const inPile = pile.filter((id) => id === card.id).length;
    const surplus = inPile + held.filter((id) => id === card.id).length - wantedCopies(card);
    if (surplus < 0) {
      pile = [...pile, ...Array<string>(-surplus).fill(card.id)];
    } else if (surplus > 0) {
      let extra = Math.min(surplus, inPile);
      pile = pile.filter((id) => id !== card.id || extra-- <= 0);
    }
  }
  const deck: Deck = { cards, drawPile: pile };
  return { ...state, decks: { ...state.decks, [kind]: deck } };
}
