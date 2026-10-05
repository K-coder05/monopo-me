import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  defaultBoard,
  defaultRules,
  IllegalActionError,
  recordUndo,
  undo,
  type Action,
  type GameState,
  type Player,
  type Rng,
} from './index';

/** Scripted values, then zeros once they run out. */
function script(...values: number[]): Rng {
  const queue = [...values];
  return { int: () => queue.shift() ?? 0 };
}

/** Rolls the given die faces (1-based). */
const dice = (...faces: number[]) => script(...faces.map((f) => f - 1));

function act(state: GameState, action: Action, rng: Rng = script(), now = 0) {
  return applyAction(state, action, state.rules, rng, now);
}

/** ann (the Host), bob and cat in the lobby, in join order. */
function lobby(): GameState {
  let state = createGame('ABCDE', { id: 'ann', name: 'ann', color: 'c0' }, defaultRules, defaultBoard);
  for (const [i, name] of ['bob', 'cat'].entries()) {
    state = act(state, { type: 'JOIN_ROOM', playerId: name, name, color: `c${i + 1}` }).state;
  }
  return state;
}

/** ann (the Host), bob and cat in that turn order, ann to roll from GO. */
function table(): GameState {
  return act(lobby(), { type: 'START_GAME', playerId: 'ann' }, script(5, 5, 4, 4, 3, 3)).state;
}

