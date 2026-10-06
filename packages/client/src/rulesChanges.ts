import type { GameEvent } from '@landlord/engine';

const RULES_CHANGES: GameEvent['type'][] = [
  'RULE_CHANGED',
  'SPACE_CHANGED',
  'DEFAULTS_RESTORED',
  'CHANGES_QUEUED',
  'PRESET_LOADED',
  'PRESET_APPLIED',
];

/** Events that reveal the Host changed the Rules or Board; no Player is shown them, in toasts or the log. */
export const isRulesChange = (e: GameEvent) => RULES_CHANGES.includes(e.type);
