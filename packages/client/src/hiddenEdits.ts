import type { GameEvent } from '@landlord/engine';

const HIDDEN_EDITS: GameEvent['type'][] = [
  'RULE_CHANGED',
  'SPACE_CHANGED',
  'DEFAULTS_RESTORED',
  'CHANGES_QUEUED',
  'PRESET_LOADED',
  'PRESET_APPLIED',
  'CARD_ADDED',
  'CARD_EDITED',
  'CARD_COPIES_CHANGED',
  'CARD_ENABLED_CHANGED',
  'CARD_DELETED',
  'DECK_RESET',
  'DECK_SHUFFLED',
  'DECK_CONTENTS_HIDDEN',
  'HELD_CARD_REMOVED',
  'OVERRIDE',
  'UNDONE',
];

/**
 * Events that reveal the Host changed something: the Rules, Board, cards or Decks, or the game
 * itself through an Override or Undo. No Player (the Host included) is shown them, in toasts or the
 * log; the Host tells Players what they choose to with an Announcement.
 */
export const isHiddenEdit = (e: GameEvent) => HIDDEN_EDITS.includes(e.type);
