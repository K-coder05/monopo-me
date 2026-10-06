import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@landlord/engine';
import { isHiddenEdit } from './hiddenEdits';

describe('isHiddenEdit', () => {
  it('flags every event that tells Players the Rules or Board changed', () => {
    const events: GameEvent[] = [
      { type: 'RULE_CHANGED', key: 'goSalary', from: 200, to: 400 },
      { type: 'SPACE_CHANGED', index: 1, field: 'price', from: 60, to: 80 },
      { type: 'DEFAULTS_RESTORED' },
      { type: 'CHANGES_QUEUED' },
      { type: 'PRESET_LOADED', name: 'House rules', flaggedCards: 0 },
      { type: 'PRESET_APPLIED', name: 'House rules' },
    ];
    expect(events.filter((e) => !isHiddenEdit(e))).toEqual([]);
  });

  it('flags every event that tells Players a card changed', () => {
    const card = { deck: 'chance', cardId: 'c1', title: 'Bank error' } as const;
    const events: GameEvent[] = [
      { type: 'CARD_ADDED', ...card },
      { type: 'CARD_EDITED', ...card },
      { type: 'CARD_COPIES_CHANGED', ...card, from: 1, to: 2 },
      { type: 'CARD_ENABLED_CHANGED', ...card, enabled: false },
      { type: 'CARD_DELETED', ...card },
      { type: 'DECK_RESET', deck: 'chance' },
    ];
    expect(events.filter((e) => !isHiddenEdit(e))).toEqual([]);
  });

  it('leaves play and other Host actions alone', () => {
    const events: GameEvent[] = [
      { type: 'RETURNED_TO_LOBBY' },
      { type: 'UNDONE' },
      { type: 'DECK_SHUFFLED', deck: 'chance' },
      { type: 'DECK_CONTENTS_HIDDEN', hidden: true },
    ];
    expect(events.filter(isHiddenEdit)).toEqual([]);
  });
});
