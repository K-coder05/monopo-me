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
];

/** Events that reveal the Host changed the Rules, Board or cards; no Player is shown them, in toasts or the log. */
export const isHiddenEdit = (e: GameEvent) => HIDDEN_EDITS.includes(e.type);
