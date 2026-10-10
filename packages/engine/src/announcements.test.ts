import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  defaultRules,
  defaultBoard,
  IllegalActionError,
  MAX_ANNOUNCEMENT_LENGTH,
  recordUndo,
  type Action,
  type GameState,
  type Rng,
} from './index';

const rng: Rng = { int: () => 0 };

const act = (state: GameState, action: Action) => applyAction(state, action, state.rules, rng, 0);

/** ann (the Host) and bob, in the Lobby. */
function lobby(): GameState {
  const state = createGame('ABCDE', { id: 'ann', name: 'ann', color: 'c0' }, defaultRules, defaultBoard);
  return act(state, { type: 'JOIN_ROOM', playerId: 'bob', name: 'bob', color: 'c1' }).state;
}

/** The same game, started; the roll-off dice are scripted so nobody ties. */
function playing(): GameState {
  const faces = [5, 5, 4, 4];
  return applyAction(lobby(), { type: 'START_GAME', playerId: 'ann' }, defaultRules, { int: () => faces.shift() ?? 0 }, 0).state;
}

describe('ANNOUNCE', () => {
  it('logs the Host’s text as an Announcement for everyone', () => {
    const { state, events } = act(playing(), { type: 'ANNOUNCE', playerId: 'ann', text: 'GO now pays 400!' });
    expect(events).toEqual([{ type: 'ANNOUNCEMENT', text: 'GO now pays 400!' }]);
    expect(state.log.at(-1)?.event).toEqual({ type: 'ANNOUNCEMENT', text: 'GO now pays 400!' });
  });

  it('works in the Lobby and while paused', () => {
    expect(act(lobby(), { type: 'ANNOUNCE', playerId: 'ann', text: 'hi' }).events).toHaveLength(1);
    const paused = act(playing(), { type: 'PAUSE', playerId: 'ann' }).state;
    expect(act(paused, { type: 'ANNOUNCE', playerId: 'ann', text: 'brb' }).events).toHaveLength(1);
  });

  it('trims the text', () => {
    const { events } = act(lobby(), { type: 'ANNOUNCE', playerId: 'ann', text: '  hello \n' });
    expect(events).toEqual([{ type: 'ANNOUNCEMENT', text: 'hello' }]);
  });

  it('is Host only', () => {
    expect(() => act(lobby(), { type: 'ANNOUNCE', playerId: 'bob', text: 'hi' })).toThrow(IllegalActionError);
  });

  it('refuses empty, overlong or non-text announcements', () => {
    for (const text of ['', '   ', 'x'.repeat(MAX_ANNOUNCEMENT_LENGTH + 1), 42, undefined]) {
      expect(() => act(lobby(), { type: 'ANNOUNCE', playerId: 'ann', text } as unknown as Action)).toThrow(IllegalActionError);
    }
    expect(act(lobby(), { type: 'ANNOUNCE', playerId: 'ann', text: 'x'.repeat(MAX_ANNOUNCEMENT_LENGTH) }).events).toHaveLength(1);
  });

  it('is stepped over by Undo', () => {
    const before = playing();
    const action: Action = { type: 'ANNOUNCE', playerId: 'ann', text: 'hi' };
    const after = act(before, action).state;
    expect(recordUndo([], before, after, action)).toEqual([]);
  });
});
