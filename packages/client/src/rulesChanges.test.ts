import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@landlord/engine';
import { isRulesChange } from './rulesChanges';

describe('isRulesChange', () => {
  it('flags every event that tells Players the Rules or Board changed', () => {
    const events: GameEvent[] = [
      { type: 'RULE_CHANGED', key: 'goSalary', from: 200, to: 400 },
      { type: 'SPACE_CHANGED', index: 1, field: 'price', from: 60, to: 80 },
      { type: 'DEFAULTS_RESTORED' },
      { type: 'CHANGES_QUEUED' },
      { type: 'PRESET_LOADED', name: 'House rules', flaggedCards: 0 },
      { type: 'PRESET_APPLIED', name: 'House rules' },
    ];
    expect(events.filter((e) => !isRulesChange(e))).toEqual([]);
  });

  it('leaves play and card edits alone', () => {
    const events: GameEvent[] = [
      { type: 'RETURNED_TO_LOBBY' },
      { type: 'UNDONE' },
      { type: 'DECK_SHUFFLED', deck: 'chance' },
    ];
    expect(events.filter(isRulesChange)).toEqual([]);
  });
});
