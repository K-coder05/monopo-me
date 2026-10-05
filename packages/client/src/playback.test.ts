import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@landlord/engine';
import { cueOf, movePath, plan } from './playback';

const SIZE = 40;

describe('movePath', () => {
  it('steps clockwise through every space, ending on the destination', () => {
    expect(movePath(3, 7, SIZE)).toEqual([4, 5, 6, 7]);
  });

  it('wraps past GO', () => {
    expect(movePath(37, 2, SIZE)).toEqual([38, 39, 0, 1, 2]);
  });

  it('steps anticlockwise for a move backwards, wrapping past GO', () => {
    expect(movePath(7, 4, SIZE, true)).toEqual([6, 5, 4]);
    expect(movePath(2, 38, SIZE, true)).toEqual([1, 0, 39, 38]);
  });

  it('is empty when the token stays put', () => {
    expect(movePath(5, 5, SIZE)).toEqual([]);
  });
});

describe('plan', () => {
  const roll: GameEvent = { type: 'DICE_ROLLED', playerId: 'ann', dice: [2, 3], total: 5 };
  const move: GameEvent = { type: 'MOVED', playerId: 'ann', from: 0, to: 5 };

  it('rolls the dice, then walks the token, in event order', () => {
    expect(plan([{ type: 'TURN_STARTED', playerId: 'ann', round: 1 }, roll, move], SIZE, 'bob')).toEqual([
      { kind: 'dice', dice: [2, 3] },
      { kind: 'move', playerId: 'ann', path: [1, 2, 3, 4, 5] },
    ]);
  });

  it('walks a card move backwards', () => {
    expect(plan([{ type: 'MOVED', playerId: 'ann', from: 7, to: 4, backward: true }], SIZE, 'bob')).toEqual([
      { kind: 'move', playerId: 'ann', path: [6, 5, 4] },
    ]);
  });

  it('cues sounds where they happen, so they play after the token arrives', () => {
    const events: GameEvent[] = [
      roll,
      move,
      { type: 'PROPERTY_BOUGHT', playerId: 'ann', index: 5, price: 200 },
      { type: 'TURN_ENDED', playerId: 'ann' },
      { type: 'TURN_STARTED', playerId: 'bob', round: 1 },
    ];
    expect(plan(events, SIZE, 'bob').map((b) => (b.kind === 'sound' ? b.sound : b.kind))).toEqual([
      'dice',
      'move',
      'cash',
      'yourTurn',
    ]);
  });

  it("only chimes for the viewer's own turn", () => {
    expect(plan([{ type: 'TURN_STARTED', playerId: 'ann', round: 2 }], SIZE, 'bob')).toEqual([]);
  });

  it('cues rent, cards and Jail', () => {
    const events: GameEvent[] = [
      { type: 'RENT_PAID', playerId: 'ann', ownerId: 'bob', index: 1, amount: 2 },
      { type: 'CARD_DRAWN', playerId: 'ann', deck: 'chance', cardId: 'c', title: 'T', text: 't' },
      { type: 'JAILED', playerId: 'ann', reason: 'goToJail' },
    ];
    expect(plan(events, SIZE, 'bob')).toEqual([
      { kind: 'sound', sound: 'pay' },
      { kind: 'sound', sound: 'card' },
      { kind: 'sound', sound: 'jail' },
    ]);
  });
});

describe('cueOf', () => {
  it('is the sound a beat starts with: the dice rattle, a cue, or none for a walk', () => {
    expect(cueOf({ kind: 'dice', dice: [1, 2] })).toBe('dice');
    expect(cueOf({ kind: 'sound', sound: 'cash' })).toBe('cash');
    expect(cueOf({ kind: 'move', playerId: 'ann', path: [1] })).toBeNull();
  });
});
