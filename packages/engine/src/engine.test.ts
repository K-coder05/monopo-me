import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  defaultBoard,
  defaultRules,
  IllegalActionError,
  type Action,
  type GameState,
  type Rng,
  type Rules,
} from './index';

/** An Rng that rolls the given die faces in order. */
function dice(...faces: number[]): Rng {
  const queue = [...faces];
  return {
    int(maxExclusive) {
      const face = queue.shift();
      if (face === undefined) throw new Error('scripted dice ran out');
      if (face < 1 || face > maxExclusive) throw new Error(`face ${face} impossible on d${maxExclusive}`);
      return face - 1;
    },
  };
}

const noDice: Rng = dice();

function lobby(names: string[], rules: Rules = defaultRules): GameState {
  const [host, ...others] = names;
  let state = createGame('ABCDE', { id: host!, name: host!, color: `${host}-colour` }, rules, defaultBoard);
  for (const name of others) {
    state = applyAction(state, { type: 'JOIN_ROOM', playerId: name, name, color: `${name}-colour` }, rules, noDice)
      .state;
  }
  return state;
}

function act(state: GameState, action: Action, rng: Rng = noDice, rules: Rules = defaultRules) {
  return applyAction(state, action, rules, rng);
}

describe('roll-off', () => {
  it('orders Players by highest roll-off total', () => {
    const state = lobby(['ann', 'bob', 'cat']);

    // ann 2+3=5, bob 6+5=11, cat 4+4=8
    const { state: next } = act(state, { type: 'START_GAME', playerId: 'ann' }, dice(2, 3, 6, 5, 4, 4));

    expect(next.phase).toBe('playing');
    expect(next.players.map((p) => p.id)).toEqual(['bob', 'cat', 'ann']);
    expect(next.turn).toMatchObject({ playerId: 'bob', step: 'awaitRoll', round: 1 });
  });

  it('re-rolls tied Players among themselves until the tie breaks', () => {
    const state = lobby(['ann', 'bob', 'cat', 'dan']);

    const rng = dice(
      // first roll-off: ann 7, bob 10, cat 7, dan 3
      3, 4, 5, 5, 6, 1, 1, 2,
      // ann and cat re-roll: tie again at 6
      1, 5, 2, 4,
      // ann and cat re-roll: ann 2, cat 12
      1, 1, 6, 6,
    );
    const { state: next, events } = act(state, { type: 'START_GAME', playerId: 'ann' }, rng);

    expect(next.players.map((p) => p.id)).toEqual(['bob', 'cat', 'ann', 'dan']);
    const rollOffs = events.filter((e) => e.type === 'ROLL_OFF');
    expect(rollOffs.map((e) => e.rolls.map((r) => r.playerId))).toEqual([
      ['ann', 'bob', 'cat', 'dan'],
      ['ann', 'cat'],
      ['ann', 'cat'],
    ]);
  });

  it('breaks several separate ties independently', () => {
    const state = lobby(['ann', 'bob', 'cat', 'dan']);

    const rng = dice(
      // ann 10, bob 4, cat 10, dan 4
      5, 5, 2, 2, 4, 6, 1, 3,
      // ann and cat re-roll: ann 3, cat 4
      1, 2, 2, 2,
      // bob and dan re-roll: bob 9, dan 5
      4, 5, 2, 3,
    );
    const { state: next } = act(state, { type: 'START_GAME', playerId: 'ann' }, rng);

    expect(next.players.map((p) => p.id)).toEqual(['cat', 'ann', 'bob', 'dan']);
  });
});

/** ann and bob in a started game, ann first. */
function started(rules: Rules = defaultRules): GameState {
  const roll = Array.from({ length: rules.diceCount * 2 }, (_, i) => (i < rules.diceCount ? 6 : 1));
  return act(lobby(['ann', 'bob'], rules), { type: 'START_GAME', playerId: 'ann' }, dice(...roll), rules).state;
}

function position(state: GameState, playerId: string) {
  return state.players.find((p) => p.id === playerId)!.position;
}

describe('rolling and moving', () => {
  it('moves the active Player clockwise by the dice total', () => {
    const { state, events } = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(3, 4));

    expect(position(state, 'ann')).toBe(7);
    expect(position(state, 'bob')).toBe(0);
    expect(state.turn).toMatchObject({ playerId: 'ann', step: 'awaitEndTurn', lastRoll: [3, 4] });
    expect(events).toEqual([
      { type: 'DICE_ROLLED', playerId: 'ann', dice: [3, 4], total: 7 },
      { type: 'MOVED', playerId: 'ann', from: 0, to: 7 },
    ]);
  });

  it('wraps past index 39 back round the Board', () => {
    let state = started();
    // ann: 0 → 12 → 24 → 36, bob rolls in between
    for (let i = 0; i < 3; i++) {
      state = act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(6, 6)).state;
      state = act(state, { type: 'END_TURN', playerId: 'ann' }).state;
      state = act(state, { type: 'ROLL_DICE', playerId: 'bob' }, dice(1, 2)).state;
      state = act(state, { type: 'END_TURN', playerId: 'bob' }).state;
    }
    expect(position(state, 'ann')).toBe(36);

    const { state: next, events } = act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(5, 3));

    expect(position(next, 'ann')).toBe(4);
    expect(events).toContainEqual({ type: 'MOVED', playerId: 'ann', from: 36, to: 4 });
  });

  it('rolls the dice count and sides set in the Rules', () => {
    const rules = { ...defaultRules, diceCount: 3, diceSides: 8 };

    const { state } = act(started(rules), { type: 'ROLL_DICE', playerId: 'ann' }, dice(8, 7, 1), rules);

    expect(position(state, 'ann')).toBe(16);
    expect(state.turn?.lastRoll).toEqual([8, 7, 1]);
  });

  it('does not let a Player roll out of turn', () => {
    expect(() => act(started(), { type: 'ROLL_DICE', playerId: 'bob' }, dice(1, 2))).toThrow(IllegalActionError);
  });

  it('does not let the active Player roll twice', () => {
    const state = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;

    expect(() => act(state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2))).toThrow(IllegalActionError);
  });

  it('does not allow rolling in the lobby', () => {
    expect(() => act(lobby(['ann', 'bob']), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2))).toThrow(
      IllegalActionError,
    );
  });
});