function withPlayer(state: GameState, id: string, patch: Partial<Player>): GameState {
  return { ...state, players: state.players.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

const player = (state: GameState, id: string) => state.players.find((p) => p.id === id)!;

/** ann rolls 1 + 2 onto Baltic Avenue (3), declines it, and the Auction opens at `now`. */
function auction(now = 0): GameState {
  const rolled = act(table(), { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2), now).state;
  return act(rolled, { type: 'DECLINE_PROPERTY', playerId: 'ann' }, script(), now).state;
}

describe('Pause and resume', () => {
  it('freezes every game action until the Host resumes', () => {
    const paused = act(table(), { type: 'PAUSE', playerId: 'ann' }, script(), 1000);

    expect(paused.state.paused).toEqual({ at: 1000 });
    expect(paused.events).toEqual([{ type: 'GAME_PAUSED' }]);
    expect(() => act(paused.state, { type: 'ROLL_DICE', playerId: 'ann' })).toThrow('paused');
    const override = { type: 'HOST_OVERRIDE', playerId: 'ann', override: { kind: 'SKIP_TURN', playerId: 'bob' } } as const;
    expect(() => act(paused.state, override)).toThrow('paused');

    const resumed = act(paused.state, { type: 'RESUME', playerId: 'ann' });
    expect(resumed.state.paused).toBeUndefined();
    expect(resumed.events).toEqual([{ type: 'GAME_RESUMED' }]);
    expect(() => act(resumed.state, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2))).not.toThrow();
  });

  it('still lets the Host edit Rules while paused', () => {
    const paused = act(table(), { type: 'PAUSE', playerId: 'ann' }).state;
    const edited = act(paused, { type: 'UPDATE_RULES', playerId: 'ann', changes: { goSalary: 300 } }).state;
    expect(edited.rules.goSalary).toBe(300);
  });

  it('is Host only, and only during a game', () => {
    expect(() => act(table(), { type: 'PAUSE', playerId: 'bob' })).toThrow('Only the Host');
    expect(() => act(lobby(), { type: 'PAUSE', playerId: 'ann' })).toThrow(IllegalActionError);
    expect(() => act(table(), { type: 'RESUME', playerId: 'ann' })).toThrow('not paused');
    const paused = act(table(), { type: 'PAUSE', playerId: 'ann' }).state;
    expect(() => act(paused, { type: 'PAUSE', playerId: 'ann' })).toThrow('already paused');
    expect(() => act(paused, { type: 'RESUME', playerId: 'bob' })).toThrow('Only the Host');
  });

  it('freezes the Auction countdown: resuming gives back the time that was left', () => {
    // 10 s Auction opened at 0, paused at 4 s, resumed at 100 s: 6 s are left.
    const open = auction(0);
    const paused = act(open, { type: 'PAUSE', playerId: 'ann' }, script(), 4_000).state;
    expect(() => act(paused, { type: 'EXPIRE_AUCTION' }, script(), 60_000)).toThrow('paused');

    const resumed = act(paused, { type: 'RESUME', playerId: 'ann' }, script(), 100_000).state;
    expect(resumed.auction!.endsAt).toBe(106_000);
  });

  it('keeps a Player from leaving or being kicked while paused, but not a Spectator', () => {
    let paused = act(table(), { type: 'JOIN_ROOM', playerId: 'dan', name: 'dan', color: 'c3' }).state;
    paused = act(paused, { type: 'PAUSE', playerId: 'ann' }).state;
    expect(() => act(paused, { type: 'LEAVE_ROOM', playerId: 'bob' })).toThrow('paused');
    expect(() => act(paused, { type: 'KICK', playerId: 'ann', targetId: 'bob' })).toThrow('paused');
    expect(act(paused, { type: 'LEAVE_ROOM', playerId: 'dan' }).state.spectators).toEqual([]);
  });

  it('does not let Undo run while paused', () => {
    const paused = act(table(), { type: 'PAUSE', playerId: 'ann' }).state;
    expect(() => undo(paused, [table()], 'ann', 0)).toThrow('paused');
  });
});

describe('Spectators', () => {
  const joinLate = (state: GameState, id = 'dan', color = 'c3') => act(state, { type: 'JOIN_ROOM', playerId: id, name: id, color });

  it('makes anyone who joins after the start a Spectator', () => {
    const { state, events } = joinLate(table());
    expect(state.spectators).toEqual([{ id: 'dan', name: 'dan', color: 'c3' }]);
    expect(state.players.map((p) => p.id)).toEqual(['ann', 'bob', 'cat']);
    expect(events).toEqual([{ type: 'SPECTATOR_JOINED', spectatorId: 'dan', name: 'dan' }]);
  });

  it('lets the Host add a Spectator as a Player: on GO with startingCash, last in turn order', () => {
    const watching = joinLate(table());
    const { state, events } = act(watching.state, { type: 'ADD_PLAYER', playerId: 'ann', spectatorId: 'dan' });
    expect(state.spectators).toEqual([]);
    expect(state.players.map((p) => p.id)).toEqual(['ann', 'bob', 'cat', 'dan']);
    expect(player(state, 'dan')).toMatchObject({ cash: 1500, position: 0, bankrupt: false, color: 'c3' });
    expect(events).toEqual([{ type: 'PLAYER_ADDED', playerId: 'dan' }]);
  });

  it('gives an added Player a free colour when theirs is taken', () => {
    const watching = joinLate(table(), 'dan', 'c1');
    const { state } = act(watching.state, { type: 'ADD_PLAYER', playerId: 'ann', spectatorId: 'dan' });
    expect(['c0', 'c1', 'c2']).not.toContain(player(state, 'dan').color);
  });

  it('lets an added Player first play in the next round', () => {
    // dan is added while bob is playing round 1, so cat ends round 1 and ann starts round 2.
    let state = joinLate(table()).state;
    state = act(state, { type: 'HOST_OVERRIDE', playerId: 'ann', override: { kind: 'END_TURN' } }).state;
    state = act(state, { type: 'ADD_PLAYER', playerId: 'ann', spectatorId: 'dan' }).state;
    const order: string[] = [];
    for (let i = 0; i < 5; i++) {
      state = act(state, { type: 'HOST_OVERRIDE', playerId: 'ann', override: { kind: 'END_TURN' } }).state;
      order.push(`${state.turn!.playerId}${state.turn!.round}`);
    }
    expect(order).toEqual(['cat1', 'ann2', 'bob2', 'cat2', 'dan2']);
  });

  it('is Host only, needs a Spectator and room for another Player', () => {
    const watching = joinLate(table()).state;
    expect(() => act(watching, { type: 'ADD_PLAYER', playerId: 'bob', spectatorId: 'dan' })).toThrow('Only the Host');
    expect(() => act(watching, { type: 'ADD_PLAYER', playerId: 'ann', spectatorId: 'bob' })).toThrow('Spectator');
    const full = { ...watching, rules: { ...watching.rules, maxPlayers: 3 } };
    expect(() => act(full, { type: 'ADD_PLAYER', playerId: 'ann', spectatorId: 'dan' })).toThrow('full');
  });

  it('keeps Spectators across a return to the Lobby, where the Host can add them', () => {
    let state = joinLate(table()).state;
    state = { ...state, phase: 'finished', turn: undefined, winnerId: 'ann' };
    state = act(state, { type: 'BACK_TO_LOBBY', playerId: 'ann' }).state;
    expect(state.spectators.map((s) => s.id)).toEqual(['dan']);
    state = act(state, { type: 'ADD_PLAYER', playerId: 'ann', spectatorId: 'dan' }).state;
    expect(state.players.map((p) => p.id)).toEqual(['ann', 'bob', 'cat', 'dan']);
  });
});

describe('Leaving and kicking', () => {
  const leave = (state: GameState, id: string, now = 0) => act(state, { type: 'LEAVE_ROOM', playerId: id }, script(), now);
  const kick = (state: GameState, targetId: string, by = 'ann') => act(state, { type: 'KICK', playerId: by, targetId });
  const owning = (state: GameState, ownerId: string, indexes: number[]): GameState => {
    const deeds = { ...state.deeds };
    for (const i of indexes) deeds[i] = { ownerId, buildings: 0, mortgaged: false };
    return { ...state, deeds };
  };

  it('takes a Player out of the lobby', () => {
    const { state, events } = leave(lobby(), 'bob');
    expect(state.players.map((p) => p.id)).toEqual(['ann', 'cat']);
    expect(events).toEqual([{ type: 'LEFT_ROOM', id: 'bob', name: 'bob', kicked: false }]);
    expect(kick(lobby(), 'cat').state.players.map((p) => p.id)).toEqual(['ann', 'bob']);
  });

  it('takes a Spectator out of the Room', () => {
    const watching = act(table(), { type: 'JOIN_ROOM', playerId: 'dan', name: 'dan', color: 'c3' }).state;
    expect(leave(watching, 'dan').state.spectators).toEqual([]);
    const kicked = kick(watching, 'dan');
    expect(kicked.state.spectators).toEqual([]);
    expect(kicked.events).toEqual([{ type: 'LEFT_ROOM', id: 'dan', name: 'dan', kicked: true }]);
  });

  it('makes a Player who leaves mid-game go bankrupt to the bank, and play carries on', () => {
    const { state, events } = leave(table(), 'bob');
    expect(player(state, 'bob')).toMatchObject({ bankrupt: true, cash: 0 });
    expect(state.bankruptcies).toEqual(['bob']);
    expect(events).toEqual([
      { type: 'LEFT_ROOM', id: 'bob', name: 'bob', kicked: false },
      { type: 'BANKRUPT', playerId: 'bob', creditor: { type: 'bank' } },
    ]);
    expect(state.turn).toMatchObject({ playerId: 'ann', step: 'awaitRoll' });
  });

  it('passes the turn on when the active Player leaves', () => {
    const bobsTurn = act(table(), { type: 'HOST_OVERRIDE', playerId: 'ann', override: { kind: 'END_TURN' } }).state;
    expect(leave(bobsTurn, 'bob').state.turn).toMatchObject({ playerId: 'cat', step: 'awaitRoll' });
  });

  it('auctions their properties one by one, then carries on with the turn where it was', () => {
    let state = leave(owning(table(), 'bob', [1, 3]), 'bob', 0).state;
    expect(state.deeds[1]).toBeUndefined();
    expect(state.auction).toMatchObject({ index: 1, bidders: ['ann', 'cat'] });
    state = act(state, { type: 'EXPIRE_AUCTION' }, script(), 60_000).state;
    expect(state.auction).toMatchObject({ index: 3 });
    state = act(state, { type: 'EXPIRE_AUCTION' }, script(), 120_000).state;
    expect(state.auction).toBeUndefined();
    expect(state.turn).toMatchObject({ playerId: 'ann', step: 'awaitRoll' });
  });

  it('drops a leaver from an open Auction, bid and all, and queues their properties after it', () => {
    let state = owning(auction(0), 'bob', [1]);
    state = act(state, { type: 'PLACE_BID', playerId: 'bob', amount: 50 }).state;
    state = leave(state, 'bob').state;
    expect(state.auction).toMatchObject({ index: 3, bidders: ['ann', 'cat'] });
    expect(state.auction!.highBid).toBeUndefined();
    state = act(state, { type: 'EXPIRE_AUCTION' }, script(), 60_000).state;
    expect(state.auction).toMatchObject({ index: 1 });
    state = act(state, { type: 'EXPIRE_AUCTION' }, script(), 120_000).state;
    // ann's landing on Baltic is over, so she may end her turn.
    expect(state.turn).toMatchObject({ playerId: 'ann', step: 'awaitEndTurn' });
  });

  it('cancels a leaver\'s blocking Debt as they go bankrupt to the bank', () => {
    // bob owes 500 to ann but has 10.
    let state = withPlayer(owning(table(), 'ann', [39]), 'bob', { cash: 10, position: 35 });
    state = act(state, { type: 'HOST_OVERRIDE', playerId: 'ann', override: { kind: 'END_TURN' } }).state;
    state = act(state, { type: 'ROLL_DICE', playerId: 'bob' }, dice(1, 3)).state;
    expect(state.turn!.step).toBe('awaitDebt');
    const { state: left, events } = leave(state, 'bob');
    expect(events).toContainEqual({ type: 'BANKRUPT', playerId: 'bob', creditor: { type: 'bank' } });
    expect(player(left, 'ann').cash).toBe(1500);
    expect(left.debts).toEqual([]);
    expect(left.turn).toMatchObject({ playerId: 'cat', step: 'awaitRoll' });
  });

  it('ends the game when only one Player is left', () => {
    const { state, events } = kick(leave(table(), 'bob').state, 'cat');
    expect(events).toContainEqual({ type: 'LEFT_ROOM', id: 'cat', name: 'cat', kicked: true });
    expect(state).toMatchObject({ phase: 'finished', winnerId: 'ann' });
  });

  it('takes a Player who leaves after the game out of the Room', () => {
    let state = leave(table(), 'bob').state;
    state = { ...state, phase: 'finished', turn: undefined, winnerId: 'ann' };
    state = leave(state, 'cat').state;
    expect(state.players.map((p) => p.id)).toEqual(['ann', 'bob']);
    expect(state.bankruptcies).toEqual(['bob']);
  });

  it('refuses the Host leaving before handing on the role, and kicks from anyone else', () => {
    expect(() => leave(table(), 'ann')).toThrow('Host');
    expect(() => kick(table(), 'ann')).toThrow(IllegalActionError);
    expect(() => kick(table(), 'cat', 'bob')).toThrow('Only the Host');
    expect(() => kick(table(), 'zed')).toThrow(IllegalActionError);
  });
});

describe('Host transfer', () => {
  it('lets the Host hand the role to another Player', () => {
    const { state, events } = act(table(), { type: 'TRANSFER_HOST', playerId: 'ann', toId: 'cat' });
    expect(state.hostId).toBe('cat');
    expect(events).toEqual([{ type: 'HOST_CHANGED', from: 'ann', to: 'cat', automatic: false }]);
    // The old Host is now an ordinary Player, free to leave.
    expect(() => act(state, { type: 'PAUSE', playerId: 'ann' })).toThrow('Only the Host');
    expect(act(state, { type: 'LEAVE_ROOM', playerId: 'ann' }).state.bankruptcies).toEqual(['ann']);
  });

  it('only goes from the Host to a Player still in the game', () => {
    expect(() => act(table(), { type: 'TRANSFER_HOST', playerId: 'bob', toId: 'cat' })).toThrow('Only the Host');
    expect(() => act(table(), { type: 'TRANSFER_HOST', playerId: 'ann', toId: 'ann' })).toThrow(IllegalActionError);
    expect(() => act(table(), { type: 'TRANSFER_HOST', playerId: 'ann', toId: 'zed' })).toThrow(IllegalActionError);
    const bobOut = act(table(), { type: 'LEAVE_ROOM', playerId: 'bob' }).state;
    expect(() => act(bobOut, { type: 'TRANSFER_HOST', playerId: 'ann', toId: 'bob' })).toThrow(IllegalActionError);
    const watching = act(table(), { type: 'JOIN_ROOM', playerId: 'dan', name: 'dan', color: 'c3' }).state;
    expect(() => act(watching, { type: 'TRANSFER_HOST', playerId: 'ann', toId: 'dan' })).toThrow(IllegalActionError);
  });

  it('passes automatically when the server says the Host has been away too long', () => {
    const { state, events } = act(table(), { type: 'HOST_TIMED_OUT', toId: 'bob' });
    expect(state.hostId).toBe('bob');
    expect(events).toEqual([{ type: 'HOST_CHANGED', from: 'ann', to: 'bob', automatic: true }]);
  });
});

describe('End game', () => {
  it('lets the Host finish the game with no Winner', () => {
    const { state, events } = act(auction(), { type: 'END_GAME', playerId: 'ann' });
    expect(state).toMatchObject({ phase: 'finished', winnerId: undefined, turn: undefined, auction: undefined });
    expect(events).toEqual([{ type: 'GAME_ENDED' }]);
  });

  it('works while paused, and is Host only', () => {
    const paused = act(table(), { type: 'PAUSE', playerId: 'ann' }).state;
    expect(act(paused, { type: 'END_GAME', playerId: 'ann' }).state).toMatchObject({ phase: 'finished', paused: undefined });
    expect(() => act(table(), { type: 'END_GAME', playerId: 'bob' })).toThrow('Only the Host');
    expect(() => act(lobby(), { type: 'END_GAME', playerId: 'ann' })).toThrow(IllegalActionError);
  });
});

describe('A Debt left by a Player who is away', () => {
  it('lets the Host declare the debtor bankrupt to the Creditor', () => {
    // bob lands on ann's Boardwalk (rent 50) with 10 and 1 property he could still mortgage.
    let state = withPlayer(table(), 'bob', { cash: 10, position: 35 });
    state = { ...state, deeds: { 39: { ownerId: 'ann', buildings: 0, mortgaged: false }, 1: { ownerId: 'bob', buildings: 0, mortgaged: false } } };
    state = act(state, { type: 'HOST_OVERRIDE', playerId: 'ann', override: { kind: 'END_TURN' } }).state;
    state = act(state, { type: 'ROLL_DICE', playerId: 'bob' }, dice(1, 3)).state;

    const { state: out, events } = act(state, { type: 'HOST_OVERRIDE', playerId: 'ann', override: { kind: 'DECLARE_BANKRUPTCY' } });
    expect(events).toContainEqual({ type: 'BANKRUPT', playerId: 'bob', creditor: { type: 'player', playerId: 'ann' } });
    expect(out.deeds[1]!.ownerId).toBe('ann');
    expect(out.turn).toMatchObject({ playerId: 'cat', step: 'awaitRoll' });
    expect(() => act(table(), { type: 'HOST_OVERRIDE', playerId: 'ann', override: { kind: 'DECLARE_BANKRUPTCY' } })).toThrow('No Debt');
  });
});

describe('Undo and the Room', () => {
  type Room = { state: GameState; history: GameState[] };
  const play = (room: Room, action: Action, rng: Rng = script()): Room => {
    const { state } = act(room.state, action, rng);
    return { state, history: recordUndo(room.history, room.state, state, action) };
  };

  it('does not take back a pause, a Host transfer or a Spectator joining', () => {
    let room: Room = { state: table(), history: [] };
    room = play(room, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2));
    room = play(room, { type: 'JOIN_ROOM', playerId: 'dan', name: 'dan', color: 'c3' });
    room = play(room, { type: 'PAUSE', playerId: 'ann' });
    room = play(room, { type: 'RESUME', playerId: 'ann' });
    room = play(room, { type: 'TRANSFER_HOST', playerId: 'ann', toId: 'bob' });
    expect(room.history).toHaveLength(1);

    const { state } = undo(room.state, room.history, 'bob', 0);
    expect(player(state, 'ann').position).toBe(0);
    expect(state.hostId).toBe('bob');
    expect(state.spectators.map((s) => s.id)).toEqual(['dan']);
  });

  it('turns a Player added since back into a Spectator', () => {
    let room: Room = { state: act(table(), { type: 'JOIN_ROOM', playerId: 'dan', name: 'dan', color: 'c3' }).state, history: [] };
    room = play(room, { type: 'ADD_PLAYER', playerId: 'ann', spectatorId: 'dan' });
    const { state } = undo(room.state, room.history, 'ann', 0);
    expect(state.players.map((p) => p.id)).toEqual(['ann', 'bob', 'cat']);
    expect(state.spectators).toEqual([{ id: 'dan', name: 'dan', color: 'c3' }]);
  });

  it('keeps the Host a Player when the Player they were added as is undone', () => {
    let room: Room = { state: act(table(), { type: 'JOIN_ROOM', playerId: 'dan', name: 'dan', color: 'c3' }).state, history: [] };
    room = play(room, { type: 'ADD_PLAYER', playerId: 'ann', spectatorId: 'dan' });
    room = play(room, { type: 'TRANSFER_HOST', playerId: 'ann', toId: 'dan' });
    const { state } = undo(room.state, room.history, 'dan', 0);
    expect(state.hostId).toBe('ann');
  });

  it('cannot bring back a Player who left or was kicked', () => {
    let room: Room = { state: table(), history: [] };
    room = play(room, { type: 'ROLL_DICE', playerId: 'ann' }, dice(1, 2));
    room = play(room, { type: 'KICK', playerId: 'ann', targetId: 'bob' });
    expect(room.history).toEqual([]);
  });
});
