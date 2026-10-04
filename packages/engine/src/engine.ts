import type {
  Action,
  ActionResult,
  GameEvent,
  GameState,
  Player,
  Rng,
  RollOffRoll,
  Rules,
  SpaceDefinition,
  Turn,
} from './types';

/** Thrown when an Action is not legal in the current state. The state is left unchanged. */
export class IllegalActionError extends Error {
  override name = 'IllegalActionError';
}

export type NewPlayer = { id: string; name: string; color: string };

export function createGame(
  roomCode: string,
  host: NewPlayer,
  rules: Rules,
  board: SpaceDefinition[],
): GameState {
  const state: GameState = {
    roomCode,
    phase: 'lobby',
    hostId: host.id,
    rules,
    board,
    players: [newPlayer(host, rules, board)],
    log: [],
  };
  return appendLog(state, [{ type: 'PLAYER_JOINED', playerId: host.id }]);
}

export function applyAction(state: GameState, action: Action, rules: Rules, rng: Rng): ActionResult {
  const events: GameEvent[] = [];
  let next: GameState;
  switch (action.type) {
    case 'JOIN_ROOM':
      next = join(state, action, rules, events);
      break;
    case 'START_GAME':
      next = start(state, action.playerId, rules, rng, events);
      break;
    case 'ROLL_DICE':
      next = roll(state, action.playerId, rules, rng, events);
      break;
    case 'END_TURN':
      next = endTurn(state, action.playerId, events);
      break;
    default:
      throw new IllegalActionError(`Unknown action ${(action as Action).type}`);
  }
  return { state: appendLog(next, events), events };
}

function newPlayer(p: NewPlayer, rules: Rules, board: SpaceDefinition[]): Player {
  const go = board.find((s) => s.type === 'go');
  return { id: p.id, name: p.name, color: p.color, cash: rules.startingCash, position: go?.index ?? 0 };
}

function join(
  state: GameState,
  action: Extract<Action, { type: 'JOIN_ROOM' }>,
  rules: Rules,
  events: GameEvent[],
): GameState {
  if (state.phase !== 'lobby') throw new IllegalActionError('The game has already started');
  if (state.players.length >= rules.maxPlayers) throw new IllegalActionError('The Room is full');
  if (state.players.some((p) => p.id === action.playerId)) throw new IllegalActionError('Already in this Room');
  if (state.players.some((p) => p.color === action.color)) {
    throw new IllegalActionError('That token colour is taken; pick another');
  }
  events.push({ type: 'PLAYER_JOINED', playerId: action.playerId });
  const player = newPlayer({ id: action.playerId, name: action.name, color: action.color }, rules, state.board);
  return { ...state, players: [...state.players, player] };
}

function start(state: GameState, playerId: string, rules: Rules, rng: Rng, events: GameEvent[]): GameState {
  if (state.phase !== 'lobby') throw new IllegalActionError('The game has already started');
  if (playerId !== state.hostId) throw new IllegalActionError('Only the Host can start the game');
  if (state.players.length < rules.minPlayers) {
    throw new IllegalActionError(`At least ${rules.minPlayers} Players are needed to start`);
  }
  events.push({ type: 'GAME_STARTED' });
  const order = rollOff(
    state.players.map((p) => p.id),
    rules,
    rng,
    events,
  );
  events.push({ type: 'TURN_ORDER_SET', playerIds: order });

  const players = order.map((id) => state.players.find((p) => p.id === id)!);
  const first = players[0]!;
  events.push({ type: 'TURN_STARTED', playerId: first.id, round: 1 });
  return {
    ...state,
    phase: 'playing',
    players,
    turn: { playerId: first.id, step: 'awaitRoll', lastRoll: [], round: 1 },
  };
}

/** Checks that it is `playerId`'s turn and the turn is at `step`; returns the turn. */
function requireTurn(state: GameState, playerId: string, step: Turn['step']): Turn {
  const turn = state.turn;
  if (state.phase !== 'playing' || !turn) throw new IllegalActionError('The game has not started');
  if (turn.playerId !== playerId) throw new IllegalActionError('It is not your turn');
  if (turn.step !== step) throw new IllegalActionError(`You cannot do that now (${turn.step})`);
  return turn;
}

function roll(state: GameState, playerId: string, rules: Rules, rng: Rng, events: GameEvent[]): GameState {
  const turn = requireTurn(state, playerId, 'awaitRoll');
  const dice = rollDice(rules, rng);
  const total = sum(dice);
  events.push({ type: 'DICE_ROLLED', playerId, dice, total });

  const players = state.players.map((p) => {
    if (p.id !== playerId) return p;
    const to = (p.position + total) % state.board.length;
    events.push({ type: 'MOVED', playerId, from: p.position, to });
    return { ...p, position: to };
  });
  return { ...state, players, turn: { ...turn, step: 'awaitEndTurn', lastRoll: dice } };
}

function endTurn(state: GameState, playerId: string, events: GameEvent[]): GameState {
  const turn = requireTurn(state, playerId, 'awaitEndTurn');
  events.push({ type: 'TURN_ENDED', playerId });

  const index = state.players.findIndex((p) => p.id === playerId);
  const nextIndex = (index + 1) % state.players.length;
  const round = nextIndex === 0 ? turn.round + 1 : turn.round;
  const nextId = state.players[nextIndex]!.id;
  events.push({ type: 'TURN_STARTED', playerId: nextId, round });
  return { ...state, turn: { playerId: nextId, step: 'awaitRoll', lastRoll: [], round } };
}

/**
 * Orders players by a dice roll, highest first. Each group of tied players re-rolls
 * among themselves (highest group first) until every tie is broken.
 */
function rollOff(playerIds: string[], rules: Rules, rng: Rng, events: GameEvent[]): string[] {
  const rolls = playerIds.map((id) => rollFor(id, rules, rng));
  events.push({ type: 'ROLL_OFF', rolls });

  const totals = [...new Set(rolls.map((r) => r.total))].sort((a, b) => b - a);
  return totals.flatMap((total) => {
    const tied = rolls.filter((r) => r.total === total).map((r) => r.playerId);
    return tied.length === 1 ? tied : rollOff(tied, rules, rng, events);
  });
}

function rollDice(rules: Rules, rng: Rng): number[] {
  return Array.from({ length: rules.diceCount }, () => 1 + rng.int(rules.diceSides));
}

function rollFor(playerId: string, rules: Rules, rng: Rng): RollOffRoll {
  const dice = rollDice(rules, rng);
  return { playerId, dice, total: sum(dice) };
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function appendLog(state: GameState, events: GameEvent[]): GameState {
  if (events.length === 0) return state;
  const start = state.log.length === 0 ? 0 : state.log[state.log.length - 1]!.seq + 1;
  return { ...state, log: [...state.log, ...events.map((event, i) => ({ seq: start + i, event }))] };
}