describe('turn order', () => {
  it('passes the turn to the next Player in roll-off order, then back round to the first in a new round', () => {
    // bob 12, cat 7, ann 2
    let state = act(lobby(['ann', 'bob', 'cat']), { type: 'START_GAME', playerId: 'ann' }, dice(1, 1, 6, 6, 3, 4))
      .state;
    const seen: [string, number][] = [];
    for (let i = 0; i < 4; i++) {
      const { playerId, round } = state.turn!;
      seen.push([playerId, round]);
      state = act(state, { type: 'ROLL_DICE', playerId }, dice(1, 2)).state;
      state = act(state, { type: 'END_TURN', playerId }).state;
    }

    expect(seen).toEqual([
      ['bob', 1],
      ['cat', 1],
      ['ann', 1],
      ['bob', 2],
    ]);
  });

  it('does not let a Player end their turn before rolling', () => {
    expect(() => act(started(), { type: 'END_TURN', playerId: 'ann' })).toThrow(IllegalActionError);
  });

  it("does not let another Player end the active Player's turn", () => {
    const state = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2)).state;

    expect(() => act(state, { type: 'END_TURN', playerId: 'bob' })).toThrow(IllegalActionError);
  });
});

describe('game log', () => {
  it('records every event in order', () => {
    const state = act(started(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(2, 3)).state;

    const types = state.log.map((e) => e.event.type);
    expect(types).toEqual([
      'PLAYER_JOINED',
      'PLAYER_JOINED',
      'GAME_STARTED',
      'ROLL_OFF',
      'TURN_ORDER_SET',
      'TURN_STARTED',
      'DICE_ROLLED',
      'MOVED',
    ]);
    expect(state.log.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(state.log[0]!.event).toEqual({ type: 'PLAYER_JOINED', playerId: 'ann' });
  });
});

describe('joining', () => {
  it('starts Players on the GO space of the Board', () => {
    const board = [...defaultBoard.slice(5), ...defaultBoard.slice(0, 5)].map((s, index) => ({ ...s, index }));

    const state = createGame('ABCDE', { id: 'ann', name: 'ann', color: 'red' }, defaultRules, board);

    expect(state.players[0]!.position).toBe(35);
  });

  it('does not let two Players share a token colour', () => {
    const state = lobby(['ann']);

    expect(() => act(state, { type: 'JOIN_ROOM', playerId: 'bob', name: 'bob', color: 'ann-colour' })).toThrow(
      IllegalActionError,
    );
  });
});

describe('starting the game', () => {
  it('only lets the Host start', () => {
    const state = lobby(['ann', 'bob']);

    expect(() => act(state, { type: 'START_GAME', playerId: 'bob' }, dice(1, 2, 3, 4))).toThrow(IllegalActionError);
  });

  it('needs at least two Players with the Defaults', () => {
    const state = lobby(['ann']);

    expect(() => act(state, { type: 'START_GAME', playerId: 'ann' }, dice(1, 2))).toThrow(IllegalActionError);
  });

  it('reads the minimum Player count from the Rules', () => {
    const rules = { ...defaultRules, minPlayers: 3 };
    const state = lobby(['ann', 'bob'], rules);

    expect(() => act(state, { type: 'START_GAME', playerId: 'ann' }, dice(1, 2, 3, 4), rules)).toThrow(
      IllegalActionError,
    );
  });

  it('cannot start a game that has already started', () => {
    const state = act(lobby(['ann', 'bob']), { type: 'START_GAME', playerId: 'ann' }, dice(6, 6, 1, 1)).state;

    expect(() => act(state, { type: 'START_GAME', playerId: 'ann' }, dice(1, 2, 3, 4))).toThrow(IllegalActionError);
  });

  it('turns away joiners once the Room is full', () => {
    const rules = { ...defaultRules, maxPlayers: 2 };
    const state = lobby(['ann', 'bob'], rules);

    expect(() =>
      act(state, { type: 'JOIN_ROOM', playerId: 'cat', name: 'cat', color: 'green' }, noDice, rules),
    ).toThrow(IllegalActionError);
  });

  it('turns away joiners once the game has started', () => {
    const state = act(lobby(['ann', 'bob']), { type: 'START_GAME', playerId: 'ann' }, dice(6, 6, 1, 1)).state;

    expect(() => act(state, { type: 'JOIN_ROOM', playerId: 'cat', name: 'cat', color: 'green' })).toThrow(
      IllegalActionError,
    );
  });
});
