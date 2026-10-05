import { defaultBoard, defaultCards, defaultRules } from './defaults';
import { addCard, copiesInPlay, deleteCard, editCard, hideDeckContents, resetDeck, shuffleDeck, wantedCopies } from './cardEdits';
import { applyPending, resetToDefaults, updateBoard, updateRules } from './edits';
import { loadPreset } from './presets';
import { TOKEN_COLORS } from './protocol';
import type {
  Action,
  AfterDebts,
  ActionResult,
  ActiveCard,
  Amount,
  Auction,
  Card,
  Creditor,
  Debt,
  Deck,
  DeckKind,
  Decks,
  Effect,
  GameEvent,
  GameState,
  JailReason,
  Override,
  PartySelector,
  Player,
  Rng,
  RollOffRoll,
  Rules,
  SkipReason,
  SpaceDefinition,
  Trade,
  TradeSide,
  Turn,
  TurnStep,
} from './types';

/** Thrown when an Action is not legal in the current state. The state is left unchanged. */
export class IllegalActionError extends Error {
  override name = 'IllegalActionError';
}

/**
 * A Deed's `buildings` value for a hotel; 0–4 are houses. It matches the hotel's (last) entry in a
 * street's rent table, so house levels above housesPerHotel are skipped.
 */
export const HOTEL = 5;

export type NewPlayer = { id: string; name: string; color: string };

/**
 * A Deck's draw pile holds each Card once per copy, in Card order (START_GAME shuffles it):
 * none of a disabled Card or one naming a missing Player.
 */
export function buildDeck(cards: Card[]): Deck {
  return { cards, drawPile: cards.flatMap((c) => Array<string>(Math.max(0, wantedCopies(c))).fill(c.id)) };
}

/** Fresh copies of the default Chance and Treasure Decks. */
export function defaultDecks(): Decks {
  return {
    chance: buildDeck(structuredClone(defaultCards.chance)),
    treasure: buildDeck(structuredClone(defaultCards.treasure)),
  };
}

export function createGame(
  roomCode: string,
  host: NewPlayer,
  rules: Rules,
  board: SpaceDefinition[],
  decks: Decks = defaultDecks(),
): GameState {
  const state: GameState = {
    roomCode,
    phase: 'lobby',
    hostId: host.id,
    rules,
    board,
    players: [newPlayer(host, rules, board)],
    spectators: [],
    deeds: {},
    debts: [],
    bankruptcies: [],
    extraTurns: [],
    decks,
    bank: { jackpot: 0 },
    log: [],
  };
  return appendLog(state, [{ type: 'PLAYER_JOINED', playerId: host.id }]);
}

/** `now` is the server's clock in ms; the engine reads it only for Auction countdowns and the turn timer. */
export function applyAction(state: GameState, action: Action, rules: Rules, rng: Rng, now: number): ActionResult {
  const events: GameEvent[] = [];
  if (state.paused && !WHILE_PAUSED.has(action.type)) throw new IllegalActionError('The game is paused');
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
    case 'PAY_JAIL_FINE':
      next = payJailFine(state, action.playerId, rules, events);
      break;
    case 'USE_JAIL_CARD':
      next = useJailCard(state, action.playerId, events);
      break;
    case 'CONTINUE_CARD':
      next = continueCardAction(state, action, rules, rng, events);
      break;
    case 'BUY_PROPERTY':
      next = buy(state, action.playerId, rules, events);
      break;
    case 'DECLINE_PROPERTY':
      next = decline(state, action.playerId, rules, now, events);
      break;
    case 'PLACE_BID':
      next = placeBid(state, action.playerId, action.amount, rules, now, events);
      break;
    case 'PASS_AUCTION':
      next = passAuction(state, action.playerId, rules, now, events);
      break;
    case 'EXPIRE_AUCTION':
      next = expireAuction(state, rules, now, events);
      break;
    case 'EXPIRE_TURN':
      next = expireTurn(state, rules, rng, now, events);
      break;
    case 'BUILD':
      next = build(state, action.playerId, action.index, rules, events);
      break;
    case 'SELL_BUILDING':
      next = sellBuilding(state, action.playerId, action.index, rules, events);
      break;
    case 'MORTGAGE':
      next = mortgage(state, action.playerId, action.index, rules, events);
      break;
    case 'UNMORTGAGE':
      next = unmortgage(state, action.playerId, action.index, rules, events);
      break;
    case 'PROPOSE_TRADE':
      next = proposeTrade(state, action, rules, events);
      break;
    case 'ACCEPT_TRADE':
      next = acceptTrade(state, action.playerId, rules, events);
      break;
    case 'REJECT_TRADE':
      next = closeTrade(state, action.playerId, 'partner', events);
      break;
    case 'WITHDRAW_TRADE':
      next = closeTrade(state, action.playerId, 'proposer', events);
      break;
    case 'END_TURN':
      next = endTurn(state, action.playerId, events);
      break;
    case 'PAY_DEBT':
      next = payDebt(state, action.playerId, rules, events);
      break;
    case 'DECLARE_BANKRUPTCY':
      next = declareBankruptcy(state, action.playerId, rules, now, events);
      break;
    case 'REMATCH':
      next = rematch(state, action.playerId, rng, events);
      break;
    case 'BACK_TO_LOBBY':
      next = backToLobby(state, action.playerId, events);
      break;
    case 'UPDATE_RULES':
      next = updateRules(state, action.playerId, action.changes);
      break;
    case 'UPDATE_BOARD':
      next = updateBoard(state, action.playerId, action.edits);
      break;
    case 'RESET_TO_DEFAULTS':
      next = resetToDefaults(state, action.playerId);
      break;
    case 'ADD_CARD':
      next = addCard(state, action.playerId, action.deck, action.card, rng, events);
      break;
    case 'DELETE_CARD':
      next = deleteCard(state, action.playerId, action.cardId, action.held, rng, events);
      break;
    case 'RESET_DECK':
      next = resetDeck(state, action.playerId, action.deck, rng, events);
      break;
    case 'SHUFFLE_DECK':
      next = shuffleDeck(state, action.playerId, action.deck, rng, events);
      break;
    case 'HIDE_DECK_CONTENTS':
      next = hideDeckContents(state, action.playerId, action.hidden, events);
      break;
    case 'EDIT_CARD':
      next = editCard(state, action.playerId, action.cardId, action.card, action.held, rng, events);
      break;
    case 'LOAD_PRESET':
      next = loadPreset(state, action.playerId, action.preset, rng, events);
      break;
    case 'HOST_OVERRIDE':
      next = hostOverride(state, action.playerId, action.override, rules, now, events);
      break;
    case 'PAUSE':
      next = pause(state, action.playerId, now, events);
      break;
    case 'RESUME':
      next = resume(state, action.playerId, rules, now, events);
      break;
    case 'LEAVE_ROOM':
      next = leaveRoom(state, action.playerId, false, rules, now, events);
      break;
    case 'KICK':
      requireHost(state, action.playerId);
      if (action.targetId === state.hostId) throw new IllegalActionError('You cannot kick yourself');
      next = leaveRoom(state, action.targetId, true, rules, now, events);
      break;
    case 'TRANSFER_HOST':
      requireHost(state, action.playerId);
      next = changeHost(state, action.toId, false, events);
      break;
    case 'HOST_TIMED_OUT':
      next = changeHost(state, action.toId, true, events);
      break;
    case 'END_GAME':
      next = endGame(state, action.playerId, events);
      break;
    case 'ADD_PLAYER':
      next = addPlayer(state, action.playerId, action.spectatorId, rules, events);
      break;
    default:
      throw new IllegalActionError(`Unknown action ${(action as Action).type}`);
  }
  const isEdit =
    action.type === 'UPDATE_RULES' || action.type === 'UPDATE_BOARD' || action.type === 'RESET_TO_DEFAULTS' || action.type === 'LOAD_PRESET';
  next = applyPending(next, events, isEdit);
  next = syncTurnTimer(state, next, events, now);
  return { state: appendLog(next, events), events };
}

/** The steps the turn timer covers. Auctions have their own countdown; Debts and cards wait. */
const TIMED_STEPS = new Set<TurnStep>(['awaitRoll', 'awaitBuyDecision', 'awaitEndTurn']);

/**
 * Keeps the turn timer in line with the game after `events` took it from `before` to `after`. A
 * new turn, step or roll gets a full countdown; anything else (an open Trade included: only its
 * response is untimed) leaves it running. It is off during Auctions, Debts and cards, and whenever
 * turnTimerSeconds is 0. A countdown that starts while paused (the Host turning the timer on)
 * counts from the pause, so resuming gives it in full.
 */
export function syncTurnTimer(before: GameState, after: GameState, events: GameEvent[], now: number): GameState {
  const turn = after.turn;
  if (!turn) return after;
  const full = after.rules.turnTimerSeconds * 1000;
  if (full <= 0 || !TIMED_STEPS.has(turn.step) || after.debts.length > 0) {
    return turn.timerEndsAt === undefined ? after : { ...after, turn: { ...turn, timerEndsAt: undefined } };
  }
  const was = before.turn;
  const fresh =
    turn.timerEndsAt === undefined ||
    was?.playerId !== turn.playerId ||
    was.step !== turn.step ||
    events.some((e) => e.type === 'DICE_ROLLED' || e.type === 'TURN_STARTED');
  if (!fresh) return after;
  return { ...after, turn: { ...turn, timerEndsAt: (after.paused?.at ?? now) + full } };
}

/** The turn timer has run out: the engine takes the default action for the step the turn is at. */
function expireTurn(state: GameState, rules: Rules, rng: Rng, now: number, events: GameEvent[]): GameState {
  const turn = requirePlaying(state);
  if (turn.timerEndsAt === undefined || now < turn.timerEndsAt) throw new IllegalActionError('The turn timer has not run out');
  events.push({ type: 'TURN_TIMED_OUT', playerId: turn.playerId });
  switch (turn.step) {
    case 'awaitRoll':
      return roll(state, turn.playerId, rules, rng, events);
    case 'awaitBuyDecision':
      return decline(state, turn.playerId, rules, now, events);
    case 'awaitEndTurn':
      return endTurn(state, turn.playerId, events);
    default:
      throw new IllegalActionError('The turn timer has not run out');
  }
}

/**
 * What may happen while the game is paused: resuming (and a refused second pause), Host edits that touch no game state or timer,
 * and changes to who is in the Room. Every game action, Override and countdown waits.
 */
const WHILE_PAUSED = new Set<Action['type']>([
  'PAUSE',
  'RESUME',
  'JOIN_ROOM',
  'UPDATE_RULES',
  'UPDATE_BOARD',
  'RESET_TO_DEFAULTS',
  'ADD_CARD',
  'EDIT_CARD',
  'DELETE_CARD',
  'RESET_DECK',
  'SHUFFLE_DECK',
  'HIDE_DECK_CONTENTS',
  'LOAD_PRESET',
  'END_GAME',
  'LEAVE_ROOM',
  'KICK',
  'TRANSFER_HOST',
  'HOST_TIMED_OUT',
  'ADD_PLAYER',
]);

function requireHost(state: GameState, playerId: string): void {
  if (playerId !== state.hostId) throw new IllegalActionError('Only the Host can do that');
}

function requirePlaying(state: GameState): Turn {
  if (state.phase !== 'playing' || !state.turn) throw new IllegalActionError('No game is in progress');
  return state.turn;
}

function pause(state: GameState, playerId: string, now: number, events: GameEvent[]): GameState {
  requireHost(state, playerId);
  requirePlaying(state);
  if (state.paused) throw new IllegalActionError('The game is already paused');
  events.push({ type: 'GAME_PAUSED' });
  return { ...state, paused: { at: now } };
}

/**
 * Play carries on where it stopped. An open Auction or turn timer gets back the time it had left
 * when paused; one that started during the pause gets its full countdown.
 */
function resume(state: GameState, playerId: string, rules: Rules, now: number, events: GameEvent[]): GameState {
  requireHost(state, playerId);
  if (!state.paused) throw new IllegalActionError('The game is not paused');
  events.push({ type: 'GAME_RESUMED' });
  const { auction } = state;
  const { at } = state.paused;
  const left = (endsAt: number, full: number) => Math.min(Math.max(0, endsAt - at), full);
  const { turn } = state;
  return {
    ...state,
    paused: undefined,
    auction: auction && { ...auction, endsAt: now + left(auction.endsAt, rules.auctionSeconds * 1000) },
    turn: turn?.timerEndsAt === undefined ? turn : { ...turn, timerEndsAt: now + left(turn.timerEndsAt, rules.turnTimerSeconds * 1000) },
  };
}

/** The Host role passes to another Player who is still in the game (any Player outside a game). */
function changeHost(state: GameState, toId: string, automatic: boolean, events: GameEvent[]): GameState {
  const to = state.players.find((p) => p.id === toId);
  if (!to || toId === state.hostId || (state.phase === 'playing' && to.bankrupt)) {
    throw new IllegalActionError('Pick another Player still in the game');
  }
  events.push({ type: 'HOST_CHANGED', from: state.hostId, to: toId, automatic });
  return { ...state, hostId: toId };
}

/** The Host stops the game early: it is over, with no Winner. */
function endGame(state: GameState, playerId: string, events: GameEvent[]): GameState {
  requireHost(state, playerId);
  requirePlaying(state);
  events.push({ type: 'GAME_ENDED' });
  return finish(state, undefined);
}

/** The game is over: nothing is left running. A game the Host ended has no Winner. */
function finish(state: GameState, winnerId: string | undefined): GameState {
  return {
    ...state,
    phase: 'finished',
    winnerId,
    paused: undefined,
    turn: undefined,
    auction: undefined,
    auctionQueue: undefined,
    debts: [],
    trade: undefined,
  };
}

/** The Player or Spectator an action takes out of the Room, if any. */
export function departing(action: Action): string | undefined {
  if (action.type === 'LEAVE_ROOM') return action.playerId;
  return action.type === 'KICK' ? action.targetId : undefined;
}

function newPlayer(p: NewPlayer, rules: Rules, board: SpaceDefinition[]): Player {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    cash: rules.startingCash,
    position: goIndex(board) ?? 0,
    inJail: false,
    jailTurns: 0,
    hasPassedGo: false,
    bankrupt: false,
    heldCards: [],
    skipTurns: 0,
  };
}

/** Joins the lobby as a Player; once the game has started, as a Spectator. */
function join(
  state: GameState,
  action: Extract<Action, { type: 'JOIN_ROOM' }>,
  rules: Rules,
  events: GameEvent[],
): GameState {
  const { playerId: id, name, color } = action;
  if (state.players.some((p) => p.id === id) || state.spectators.some((s) => s.id === id)) {
    throw new IllegalActionError('Already in this Room');
  }
  if (state.phase !== 'lobby') {
    events.push({ type: 'SPECTATOR_JOINED', spectatorId: id, name });
    return { ...state, spectators: [...state.spectators, { id, name, color }] };
  }
  if (state.players.length >= rules.maxPlayers) throw new IllegalActionError('The Room is full');
  if (state.players.some((p) => p.color === color)) {
    throw new IllegalActionError('That token colour is taken; pick another');
  }
  events.push({ type: 'PLAYER_JOINED', playerId: id });
  return { ...state, players: [...state.players, newPlayer({ id, name, color }, rules, state.board)] };
}

/**
 * Host only, in the lobby or mid-game: the Spectator becomes a Player with startingCash on GO,
 * last in turn order. Mid-game they first play in the next round. A taken colour is swapped for a
 * free one.
 */
function addPlayer(state: GameState, playerId: string, spectatorId: string, rules: Rules, events: GameEvent[]): GameState {
  requireHost(state, playerId);
  if (state.phase === 'finished') throw new IllegalActionError('Go back to the Lobby first');
  const spectator = state.spectators.find((s) => s.id === spectatorId);
  if (!spectator) throw new IllegalActionError('Pick a Spectator to add');
  if (state.players.length >= rules.maxPlayers) throw new IllegalActionError('The Room is full');
  const taken = new Set(state.players.map((p) => p.color));
  const color = taken.has(spectator.color) ? TOKEN_COLORS.find((c) => !taken.has(c)) ?? spectator.color : spectator.color;
  const added = newPlayer({ ...spectator, color }, rules, state.board);
  events.push({ type: 'PLAYER_ADDED', playerId: spectatorId });
  return {
    ...state,
    players: [...state.players, state.turn ? { ...added, firstRound: state.turn.round + 1 } : added],
    spectators: state.spectators.filter((s) => s.id !== spectatorId),
  };
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

  // Players who joined before a Host edit of startingCash still start with the current amount.
  const players = order.map((id) => ({ ...state.players.find((p) => p.id === id)!, cash: rules.startingCash }));
  const first = players[0]!;
  events.push({ type: 'TURN_STARTED', playerId: first.id, round: 1 });
  return {
    ...state,
    phase: 'playing',
    players,
    decks: shuffledDecks(state.decks, rng),
    turn: { playerId: first.id, step: 'awaitRoll', doublesCount: 0, lastRoll: [], round: 1, cards: [] },
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
  const doubles = isDoubles(dice);
  events.push({ type: 'DICE_ROLLED', playerId, dice, total });

  let next: GameState = { ...state, turn: { ...turn, lastRoll: dice } };
  const fromJail = findPlayer(state, playerId).inJail;
  if (fromJail) {
    if (doubles) {
      next = releaseFromJail(next, playerId, events);
    } else {
      const failedRolls = findPlayer(state, playerId).jailTurns + 1;
      if (failedRolls >= rules.maxJailTurns) {
        // The fine is forced; the roll's move waits until it is paid.
        return chargeForcedJailFine(next, playerId, total, rules, events);
      }
      events.push({ type: 'STILL_IN_JAIL', playerId, failedRolls });
      next = updatePlayer(next, playerId, (p) => ({ ...p, jailTurns: failedRolls }));
      return { ...next, turn: { ...next.turn!, step: 'awaitEndTurn' } };
    }
  }

  // Doubles that get a Player out of Jail earn no extra roll.
  const doublesCount = doubles && !fromJail ? turn.doublesCount + 1 : 0;
  if (doublesCount > 0 && rules.doublesToJail > 0 && doublesCount >= rules.doublesToJail) {
    return sendToJail(next, playerId, 'doubles', events);
  }
  next = { ...next, turn: { ...next.turn!, doublesCount } };
  return land(moveForward(next, playerId, total, rules, events), playerId, rules, events);
}

/** Every die shows the same face; a single die never rolls Doubles. */
function isDoubles(dice: number[]): boolean {
  return dice.length > 1 && dice.every((d) => d === dice[0]);
}

function payJailFine(state: GameState, playerId: string, rules: Rules, events: GameEvent[]): GameState {
  requireTurn(state, playerId, 'awaitRoll');
  const player = findPlayer(state, playerId);
  if (!player.inJail) throw new IllegalActionError('You are not in Jail');
  if (player.cash < rules.jailFine) {
    throw new IllegalActionError(`You need ${rules.jailFine} to pay the fine, but have ${player.cash}`);
  }
  events.push({ type: 'JAIL_FINE_PAID', playerId, amount: rules.jailFine, forced: false });
  return releaseFromJail(settleNow(state, bankDebt(playerId, rules.jailFine), rules), playerId, events);
}

/** The fine once the Player has used up their rolls; the roll's move waits until it is paid. */
function chargeForcedJailFine(state: GameState, playerId: string, total: number, rules: Rules, events: GameEvent[]): GameState {
  events.push({ type: 'JAIL_FINE_PAID', playerId, amount: rules.jailFine, forced: true });
  return charge(releaseFromJail(state, playerId, events), bankDebt(playerId, rules.jailFine), { moveFromJail: total }, rules, events);
}

/**
 * Moves the Player straight to the Jail space without passing GO. For the active Player this also
 * ends their turn, with no extra roll for any Doubles.
 */
function sendToJail(state: GameState, playerId: string, reason: JailReason, events: GameEvent[]): GameState {
  events.push({ type: 'JAILED', playerId, reason });
  const jail = state.board.find((s) => s.type === 'jail')?.index;
  const jailed = updatePlayer(state, playerId, (p) => ({ ...p, position: jail ?? p.position, inJail: true, jailTurns: 0 }));
  if (jailed.turn?.playerId !== playerId) return jailed;
  return { ...jailed, turn: { ...jailed.turn, step: 'awaitEndTurn', doublesCount: 0 } };
}

/** Every way out of Jail ends here: the fine, Doubles and a get-out-of-jail card. */
function releaseFromJail(state: GameState, playerId: string, events: GameEvent[]): GameState {
  events.push({ type: 'LEFT_JAIL', playerId });
  return updatePlayer(state, playerId, (p) => ({ ...p, inJail: false, jailTurns: 0 }));
}

/**
 * Moves `playerId` `steps` spaces clockwise, paying goSalary each time they land on or pass GO
 * (unless `collectGo` is off). A move that ends on GO pays double when doubleSalaryOnExactGo is on.
 */
function moveForward(
  state: GameState,
  playerId: string,
  steps: number,
  rules: Rules,
  events: GameEvent[],
  collectGo = true,
): GameState {
  const size = state.board.length;
  const go = goIndex(state.board);
  const from = findPlayer(state, playerId).position;
  const to = (from + steps) % size;
  events.push({ type: 'MOVED', playerId, from, to });

  const laps = go === undefined ? 0 : Math.floor((((from - go + size) % size) + steps) / size);
  const exactBonus = laps > 0 && to === go && rules.doubleSalaryOnExactGo ? 1 : 0;
  const salary = collectGo ? (laps + exactBonus) * rules.goSalary : 0;
  if (salary > 0) events.push({ type: 'GO_SALARY', playerId, amount: salary });
  return updatePlayer(state, playerId, (p) => ({
    ...p,
    position: to,
    cash: p.cash + salary,
    hasPassedGo: p.hasPassedGo || (collectGo && laps > 0),
  }));
}

/** Moves `playerId` `steps` spaces anticlockwise; going back never collects a salary. */
function moveBack(state: GameState, playerId: string, steps: number, events: GameEvent[]): GameState {
  const size = state.board.length;
  const from = findPlayer(state, playerId).position;
  const to = (((from - steps) % size) + size) % size;
  events.push({ type: 'MOVED', playerId, from, to });
  return updatePlayer(state, playerId, (p) => ({ ...p, position: to }));
}

/** How a card move changes the rent of the property it lands on. */
type RentRule = { rentMultiplier?: number; diceMultiplier?: number };

/** Resolves the space `playerId` is standing on and sets the next turn step. */
function land(state: GameState, playerId: string, rules: Rules, events: GameEvent[], rentRule: RentRule = {}): GameState {
  const player = findPlayer(state, playerId);
  const space = state.board[player.position]!;
  const finishLanding = (s: GameState) => landingResolved(s, rules, events);
  if (space.type === 'goToJail') return resumeCards(sendToJail(state, playerId, 'goToJail', events), rules, events);
  if (space.type === 'chance' || space.type === 'treasure') return drawCard(state, space.type, playerId, rules, events);
  if (space.type === 'tax') {
    const amount = space.taxAmount ?? 0;
    events.push({ type: 'TAX_PAID', playerId, index: space.index, amount });
    return charge(state, bankDebt(playerId, amount), 'landingResolved', rules, events);
  }
  if (space.type === 'freeParking') return finishLanding(freeParking(state, playerId, rules, events));
  if (!isProperty(space)) return finishLanding(state);

  const deed = state.deeds[space.index];
  if (!deed) {
    if (rules.mustCompleteLapBeforeBuying && !player.hasPassedGo) {
      events.push({ type: 'PURCHASE_LOCKED', playerId, index: space.index });
      return finishLanding(state);
    }
    events.push({ type: 'PROPERTY_OFFERED', playerId, index: space.index, price: space.price ?? 0 });
    return { ...state, turn: { ...state.turn!, step: 'awaitBuyDecision' } };
  }

  if (deed.ownerId === playerId) return finishLanding(state);
  const waived = deed.mortgaged
    ? 'mortgaged'
    : findPlayer(state, deed.ownerId).inJail && !rules.collectRentInJail
      ? 'ownerInJail'
      : null;
  if (waived) {
    events.push({ type: 'RENT_WAIVED', playerId, ownerId: deed.ownerId, index: space.index, reason: waived });
    return finishLanding(state);
  }

  const amount = modifiedRent(state, space, rentFor(state, space, deed.ownerId, rules), rentRule);
  events.push({ type: 'RENT_PAID', playerId, ownerId: deed.ownerId, index: space.index, amount });
  const debt: Debt = { debtorId: playerId, creditor: { type: 'player', playerId: deed.ownerId }, amount, feedsJackpot: false };
  return charge(state, debt, 'landingResolved', rules, events);
}

/**
 * Called once the landing space is fully resolved (including any buy decision or Auction): a card
 * being resolved carries on with its next Effect; otherwise the Player rolls again after Doubles
 * when doublesRollAgain is on, or may end their turn.
 */
function landingResolved(state: GameState, rules: Rules, events: GameEvent[]): GameState {
  const turn = state.turn!;
  if (turn.cards.length > 0) return continueCard(state, rules, events);
  if (turn.doublesCount > 0 && rules.doublesRollAgain && !findPlayer(state, turn.playerId).inJail) {
    events.push({ type: 'ROLL_AGAIN', playerId: turn.playerId });
    return { ...state, turn: { ...turn, step: 'awaitRoll' } };
  }
  return { ...state, turn: { ...turn, step: 'awaitEndTurn' } };
}

function freeParking(state: GameState, playerId: string, rules: Rules, events: GameEvent[]): GameState {
  switch (rules.freeParkingMode) {
    case 'fixed': {
      const amount = rules.freeParkingAmount;
      if (amount <= 0) return state;
      events.push({ type: 'FREE_PARKING_PAID', playerId, amount });
      return adjustCash(state, playerId, amount);
    }
    case 'jackpot': {
      const amount = state.bank.jackpot;
      if (amount <= 0) return state;
      events.push({ type: 'JACKPOT_WON', playerId, amount });
      return { ...adjustCash(state, playerId, amount), bank: { ...state.bank, jackpot: 0 } };
    }
    default:
      return state;
  }
}

/** Rent `ownerId` charges on a property, from the current Rules and Board. */
function rentFor(state: GameState, space: SpaceDefinition, ownerId: string, rules: Rules): number {
  const ownedUnmortgaged = (type: SpaceDefinition['type']) =>
    state.board.filter((s) => {
      const deed = state.deeds[s.index];
      return s.type === type && deed?.ownerId === ownerId && !deed.mortgaged;
    }).length;
  // The nth entry of a per-count list; owning more than the list covers uses its last entry.
  const byCount = (list: number[], count: number) => list[Math.min(count, list.length) - 1] ?? 0;

  switch (space.type) {
    case 'street': {
      const buildings = state.deeds[space.index]?.buildings ?? 0;
      if (buildings > 0) return space.rents?.[buildings] ?? 0;
      const base = space.rents?.[0] ?? 0;
      const holdsGroup = space.group !== undefined && colourGroup(state.board, space.group).every((s) => state.deeds[s.index]?.ownerId === ownerId);
      // A payer's share rounds up.
      return holdsGroup ? roundUp(base * rules.colourGroupRentMultiplier) : base;
    }
    case 'station':
      return byCount(rules.stationRents, ownedUnmortgaged('station'));
    case 'utility':
      return roundUp(byCount(rules.utilityMultipliers, ownedUnmortgaged('utility')) * sum(state.turn!.lastRoll));
    default:
      return 0;
  }
}

function buy(state: GameState, playerId: string, rules: Rules, events: GameEvent[]): GameState {
  const turn = requireTurn(state, playerId, 'awaitBuyDecision');
  const player = findPlayer(state, playerId);
  const price = state.board[player.position]!.price ?? 0;
  if (player.cash < price) throw new IllegalActionError(`You need ${price} to buy this, but have ${player.cash}`);

  events.push({ type: 'PROPERTY_BOUGHT', playerId, index: player.position, price });
  const paid = adjustCash(state, playerId, -price);
  const deeds = { ...state.deeds, [player.position]: { ownerId: playerId, buildings: 0, mortgaged: false } };
  return landingResolved({ ...paid, deeds, turn }, rules, events);
}

function decline(state: GameState, playerId: string, rules: Rules, now: number, events: GameEvent[]): GameState {
  const turn = requireTurn(state, playerId, 'awaitBuyDecision');
  const index = findPlayer(state, playerId).position;
  events.push({ type: 'PROPERTY_DECLINED', playerId, index });
  if (!rules.auctionOnDecline) return landingResolved(state, rules, events);

  const endsAt = countdownEnd(rules, now);
  events.push({ type: 'AUCTION_STARTED', index, endsAt });
  return {
    ...state,
    turn: { ...turn, step: 'auction' },
    auction: { index, bidders: activePlayers(state).map((p) => p.id), endsAt },
  };
}

/** When an Auction countdown started (or restarted) at `now` runs out. */
function countdownEnd(rules: Rules, now: number): number {
  return now + rules.auctionSeconds * 1000;
}

/** Checks that an Auction is open and `playerId` is still in it; returns the Auction. */
function requireBidder(state: GameState, playerId: string): Auction {
  const auction = requireAuction(state);
  if (!auction.bidders.includes(playerId)) throw new IllegalActionError('You are out of this Auction');
  return auction;
}

function requireAuction(state: GameState): Auction {
  if (state.turn?.step !== 'auction' || !state.auction) throw new IllegalActionError('No Auction is open');
  return state.auction;
}

function placeBid(
  state: GameState,
  playerId: string,
  amount: number,
  rules: Rules,
  now: number,
  events: GameEvent[],
): GameState {
  const auction = requireBidder(state, playerId);
  const { highBid } = auction;
  if (!Number.isInteger(amount) || amount < 1) throw new IllegalActionError('A bid must be a whole number above 0');
  if (highBid?.playerId === playerId) throw new IllegalActionError('You already have the highest bid');
  if (amount < rules.auctionStartBid) throw new IllegalActionError(`Bidding starts at ${rules.auctionStartBid}`);
  if (highBid && amount <= highBid.amount) throw new IllegalActionError(`You must bid more than ${highBid.amount}`);
  const cash = findPlayer(state, playerId).cash;
  if (amount > cash) throw new IllegalActionError(`You cannot bid more than your cash (${cash})`);

  const endsAt = countdownEnd(rules, now);
  events.push({ type: 'BID_PLACED', playerId, amount, endsAt });
  return settleIfDecided({ ...state, auction: { ...auction, highBid: { playerId, amount }, endsAt } }, rules, now, events);
}

function passAuction(state: GameState, playerId: string, rules: Rules, now: number, events: GameEvent[]): GameState {
  const auction = requireBidder(state, playerId);
  if (auction.highBid?.playerId === playerId) throw new IllegalActionError('You cannot pass while you have the highest bid');
  events.push({ type: 'AUCTION_PASSED', playerId });
  const bidders = auction.bidders.filter((id) => id !== playerId);
  return settleIfDecided({ ...state, auction: { ...auction, bidders } }, rules, now, events);
}

function expireAuction(state: GameState, rules: Rules, now: number, events: GameEvent[]): GameState {
  const auction = requireAuction(state);
  if (now < auction.endsAt) throw new IllegalActionError('The Auction countdown has not run out');
  return settleAuction(state, auction, rules, now, events);
}

/**
 * Ends the Auction once nobody can change the result: everyone has passed, or the only
 * Player left holds the highest bid. A lone Player with no bid yet may still bid.
 */
function settleIfDecided(state: GameState, rules: Rules, now: number, events: GameEvent[]): GameState {
  const auction = state.auction!;
  const [last, ...others] = auction.bidders;
  const decided = last === undefined || (others.length === 0 && auction.highBid?.playerId === last);
  return decided ? settleAuction(state, auction, rules, now, events) : state;
}

/** The highest bidder pays and takes the Deed; with no bids the property stays with the bank. */
function settleAuction(state: GameState, { index, highBid }: Auction, rules: Rules, now: number, events: GameEvent[]): GameState {
  let closed: GameState = { ...state, auction: undefined };
  if (!highBid) {
    events.push({ type: 'AUCTION_UNSOLD', index });
  } else {
    const { playerId, amount } = highBid;
    events.push({ type: 'AUCTION_WON', playerId, index, amount });
    const paid = adjustCash(closed, playerId, -amount);
    closed = { ...paid, deeds: { ...paid.deeds, [index]: { ownerId: playerId, buildings: 0, mortgaged: false } } };
  }
  return closed.auctionQueue ? nextBankruptcyAuction(closed, rules, now, events) : landingResolved(closed, rules, events);
}

/**
 * Checks that `playerId` is the active Player, before rolling or with their landing resolved: when
 * they may build, sell buildings, mortgage and unmortgage.
 */
function requirePropertyMoment(state: GameState, playerId: string): void {
  const turn = state.turn;
  if (state.phase !== 'playing' || !turn) throw new IllegalActionError('The game has not started');
  if (turn.playerId !== playerId) throw new IllegalActionError('It is not your turn');
  if (turn.step !== 'awaitRoll' && turn.step !== 'awaitEndTurn') {
    throw new IllegalActionError(`You cannot do that now (${turn.step})`);
  }
}

/**
 * Checks that `index` is a street `playerId` owns along with its whole, unmortgaged Colour group;
 * returns the street and the group's streets (including it).
 */
function requireBuildableGroup(state: GameState, playerId: string, index: number) {
  const space = state.board[index];
  const deed = state.deeds[index];
  if (!space || space.type !== 'street' || space.group === undefined) {
    throw new IllegalActionError('Only streets in a Colour group can have buildings');
  }
  if (deed?.ownerId !== playerId) throw new IllegalActionError('You do not own that street');
  const group = colourGroup(state.board, space.group);
  if (!group.every((s) => state.deeds[s.index]?.ownerId === playerId)) {
    throw new IllegalActionError('You need the whole Colour group to build');
  }
  if (group.some((s) => state.deeds[s.index]!.mortgaged)) {
    throw new IllegalActionError('No street in the Colour group may be mortgaged');
  }
  return { space, deed, group };
}

/**
 * A street's step on the way to a hotel, for evenBuildRule: its house count, then one more for the
 * hotel. Houses above a since-lowered housesPerHotel count as the limit, since the next build there
 * is the hotel.
 */
function buildLevel(buildings: number, rules: Rules): number {
  return buildings === HOTEL ? rules.housesPerHotel + 1 : Math.min(buildings, rules.housesPerHotel);
}

/**
 * Houses and hotels standing on the Board. The bank's stock for bankHouses / bankHotels is the
 * limit minus these, so a hotel hands its houses back to the bank.
 */
function buildingsInPlay(state: GameState): { houses: number; hotels: number } {
  const counts = Object.values(state.deeds).map((d) => d.buildings);
  return {
    houses: sum(counts.filter((b) => b !== HOTEL)),
    hotels: counts.filter((b) => b === HOTEL).length,
  };
}

/**
 * Like requirePropertyMoment, but a Player who owes the first queued Debt may also sell and mortgage
 * to cover it, whoever's turn it is.
 */
function requireSellMoment(state: GameState, playerId: string): void {
  if (state.turn?.step === 'awaitDebt' && state.debts[0]?.debtorId === playerId) return;
  requirePropertyMoment(state, playerId);
}

function build(state: GameState, playerId: string, index: number, rules: Rules, events: GameEvent[]): GameState {
  requirePropertyMoment(state, playerId);
  const { space, deed, group } = requireBuildableGroup(state, playerId, index);
  if (deed.buildings === HOTEL) throw new IllegalActionError('This street already has a hotel');
  if (rules.evenBuildRule) {
    const lowest = Math.min(...group.map((s) => buildLevel(state.deeds[s.index]!.buildings, rules)));
    if (buildLevel(deed.buildings, rules) > lowest) {
      throw new IllegalActionError('Build evenly: build on the other streets in this Colour group first');
    }
  }
  const buildings = deed.buildings >= rules.housesPerHotel ? HOTEL : deed.buildings + 1;
  const { houses, hotels } = buildingsInPlay(state);
  if (buildings === HOTEL && rules.bankHotels !== null && hotels >= rules.bankHotels) {
    throw new IllegalActionError('The bank has no hotels left');
  }
  if (buildings !== HOTEL && rules.bankHouses !== null && houses >= rules.bankHouses) {
    throw new IllegalActionError('The bank has no houses left');
  }
  const cost = space.houseCost ?? 0;
  const cash = findPlayer(state, playerId).cash;
  if (cash < cost) throw new IllegalActionError(`You need ${cost} to build here, but have ${cash}`);
  events.push({ type: 'BUILDING_BUILT', playerId, index, buildings, cost });
  const deeds = { ...state.deeds, [index]: { ...deed, buildings } };
  return { ...adjustCash(state, playerId, -cost), deeds };
}

function sellBuilding(state: GameState, playerId: string, index: number, rules: Rules, events: GameEvent[]): GameState {
  requireSellMoment(state, playerId);
  const { space, deed } = requireOwnedProperty(state, playerId, index);
  if (deed.buildings === 0) throw new IllegalActionError('There are no buildings on that street');
  if (rules.evenBuildRule) {
    const group = colourGroup(state.board, space.group);
    const highest = Math.max(...group.map((s) => buildLevel(state.deeds[s.index]?.buildings ?? 0, rules)));
    if (buildLevel(deed.buildings, rules) < highest) {
      throw new IllegalActionError('Sell evenly: sell from the other streets in this Colour group first');
    }
  }
  const buildings = deed.buildings === HOTEL ? rules.housesPerHotel : deed.buildings - 1;
  // A Player's receipt rounds down.
  const amount = roundDown((space.houseCost ?? 0) * rules.buildingSellbackRate);
  events.push({ type: 'BUILDING_SOLD', playerId, index, buildings, amount });
  const deeds = { ...state.deeds, [index]: { ...deed, buildings } };
  return { ...adjustCash(state, playerId, amount), deeds };
}

/**
 * What the bank pays for mortgaging a property: mortgageRate of its current List price, rounded
 * down as a Player's receipt.
 */
export function mortgageValue(space: SpaceDefinition, rules: Rules): number {
  return roundDown((space.price ?? 0) * rules.mortgageRate);
}

/** What lifting a mortgage costs: the mortgage value plus unmortgageInterest on it, rounded up. */
export function unmortgageCost(space: SpaceDefinition, rules: Rules): number {
  const value = mortgageValue(space, rules);
  return value + roundUp(value * rules.unmortgageInterest);
}

/** Whether any street in `space`'s Colour group has buildings; always false for stations and utilities. */
export function groupHasBuildings(state: GameState, space: SpaceDefinition): boolean {
  return space.type === 'street' && colourGroup(state.board, space.group).some((s) => (state.deeds[s.index]?.buildings ?? 0) > 0);
}

/** Checks that `index` is a property `playerId` owns; returns it and its Deed. */
function requireOwnedProperty(state: GameState, playerId: string, index: number) {
  const space = state.board[index];
  const deed = state.deeds[index];
  if (!space || !isProperty(space) || deed?.ownerId !== playerId) {
    throw new IllegalActionError('You do not own that property');
  }
  return { space, deed };
}

function mortgage(state: GameState, playerId: string, index: number, rules: Rules, events: GameEvent[]): GameState {
  requireSellMoment(state, playerId);
  const { space, deed } = requireOwnedProperty(state, playerId, index);
  if (deed.mortgaged) throw new IllegalActionError('That property is already mortgaged');
  if (groupHasBuildings(state, space)) {
    throw new IllegalActionError('Sell the buildings in this Colour group first');
  }
  const amount = mortgageValue(space, rules);
  events.push({ type: 'PROPERTY_MORTGAGED', playerId, index, amount });
  const deeds = { ...state.deeds, [index]: { ...deed, mortgaged: true } };
  return { ...adjustCash(state, playerId, amount), deeds };
}

function unmortgage(state: GameState, playerId: string, index: number, rules: Rules, events: GameEvent[]): GameState {
  requirePropertyMoment(state, playerId);
  const { space, deed } = requireOwnedProperty(state, playerId, index);
  if (!deed.mortgaged) throw new IllegalActionError('That property is not mortgaged');
  const cost = unmortgageCost(space, rules);
  const cash = findPlayer(state, playerId).cash;
  if (cash < cost) throw new IllegalActionError(`You need ${cost} to unmortgage this, but have ${cash}`);
  events.push({ type: 'PROPERTY_UNMORTGAGED', playerId, index, cost });
  const deeds = { ...state.deeds, [index]: { ...deed, mortgaged: false } };
  return { ...adjustCash(state, playerId, -cost), deeds };
}

/** The streets of a Colour group, in Board order. */
export function colourGroup(board: SpaceDefinition[], group: string | undefined): SpaceDefinition[] {
  return board.filter((s) => s.type === 'street' && s.group === group);
}

/** Streets, stations and utilities: the spaces that can have a Deed. */
export function isProperty(space: SpaceDefinition): boolean {
  return space.type === 'street' || space.type === 'station' || space.type === 'utility';
}

function findPlayer(state: GameState, playerId: string): Player {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new IllegalActionError('No such Player in this Room');
  return player;
}

function updatePlayer(state: GameState, playerId: string, fn: (p: Player) => Player): GameState {
  return { ...state, players: state.players.map((p) => (p.id === playerId ? fn(p) : p)) };
}

/** Adds `delta` (negative to charge) to a Player's cash. */
function adjustCash(state: GameState, playerId: string, delta: number): GameState {
  return updatePlayer(state, playerId, (p) => ({ ...p, cash: p.cash + delta }));
}

function goIndex(board: SpaceDefinition[]): number | undefined {
  return board.find((s) => s.type === 'go')?.index;
}

/** Whether `playerId` may propose a Trade to `partnerId` right now, ignoring any open offer. */
function mayPropose(state: GameState, playerId: string, partnerId: string): boolean {
  const turn = state.turn;
  const debtor = turn?.step === 'awaitDebt' ? state.debts[0]?.debtorId : undefined;
  return turn?.playerId === playerId || turn?.playerId === partnerId || debtor === playerId;
}

/** Checks that `side` hands over only what `owner` has, and that nothing in it is locked by buildings. */
function requireTradeSide(state: GameState, owner: Player, side: TradeSide): void {
  const { cash, properties, cards } = side;
  if (!Number.isInteger(cash) || cash < 0) throw new IllegalActionError('Trade cash must be a whole number, 0 or more');
  if (cash > owner.cash) throw new IllegalActionError(`${owner.name} does not have ${cash} to trade`);
  if (new Set(properties).size !== properties.length) throw new IllegalActionError('A property is listed twice');
  for (const index of properties) {
    const space = state.board[index];
    if (!space || !isProperty(space) || state.deeds[index]?.ownerId !== owner.id) {
      throw new IllegalActionError(`${owner.name} does not own that property`);
    }
    if (groupHasBuildings(state, space)) {
      throw new IllegalActionError('Sell the buildings in that Colour group before trading its streets');
    }
  }
  const held = [...owner.heldCards];
  for (const id of cards) {
    const at = held.indexOf(id);
    if (at < 0) throw new IllegalActionError(`${owner.name} does not hold that card`);
    held.splice(at, 1);
  }
}

function requireTradingOpen(state: GameState, rules: Rules): void {
  if (state.phase !== 'playing' || !state.turn) throw new IllegalActionError('The game has not started');
  if (!rules.tradingEnabled) throw new IllegalActionError('Trading is turned off');
}

function proposeTrade(
  state: GameState,
  action: Extract<Action, { type: 'PROPOSE_TRADE' }>,
  rules: Rules,
  events: GameEvent[],
): GameState {
  requireTradingOpen(state, rules);
  const { playerId, partnerId, give, take } = action;
  if (playerId === partnerId) throw new IllegalActionError('You cannot trade with yourself');
  const proposer = findPlayer(state, playerId);
  const partner = findPlayer(state, partnerId);
  if (proposer.bankrupt || partner.bankrupt) throw new IllegalActionError('Bankrupt Players cannot trade');
  const open = state.trade;
  const isCounter = open?.partnerId === playerId && open.proposerId === partnerId;
  const isRevision = open?.proposerId === playerId && open.partnerId === partnerId;
  if (open && !isCounter && !isRevision) throw new IllegalActionError('Another offer is already open');
  if (!open && !mayPropose(state, playerId, partnerId)) {
    throw new IllegalActionError('You cannot propose a trade to that Player right now');
  }
  const empty = (s: TradeSide) => s.cash === 0 && s.properties.length === 0 && s.cards.length === 0;
  if (empty(give) && empty(take)) throw new IllegalActionError('The offer is empty');
  requireTradeSide(state, proposer, give);
  requireTradeSide(state, partner, take);
  const trade: Trade = { proposerId: playerId, partnerId, give, take };
  events.push({ type: 'TRADE_PROPOSED', trade, counter: isCounter });
  return { ...state, trade };
}

/** Clears the open offer for its `role`: the partner rejects it, the proposer withdraws it. */
function closeTrade(state: GameState, playerId: string, role: 'proposer' | 'partner', events: GameEvent[]): GameState {
  const trade = state.trade;
  if (!trade) throw new IllegalActionError('There is no open offer');
  if ((role === 'proposer' ? trade.proposerId : trade.partnerId) !== playerId) {
    throw new IllegalActionError(role === 'proposer' ? 'Only the proposer can withdraw the offer' : 'Only the partner can reject the offer');
  }
  events.push({ type: role === 'proposer' ? 'TRADE_WITHDRAWN' : 'TRADE_REJECTED', trade });
  return { ...state, trade: undefined };
}

function acceptTrade(state: GameState, playerId: string, rules: Rules, events: GameEvent[]): GameState {
  requireTradingOpen(state, rules);
  const trade = state.trade;
  if (!trade) throw new IllegalActionError('There is no open offer');
  if (trade.partnerId !== playerId) throw new IllegalActionError('Only the partner can accept the offer');
  const { proposerId, partnerId, give, take } = trade;
  // The sides may have changed since the offer was made.
  requireTradeSide(state, findPlayer(state, proposerId), give);
  requireTradeSide(state, findPlayer(state, partnerId), take);

  const deeds = { ...state.deeds };
  for (const index of give.properties) deeds[index] = { ...deeds[index]!, ownerId: partnerId };
  for (const index of take.properties) deeds[index] = { ...deeds[index]!, ownerId: proposerId };
  const swap = (p: Player, out: TradeSide, into: TradeSide): Player => {
    const held = [...p.heldCards];
    for (const id of out.cards) held.splice(held.indexOf(id), 1);
    return { ...p, cash: p.cash - out.cash + into.cash, heldCards: [...held, ...into.cards] };
  };
  const players = state.players.map((p) =>
    p.id === proposerId ? swap(p, give, take) : p.id === partnerId ? swap(p, take, give) : p,
  );
  events.push({ type: 'TRADE_COMPLETED', trade });
  return { ...state, players, deeds, trade: undefined };
}

function endTurn(state: GameState, playerId: string, events: GameEvent[]): GameState {
  requireTurn(state, playerId, 'awaitEndTurn');
  events.push({ type: 'TURN_ENDED', playerId });
  return passTurn(state, events);
}

/**
 * Starts the next turn: an extra turn a card granted, else the next Player in turn order who is
 * not bankrupt, has no turns left to skip and (if added mid-game) has reached their first round.
 */
function passTurn(state: GameState, events: GameEvent[]): GameState {
  const turn = state.turn!;
  const owner = turn.resumeAfter ?? turn.playerId;
  const [extraId, ...laterExtras] = state.extraTurns.filter((id) => !findPlayer(state, id).bankrupt);
  if (extraId !== undefined) {
    events.push({ type: 'TURN_STARTED', playerId: extraId, round: turn.round });
    return {
      ...state,
      extraTurns: laterExtras,
      turn: { playerId: extraId, step: 'awaitRoll', doublesCount: 0, lastRoll: [], round: turn.round, cards: [], resumeAfter: owner },
    };
  }

  const index = state.players.findIndex((p) => p.id === owner);
  const size = state.players.length;
  let players = state.players;
  let step = 1;
  const roundOf = (step: number) => (index + step >= size ? turn.round + 1 : turn.round);
  for (;;) {
    const candidate = players[(index + step) % size]!;
    const waiting = candidate.firstRound !== undefined && candidate.firstRound > roundOf(step);
    if (!candidate.bankrupt && !waiting && candidate.skipTurns === 0) break;
    if (!candidate.bankrupt && !waiting) {
      events.push({ type: 'TURN_SKIPPED', playerId: candidate.id });
      players = players.map((p) => (p.id === candidate.id ? { ...p, skipTurns: p.skipTurns - 1 } : p));
    }
    step++;
  }
  const next = players[(index + step) % size]!;
  const round = roundOf(step);
  events.push({ type: 'TURN_STARTED', playerId: next.id, round });
  return {
    ...state,
    players,
    extraTurns: [],
    turn: { playerId: next.id, step: 'awaitRoll', doublesCount: 0, lastRoll: [], round, cards: [] },
  };
}

function activePlayers(state: GameState): Player[] {
  return state.players.filter((p) => !p.bankrupt);
}

function bankDebt(debtorId: string, amount: number): Debt {
  return { debtorId, creditor: { type: 'bank' }, amount, feedsJackpot: true };
}

/** Moves a Debt's cash now; the debtor must already be able to cover it. */
function settleNow(state: GameState, debt: Debt, rules: Rules): GameState {
  const paid = adjustCash(state, debt.debtorId, -debt.amount);
  if (debt.creditor.type === 'player') return adjustCash(paid, debt.creditor.playerId, debt.amount);
  if (!debt.feedsJackpot || rules.freeParkingMode !== 'jackpot') return paid;
  return { ...paid, bank: { ...paid.bank, jackpot: paid.bank.jackpot + debt.amount } };
}

/**
 * Queues `debt` behind any already waiting and settles what can be paid. If the debtor cannot cover
 * the first Debt, play stops at the 'awaitDebt' step until they pay or go bankrupt; otherwise
 * the turn carries on as `afterDebts` says.
 */
function charge(state: GameState, debt: Debt, afterDebts: AfterDebts, rules: Rules, events: GameEvent[]): GameState {
  return chargeAll(state, [debt], afterDebts, rules, events);
}

/** Like `charge` for several Debts at once, queued in the order given. */
function chargeAll(state: GameState, debts: Debt[], afterDebts: AfterDebts, rules: Rules, events: GameEvent[]): GameState {
  const queued = { ...state, debts: [...state.debts, ...debts], turn: { ...state.turn!, afterDebts } };
  return resumeTurn(queued, rules, events);
}

/** Pays the Debts at the head of the queue that their debtors can cover, then carries on or blocks. */
function resumeTurn(state: GameState, rules: Rules, events: GameEvent[]): GameState {
  let next = state;
  for (;;) {
    const head = next.debts[0];
    if (!head) break;
    if (findPlayer(next, head.debtorId).cash < head.amount) {
      events.push({ type: 'DEBT_OWED', debtorId: head.debtorId, creditor: head.creditor, amount: head.amount });
      return { ...next, turn: { ...next.turn!, step: 'awaitDebt' } };
    }
    next = { ...settleNow(next, head, rules), debts: next.debts.slice(1) };
  }

  const turn = next.turn!;
  const { afterDebts } = turn;
  const resumed: GameState = { ...next, turn: { ...turn, afterDebts: undefined } };
  if (findPlayer(resumed, turn.playerId).bankrupt) return passTurn(resumed, events);
  if (typeof afterDebts === 'object') {
    const moving = { ...resumed, turn: { ...resumed.turn!, doublesCount: 0 } };
    return land(moveForward(moving, turn.playerId, afterDebts.moveFromJail, rules, events), turn.playerId, rules, events);
  }
  return landingResolved(resumed, rules, events);
}

function requireDebtor(state: GameState, playerId: string): Debt {
  const debt = state.debts[0];
  if (state.turn?.step !== 'awaitDebt' || !debt) throw new IllegalActionError('You owe nothing right now');
  if (debt.debtorId !== playerId) throw new IllegalActionError('That Debt is not yours');
  return debt;
}

function payDebt(state: GameState, playerId: string, rules: Rules, events: GameEvent[]): GameState {
  const debt = requireDebtor(state, playerId);
  const cash = findPlayer(state, playerId).cash;
  if (cash < debt.amount) throw new IllegalActionError(`You need ${debt.amount} to pay this Debt, but have ${cash}`);
  events.push({ type: 'DEBT_PAID', debtorId: playerId, creditor: debt.creditor, amount: debt.amount });
  const paid = { ...settleNow(state, debt, rules), debts: state.debts.slice(1) };
  return resumeTurn(paid, rules, events);
}

function declareBankruptcy(state: GameState, playerId: string, rules: Rules, now: number, events: GameEvent[]): GameState {
  const debt = requireDebtor(state, playerId);
  if (findPlayer(state, playerId).cash >= debt.amount) {
    throw new IllegalActionError('You can cover this Debt, so you cannot declare Bankruptcy');
  }
  return bankrupt(state, playerId, debt.creditor, rules, now, events);
}

/**
 * Takes `playerId` out of the game. Everything they have left goes to `creditor`; Debts they owe, or
 * that were owed to them, are cancelled. A bank Creditor has the properties Auctioned unmortgaged,
 * one by one. Buildings stay on streets that pass to a Player and are cleared for the bank. Kept
 * cards go to a Player Creditor, or back to the bottom of their Decks for the bank.
 */
function bankrupt(state: GameState, playerId: string, creditor: Creditor, rules: Rules, now: number, events: GameEvent[]): GameState {
  const { state: next, owned } = applyBankruptcy(state, playerId, creditor, events);
  if (next.phase === 'finished') return next;
  if (owned.length > 0) return nextBankruptcyAuction({ ...next, auctionQueue: owned }, rules, now, events);
  return resumeTurn(next, rules, events);
}

/**
 * The Bankruptcy itself, before play carries on. Returns the properties a bank Creditor now has to
 * Auction, in Board order. Ends the game when one Player is left.
 */
function applyBankruptcy(state: GameState, playerId: string, creditor: Creditor, events: GameEvent[]): { state: GameState; owned: number[] } {
  events.push({ type: 'BANKRUPT', playerId, creditor });
  const player = findPlayer(state, playerId);
  const owned = Object.keys(state.deeds)
    .map(Number)
    .filter((i) => state.deeds[i]!.ownerId === playerId)
    .sort((a, b) => a - b);

  let next = updatePlayer(state, playerId, (p) => ({
    ...p,
    cash: 0,
    bankrupt: true,
    inJail: false,
    jailTurns: 0,
    heldCards: [],
    skipTurns: 0,
  }));
  next = creditor.type === 'player' ? giveCards(next, creditor.playerId, player.heldCards) : returnCards(next, player.heldCards);
  const deeds = { ...next.deeds };
  for (const i of owned) delete deeds[i];
  if (creditor.type === 'player') {
    for (const i of owned) deeds[i] = { ...state.deeds[i]!, ownerId: creditor.playerId };
    next = adjustCash(next, creditor.playerId, player.cash);
  }
  const cancelled = (d: Debt) =>
    d.debtorId === playerId || (d.creditor.type === 'player' && d.creditor.playerId === playerId);
  next = {
    ...next,
    deeds,
    bankruptcies: [...next.bankruptcies, playerId],
    extraTurns: next.extraTurns.filter((id) => id !== playerId),
    debts: next.debts.filter((d) => !cancelled(d)),
    trade: next.trade && (next.trade.proposerId === playerId || next.trade.partnerId === playerId) ? undefined : next.trade,
  };

  const left = activePlayers(next);
  if (left.length === 1) {
    const winnerId = left[0]!.id;
    events.push({ type: 'GAME_OVER', winnerId });
    return { state: finish(next, winnerId), owned: [] };
  }
  return { state: next, owned: creditor.type === 'bank' ? owned : [] };
}

/**
 * A Player or Spectator leaves, or is kicked. In the lobby or after the game they are simply gone;
 * mid-game a Player goes bankrupt to the bank and keeps their row, so turn order is kept.
 */
function leaveRoom(state: GameState, id: string, kicked: boolean, rules: Rules, now: number, events: GameEvent[]): GameState {
  const spectator = state.spectators.find((s) => s.id === id);
  if (spectator) {
    events.push({ type: 'LEFT_ROOM', id, name: spectator.name, kicked });
    return { ...state, spectators: state.spectators.filter((s) => s.id !== id) };
  }
  const player = state.players.find((p) => p.id === id);
  if (!player) throw new IllegalActionError('Not in this Room');
  if (id === state.hostId) throw new IllegalActionError('Hand the Host role to another Player before leaving');
  // Going bankrupt would move play on, which a pause freezes.
  if (state.paused) throw new IllegalActionError('The game is paused; resume it first');
  events.push({ type: 'LEFT_ROOM', id, name: player.name, kicked });
  if (state.phase !== 'playing') {
    return { ...state, players: state.players.filter((p) => p.id !== id), bankruptcies: state.bankruptcies.filter((b) => b !== id) };
  }
  return player.bankrupt ? state : departMidGame(state, id, rules, now, events);
}

/**
 * Bankruptcy to the bank for a Player who left, at whatever point the turn is. They are out of an
 * open Auction (a bid of theirs no longer counts) and their properties are Auctioned after it. Their
 * own turn, or a Debt being settled, carries on as after any Bankruptcy; anyone else's turn goes
 * back to where it was once their properties are sold.
 */
function departMidGame(state: GameState, id: string, rules: Rules, now: number, events: GameEvent[]): GameState {
  const turn = state.turn!;
  const auction = state.auction && {
    ...state.auction,
    bidders: state.auction.bidders.filter((b) => b !== id),
    highBid: state.auction.highBid?.playerId === id ? undefined : state.auction.highBid,
  };
  const { state: out, owned } = applyBankruptcy({ ...state, auction }, id, { type: 'bank' }, events);
  if (out.phase === 'finished') return out;
  if (out.auction) {
    // Queued even when empty, so the Auction closing carries on as after a Bankruptcy.
    return settleIfDecided({ ...out, auctionQueue: [...(out.auctionQueue ?? []), ...owned] }, rules, now, events);
  }
  if (turn.step === 'awaitDebt' || turn.playerId === id) {
    if (owned.length > 0) return nextBankruptcyAuction({ ...out, auctionQueue: owned }, rules, now, events);
    return resumeTurn(out, rules, events);
  }
  if (owned.length === 0) return out;
  return nextBankruptcyAuction({ ...out, auctionQueue: owned, turn: { ...out.turn!, resumeStep: turn.step } }, rules, now, events);
}

/** Opens the Auction for the next property of a bank Bankruptcy, or carries on once none are left. */
function nextBankruptcyAuction(state: GameState, rules: Rules, now: number, events: GameEvent[]): GameState {
  const [index, ...rest] = state.auctionQueue!;
  if (index === undefined) {
    const { resumeStep, ...turn } = state.turn!;
    if (resumeStep) return { ...state, auctionQueue: undefined, turn: { ...turn, step: resumeStep } };
    return resumeTurn({ ...state, auctionQueue: undefined }, rules, events);
  }
  const endsAt = countdownEnd(rules, now);
  events.push({ type: 'AUCTION_STARTED', index, endsAt });
  return {
    ...state,
    turn: { ...state.turn!, step: 'auction' },
    auction: { index, bidders: activePlayers(state).map((p) => p.id), endsAt },
    auctionQueue: rest,
  };
}

/** Everyone starts again with `rules` and `board`: cash, tokens and all game state reset. */
function freshGame(state: GameState, rules: Rules, board: SpaceDefinition[], decks: Decks): GameState {
  return {
    ...state,
    rules,
    board,
    decks,
    extraTurns: [],
    players: state.players.map((p) => newPlayer(p, rules, board)),
    deeds: {},
    debts: [],
    trade: undefined,
    pendingEdit: undefined,
    rulesChangedMidGame: undefined,
    bankruptcies: [],
    winnerId: undefined,
    auction: undefined,
    auctionQueue: undefined,
    turn: undefined,
    bank: { jackpot: 0 },
    log: [],
  };
}

function requireHostAtGameOver(state: GameState, playerId: string): void {
  if (state.phase !== 'finished') throw new IllegalActionError('The game is not over');
  if (playerId !== state.hostId) throw new IllegalActionError('Only the Host can do that');
}

/** Same Players in a new random order (no roll-off), with the Defaults restored. */
function rematch(state: GameState, playerId: string, rng: Rng, events: GameEvent[]): GameState {
  requireHostAtGameOver(state, playerId);
  const fresh = freshGame(state, structuredClone(defaultRules), structuredClone(defaultBoard), defaultDecks());
  const order = shuffle(fresh.players, rng);
  events.push({ type: 'GAME_STARTED' });
  events.push({ type: 'TURN_ORDER_SET', playerIds: order.map((p) => p.id) });
  events.push({ type: 'TURN_STARTED', playerId: order[0]!.id, round: 1 });
  return {
    ...fresh,
    phase: 'playing',
    players: order,
    decks: shuffledDecks(fresh.decks, rng),
    turn: { playerId: order[0]!.id, step: 'awaitRoll', doublesCount: 0, lastRoll: [], round: 1, cards: [] },
  };
}

/** Back to the Lobby with the Rules and Board as they were at the end of the game. */
function backToLobby(state: GameState, playerId: string, events: GameEvent[]): GameState {
  requireHostAtGameOver(state, playerId);
  events.push({ type: 'RETURNED_TO_LOBBY' });
  const decks = { chance: buildDeck(state.decks.chance.cards), treasure: buildDeck(state.decks.treasure.cards) };
  return { ...freshGame(state, state.rules, state.board, decks), phase: 'lobby' };
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

/**
 * Rounds a calculated amount a Player pays up to a whole number. The tolerance stops float noise in
 * rate products, such as 30 × 0.1 = 3.0000000000000004, from rounding a whole amount.
 */
function roundUp(x: number): number {
  return Math.ceil(x - 1e-9);
}

/** Rounds a calculated amount a Player receives down to a whole number, with roundUp's tolerance. */
function roundDown(x: number): number {
  return Math.floor(x + 1e-9);
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Both Decks with their draw piles rebuilt from the Cards and shuffled. */
function shuffledDecks(decks: Decks, rng: Rng): Decks {
  const fresh = (deck: Deck): Deck => ({ ...deck, drawPile: shuffle(buildDeck(deck.cards).drawPile, rng) });
  return { chance: fresh(decks.chance), treasure: fresh(decks.treasure) };
}

// ---- Cards ----

function findCard(state: GameState, cardId: string): Card | undefined {
  return [...state.decks.chance.cards, ...state.decks.treasure.cards].find((c) => c.id === cardId);
}

/**
 * Puts each card at the bottom of its Deck, unless the Host has since deleted or disabled it or
 * lowered its copies (a held card the Host let a Player keep is then gone once used).
 */
function returnCards(state: GameState, cardIds: string[]): GameState {
  let next = state;
  for (const id of cardIds) {
    const card = findCard(next, id);
    if (!card || copiesInPlay(next, card) >= wantedCopies(card)) continue;
    const deck = next.decks[card.deck];
    next = { ...next, decks: { ...next.decks, [card.deck]: { ...deck, drawPile: [...deck.drawPile, id] } } };
  }
  return next;
}

function giveCards(state: GameState, playerId: string, cardIds: string[]): GameState {
  return updatePlayer(state, playerId, (p) => ({ ...p, heldCards: [...p.heldCards, ...cardIds] }));
}

/** Leaving Jail with a held get-out-of-jail card, which goes back to the bottom of its Deck. */
function useJailCard(state: GameState, playerId: string, events: GameEvent[]): GameState {
  requireTurn(state, playerId, 'awaitRoll');
  const player = findPlayer(state, playerId);
  if (!player.inJail) throw new IllegalActionError('You are not in Jail');
  const [cardId, ...kept] = player.heldCards;
  if (cardId === undefined) throw new IllegalActionError('You have no get-out-of-jail card');
  events.push({ type: 'JAIL_CARD_USED', playerId, cardId });
  const returned = returnCards(updatePlayer(state, playerId, (p) => ({ ...p, heldCards: kept })), [cardId]);
  return releaseFromJail(returned, playerId, events);
}

/** Rent after a card move: a multiple of the usual rent, or a multiple of the last dice roll. */
function modifiedRent(state: GameState, space: SpaceDefinition, rent: number, { rentMultiplier, diceMultiplier }: RentRule): number {
  if (diceMultiplier !== undefined && space.type === 'utility') return roundUp(diceMultiplier * sum(state.turn!.lastRoll));
  return rentMultiplier !== undefined ? roundUp(rent * rentMultiplier) : rent;
}

/** Draws the top card of a Deck for `playerId`, revealing it; it waits there for CONTINUE_CARD. */
function drawCard(state: GameState, kind: DeckKind, playerId: string, rules: Rules, events: GameEvent[]): GameState {
  const deck = state.decks[kind];
  const [top, ...rest] = deck.drawPile;
  const card = deck.cards.find((c) => c.id === top);
  if (top === undefined || !card) {
    events.push({ type: 'DECK_EMPTY', playerId, deck: kind });
    return landingResolved(state, rules, events);
  }
  const active: ActiveCard = {
    cardId: card.id,
    deck: kind,
    title: card.title,
    text: renderCardText(state, card, playerId),
    remaining: card.effects,
  };
  events.push({ type: 'CARD_DRAWN', playerId, deck: kind, cardId: card.id, title: card.title, text: active.text });
  // The card goes to the bottom now, so it is never lost; a kept card comes out again when it is held.
  const decks = { ...state.decks, [kind]: { ...deck, drawPile: [...rest, top] } };
  return { ...state, decks, turn: { ...state.turn!, step: 'awaitCard', cards: [...state.turn!.cards, active] } };
}

/** The card's text with {from}, {to} and {amount} filled in from its first Transfer. */
function renderCardText(state: GameState, card: Card, drawerId: string): string {
  const transfer = card.effects.find((e) => e.type === 'TRANSFER');
  if (transfer?.type !== 'TRANSFER') return card.text;
  return card.text
    .replace(/\{from\}/g, () => describeParty(state, transfer.from, drawerId))
    .replace(/\{to\}/g, () => describeParty(state, transfer.to, drawerId))
    .replace(/\{amount\}/g, () => describeAmount(state, transfer.amount));
}

function describeParty(state: GameState, selector: PartySelector, drawerId: string): string {
  switch (selector) {
    case 'bank':
      return 'the bank';
    case 'allOthers':
      return 'every other player';
    case 'everyone':
      return 'everyone';
    case 'drawerChoice':
      return 'the player of your choice';
    case 'random':
      return 'a random player';
    default: {
      const [party] = resolveParty(state, selector, drawerId) ?? [];
      const player = party?.type === 'player' ? state.players.find((p) => p.id === party.playerId) : undefined;
      return player?.name ?? 'a missing player';
    }
  }
}

function describeAmount(state: GameState, amount: Amount): string {
  const percent = typeof amount === 'string' ? /^percentOfCash\(\s*(\d+(?:\.\d+)?)\s*\)$/.exec(amount.trim()) : null;
  if (percent) return `${percent[1]}% of cash`;
  return String(evalAmount(amount, state.turn?.lastRoll ?? [], 0) ?? amount);
}

/** A number, `dice`, `dice * N` or `percentOfCash(N)` (of `payerCash`), rounded up; null if not understood. */
function evalAmount(amount: Amount, lastRoll: number[], payerCash: number): number | null {
  if (typeof amount === 'number') return Number.isFinite(amount) ? amount : null;
  const expr = amount.trim();
  const dice = /^dice(?:\s*\*\s*(\d+(?:\.\d+)?))?$/.exec(expr);
  if (dice) return roundUp(sum(lastRoll) * Number(dice[1] ?? 1));
  const percent = /^percentOfCash\(\s*(\d+(?:\.\d+)?)\s*\)$/.exec(expr);
  if (percent) return roundUp((payerCash * Number(percent[1])) / 100);
  return null;
}

/** The Player before (-1) or after (1) `playerId` in turn order who is still in the game. */
function neighbour(state: GameState, playerId: string, direction: 1 | -1): Player {
  const size = state.players.length;
  const index = state.players.findIndex((p) => p.id === playerId);
  for (let step = 1; step <= size; step++) {
    const candidate = state.players[(((index + direction * step) % size) + size) % size]!;
    if (!candidate.bankrupt) return candidate;
  }
  return state.players[index]!;
}

/**
 * Who a selector names right now, or null when a named Player is bankrupt or gone (or a
 * `drawerChoice` / `random` was never bound to a Player). `richest` and `poorest` may be the
 * drawer; ties go to the earlier Player in turn order.
 */
function resolveParty(state: GameState, selector: PartySelector, drawerId: string): Creditor[] | null {
  const players = (ps: Player[]): Creditor[] => ps.map((p) => ({ type: 'player', playerId: p.id }));
  const active = activePlayers(state);
  if (typeof selector === 'object') {
    const named = 'player' in selector ? active.find((p) => p.id === selector.player) : undefined;
    return named ? players([named]) : null;
  }
  switch (selector) {
    case 'drawer':
      return players([findPlayer(state, drawerId)]);
    case 'bank':
      return [{ type: 'bank' }];
    case 'allOthers':
      return players(active.filter((p) => p.id !== drawerId));
    case 'everyone':
      return players(active);
    case 'richest':
      return players([[...active].sort((a, b) => b.cash - a.cash)[0]!]);
    case 'poorest':
      return players([[...active].sort((a, b) => a.cash - b.cash)[0]!]);
    case 'left':
      return players([neighbour(state, drawerId, 1)]);
    case 'right':
      return players([neighbour(state, drawerId, -1)]);
    default:
      return null;
  }
}

function mapSelectors(effect: Effect, fn: (selector: PartySelector) => PartySelector): Effect {
  switch (effect.type) {
    case 'TRANSFER':
      return { ...effect, from: fn(effect.from), to: fn(effect.to) };
    case 'GET_OUT_OF_JAIL':
    case 'MANUAL':
      return effect;
    default:
      return { ...effect, target: fn(effect.target ?? 'drawer') };
  }
}

/**
 * The drawer dismisses the revealed card and its Effects resolve, or the Host carries on after
 * resolving a MANUAL Effect with Overrides. `drawerChoice` is bound to the Player picked now and
 * `random` to a random other Player, so the rest of the card resolves without more input.
 */
function continueCardAction(
  state: GameState,
  action: Extract<Action, { type: 'CONTINUE_CARD' }>,
  rules: Rules,
  rng: Rng,
  events: GameEvent[],
): GameState {
  const turn = state.turn;
  const card = turn?.cards[turn.cards.length - 1];
  if (state.phase === 'playing' && turn?.step === 'awaitManual' && card) {
    if (action.playerId !== state.hostId) throw new IllegalActionError('Only the Host can carry on after a manual card');
    events.push({ type: 'CARD_CONTINUED', playerId: action.playerId });
    return continueCard(state, rules, events);
  }
  if (state.phase !== 'playing' || !turn || turn.step !== 'awaitCard' || !card) throw new IllegalActionError('There is no card to continue');
  if (action.playerId !== turn.playerId) throw new IllegalActionError('Only the Player who drew the card can continue');

  let needsChoice = false;
  for (const effect of card.remaining) {
    mapSelectors(effect, (s) => {
      needsChoice ||= s === 'drawerChoice';
      return s;
    });
  }
  const choice = state.players.find((p) => p.id === action.choiceId);
  if (needsChoice && (!choice || choice.bankrupt)) throw new IllegalActionError('Pick a Player for this card');

  const others = activePlayers(state).filter((p) => p.id !== turn.playerId);
  const bind = (selector: PartySelector): PartySelector => {
    if (selector === 'drawerChoice') return { player: choice!.id };
    if (selector === 'random') return { player: others.length > 0 ? others[rng.int(others.length)]!.id : '' };
    return selector;
  };
  const bound: ActiveCard = { ...card, remaining: card.remaining.map((e) => mapSelectors(e, bind)) };
  events.push({ type: 'CARD_CONTINUED', playerId: action.playerId, ...(needsChoice ? { choiceId: choice!.id } : {}) });
  const next = { ...state, turn: { ...turn, cards: [...turn.cards.slice(0, -1), bound] } };
  return continueCard(next, rules, events);
}

/** Carries on with the Effects of the card on top of the stack; a finished card is removed. */
function continueCard(state: GameState, rules: Rules, events: GameEvent[]): GameState {
  const turn = state.turn!;
  const card = turn.cards[turn.cards.length - 1]!;
  const [effect, ...remaining] = card.remaining;
  if (!effect) return landingResolved({ ...state, turn: { ...turn, cards: turn.cards.slice(0, -1) } }, rules, events);
  const next = { ...state, turn: { ...turn, cards: [...turn.cards.slice(0, -1), { ...card, remaining }] } };
  return runEffect(next, effect, rules, events);
}

/** Carries on with a card in progress, if any, after something else in its Effect finished. */
function resumeCards(state: GameState, rules: Rules, events: GameEvent[]): GameState {
  return state.turn!.cards.length > 0 ? continueCard(state, rules, events) : state;
}

function skipEffect(state: GameState, effect: Effect, reason: SkipReason, events: GameEvent[]): void {
  events.push({ type: 'CARD_EFFECT_SKIPPED', playerId: state.turn!.playerId, effect: effect.type, reason });
}

/** The Players an Effect's `target` names, logging a skip for a bankrupt or missing one or a bank. */
function targetPlayers(state: GameState, effect: Effect & { target?: PartySelector }, events: GameEvent[]): Player[] {
  const parties = resolveParty(state, effect.target ?? 'drawer', state.turn!.playerId);
  if (!parties) {
    skipEffect(state, effect, 'playerGone', events);
    return [];
  }
  if (parties.some((p) => p.type === 'bank')) skipEffect(state, effect, 'badTarget', events);
  return parties.flatMap((p) => (p.type === 'player' ? [findPlayer(state, p.playerId)] : []));
}

function runEffect(state: GameState, effect: Effect, rules: Rules, events: GameEvent[]): GameState {
  const drawerId = state.turn!.playerId;
  const done = (s: GameState) => continueCard(s, rules, events);
  switch (effect.type) {
    case 'MANUAL':
      // The Host resolves it with Overrides, then carries on with CONTINUE_CARD.
      return { ...state, turn: { ...state.turn!, step: 'awaitManual' } };

    case 'TRANSFER':
      return transfer(state, effect, rules, events);

    case 'MOVE_TO':
    case 'MOVE_RELATIVE':
    case 'MOVE_TO_NEAREST':
      return move(state, effect, rules, events);

    case 'GO_TO_JAIL': {
      let next = state;
      for (const target of targetPlayers(state, effect, events)) next = sendToJail(next, target.id, 'card', events);
      return done(next);
    }

    case 'GET_OUT_OF_JAIL': {
      const card = state.turn!.cards[state.turn!.cards.length - 1]!;
      const deck = state.decks[card.deck];
      const at = deck.drawPile.lastIndexOf(card.cardId);
      const decks = at < 0 ? state.decks : { ...state.decks, [card.deck]: { ...deck, drawPile: deck.drawPile.filter((_, i) => i !== at) } };
      events.push({ type: 'CARD_KEPT', playerId: drawerId, cardId: card.cardId });
      return done(giveCards({ ...state, decks }, drawerId, [card.cardId]));
    }

    case 'REPAIRS': {
      const debts: Debt[] = [];
      for (const target of targetPlayers(state, effect, events)) {
        const buildings = Object.values(state.deeds)
          .filter((d) => d.ownerId === target.id)
          .map((d) => d.buildings);
        const hotels = buildings.filter((b) => b === HOTEL).length;
        const houses = sum(buildings.filter((b) => b !== HOTEL));
        const amount = effect.perHouse * houses + effect.perHotel * hotels;
        if (amount <= 0) continue;
        events.push({ type: 'REPAIRS_PAID', playerId: target.id, amount, houses, hotels });
        debts.push({ debtorId: target.id, creditor: { type: 'bank' }, amount, feedsJackpot: false });
      }
      return debts.length > 0 ? chargeAll(state, debts, 'landingResolved', rules, events) : done(state);
    }

    case 'SKIP_TURNS': {
      const targets = targetPlayers(state, effect, events).map((p) => p.id);
      for (const id of targets) events.push({ type: 'SKIP_TURNS_SET', playerId: id, count: effect.count });
      const next = state.players.map((p) => (targets.includes(p.id) ? { ...p, skipTurns: p.skipTurns + effect.count } : p));
      return done({ ...state, players: next });
    }

    case 'EXTRA_TURN': {
      const targets = targetPlayers(state, effect, events).map((p) => p.id);
      for (const id of targets) events.push({ type: 'EXTRA_TURN_GRANTED', playerId: id });
      return done({ ...state, extraTurns: [...state.extraTurns, ...targets] });
    }

    case 'SWAP_POSITION': {
      let next = state;
      let moved = false;
      for (const target of targetPlayers(state, effect, events)) {
        if (target.id === drawerId) {
          skipEffect(state, effect, 'badTarget', events);
        } else if (target.inJail || findPlayer(next, drawerId).inJail) {
          skipEffect(state, effect, 'inJail', events);
        } else {
          const mine = findPlayer(next, drawerId).position;
          events.push({ type: 'POSITIONS_SWAPPED', playerId: drawerId, otherId: target.id });
          next = updatePlayer(updatePlayer(next, drawerId, (p) => ({ ...p, position: target.position })), target.id, (p) => ({ ...p, position: mine }));
          moved = true;
        }
      }
      return moved ? land(next, drawerId, rules, events) : done(next);
    }
  }
}

/** A Transfer: one Debt for each paying Player and receiver pair (the bank pays out of nothing). */
function transfer(state: GameState, effect: Extract<Effect, { type: 'TRANSFER' }>, rules: Rules, events: GameEvent[]): GameState {
  const drawerId = state.turn!.playerId;
  const froms = resolveParty(state, effect.from, drawerId);
  const tos = resolveParty(state, effect.to, drawerId);
  if (!froms || !tos) {
    skipEffect(state, effect, 'playerGone', events);
    return continueCard(state, rules, events);
  }

  let next = state;
  const debts: Debt[] = [];
  for (const from of froms) {
    for (const to of tos) {
      if (from.type === 'bank' && to.type === 'bank') continue;
      if (from.type === 'player' && to.type === 'player' && from.playerId === to.playerId) {
        skipEffect(state, effect, 'selfTransfer', events);
        continue;
      }
      const payerCash = from.type === 'player' ? findPlayer(next, from.playerId).cash : 0;
      const amount = evalAmount(effect.amount, state.turn!.lastRoll, payerCash);
      if (amount === null) {
        skipEffect(state, effect, 'badAmount', events);
        continue;
      }
      if (amount <= 0) continue;
      events.push({ type: 'CARD_TRANSFER', from, to, amount });
      if (from.type === 'bank') {
        if (to.type === 'player') next = adjustCash(next, to.playerId, amount);
      } else {
        debts.push({ debtorId: from.playerId, creditor: to, amount, feedsJackpot: to.type === 'bank' });
      }
    }
  }
  return debts.length > 0 ? chargeAll(next, debts, 'landingResolved', rules, events) : continueCard(next, rules, events);
}

/**
 * A card move. Everything it names moves (a jailed Player stays put), but only the drawer lands:
 * their new space is resolved, with `rentRule` for a nearest station or utility.
 */
function move(
  state: GameState,
  effect: Extract<Effect, { type: 'MOVE_TO' | 'MOVE_RELATIVE' | 'MOVE_TO_NEAREST' }>,
  rules: Rules,
  events: GameEvent[],
): GameState {
  const drawerId = state.turn!.playerId;
  const size = state.board.length;
  let next = state;
  let drawerMoved = false;
  for (const target of targetPlayers(state, effect, events)) {
    if (target.inJail) {
      skipEffect(state, effect, 'inJail', events);
      continue;
    }
    const position = findPlayer(next, target.id).position;
    if (effect.type === 'MOVE_RELATIVE') {
      next =
        effect.steps >= 0
          ? moveForward(next, target.id, effect.steps, rules, events)
          : moveBack(next, target.id, -effect.steps, events);
    } else if (effect.type === 'MOVE_TO') {
      if (!state.board[effect.index]) {
        skipEffect(state, effect, 'noSuchSpace', events);
        continue;
      }
      const steps = (effect.index - position + size) % size;
      next = moveForward(next, target.id, steps, rules, events, effect.collectGo);
    } else {
      const steps = Array.from({ length: size }, (_, i) => i + 1).find((k) => state.board[(position + k) % size]!.type === effect.kind);
      if (steps === undefined) {
        skipEffect(state, effect, 'noSuchSpace', events);
        continue;
      }
      next = moveForward(next, target.id, steps, rules, events);
    }
    drawerMoved ||= target.id === drawerId;
  }
  if (!drawerMoved) return continueCard(next, rules, events);
  const rentRule = effect.type === 'MOVE_TO_NEAREST' ? { rentMultiplier: effect.rentMultiplier, diceMultiplier: effect.diceMultiplier } : {};
  return land(next, drawerId, rules, events, rentRule);
}

// ---- Overrides ----

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** A manual Host change to game state, applied at once and logged publicly (build spec §5). */
function hostOverride(state: GameState, playerId: string, raw: unknown, rules: Rules, now: number, events: GameEvent[]): GameState {
  if (playerId !== state.hostId) throw new IllegalActionError('Only the Host can use Overrides');
  if (state.phase !== 'playing' || !state.turn) throw new IllegalActionError('Overrides are only for a game in progress');
  if (!isPlainObject(raw)) throw new IllegalActionError('The Override must be an object');
  const override = raw as Override;
  switch (override.kind) {
    case 'ADJUST_CASH': {
      const target = overridePlayer(state, override.playerId);
      if (!isInt(override.amount) || override.amount === 0) throw new IllegalActionError('The amount must be a whole number, not 0');
      if (target.cash + override.amount < 0) throw new IllegalActionError(`${target.name} has only ${target.cash}`);
      events.push({ type: 'OVERRIDE', override: { kind: 'ADJUST_CASH', playerId: target.id, amount: override.amount } });
      return adjustCash(state, target.id, override.amount);
    }

    case 'MOVE_TOKEN': {
      const target = overridePlayer(state, override.playerId);
      if (!isInt(override.index) || !state.board[override.index]) throw new IllegalActionError('No such space on the Board');
      if (state.turn.step === 'awaitBuyDecision' && state.turn.playerId === target.id) {
        throw new IllegalActionError(`${target.name} must decide on buying first`);
      }
      events.push({ type: 'OVERRIDE', override: { kind: 'MOVE_TOKEN', playerId: target.id, index: override.index } });
      return updatePlayer(state, target.id, (p) => ({ ...p, position: override.index }));
    }

    case 'SET_OWNER': {
      const index = overrideProperty(state, override.index);
      const deeds = { ...state.deeds };
      if (override.ownerId === null) {
        if (!deeds[index]) throw new IllegalActionError('The bank already owns that property');
        delete deeds[index];
      } else {
        const owner = overridePlayer(state, override.ownerId);
        if (deeds[index]?.ownerId === owner.id) throw new IllegalActionError(`${owner.name} already owns that property`);
        deeds[index] = { buildings: 0, mortgaged: false, ...deeds[index], ownerId: owner.id };
      }
      events.push({ type: 'OVERRIDE', override: { kind: 'SET_OWNER', index, ownerId: override.ownerId } });
      return { ...state, deeds };
    }

    case 'SET_BUILDINGS': {
      const index = overrideProperty(state, override.index);
      const deed = state.deeds[index];
      if (state.board[index]!.type !== 'street' || !deed) throw new IllegalActionError('Only an owned street can have buildings');
      if (deed.mortgaged) throw new IllegalActionError('That street is mortgaged');
      const { buildings } = override;
      if (!isInt(buildings) || buildings < 0 || buildings > HOTEL) throw new IllegalActionError('Pick 0–4 houses or a hotel');
      events.push({ type: 'OVERRIDE', override: { kind: 'SET_BUILDINGS', index, buildings } });
      return { ...state, deeds: { ...state.deeds, [index]: { ...deed, buildings } } };
    }

    case 'SEND_TO_JAIL': {
      const target = overridePlayer(state, override.playerId);
      if (target.inJail) throw new IllegalActionError(`${target.name} is already in Jail`);
      events.push({ type: 'OVERRIDE', override: { kind: 'SEND_TO_JAIL', playerId: target.id } });
      const jail = state.board.find((s) => s.type === 'jail')?.index;
      const jailed = updatePlayer(state, target.id, (p) => ({ ...p, position: jail ?? p.position, inJail: true, jailTurns: 0 }));
      const turn = jailed.turn!;
      if (turn.playerId !== target.id) return jailed;
      // No roll for a Player jailed before rolling, and no roll again for Doubles; anything under
      // way (a card, a buy decision) still finishes.
      return { ...jailed, turn: { ...turn, doublesCount: 0, step: turn.step === 'awaitRoll' ? 'awaitEndTurn' : turn.step } };
    }

    case 'RELEASE_FROM_JAIL': {
      const target = overridePlayer(state, override.playerId);
      if (!target.inJail) throw new IllegalActionError(`${target.name} is not in Jail`);
      events.push({ type: 'OVERRIDE', override: { kind: 'RELEASE_FROM_JAIL', playerId: target.id } });
      return updatePlayer(state, target.id, (p) => ({ ...p, inJail: false, jailTurns: 0 }));
    }

    case 'SKIP_TURN': {
      const target = overridePlayer(state, override.playerId);
      events.push({ type: 'OVERRIDE', override: { kind: 'SKIP_TURN', playerId: target.id } });
      return updatePlayer(state, target.id, (p) => ({ ...p, skipTurns: p.skipTurns + 1 }));
    }

    case 'END_TURN': {
      const turn = state.turn;
      if (turn.step === 'awaitDebt') throw new IllegalActionError('Settle or force the Debt first');
      if (turn.step === 'auction') throw new IllegalActionError('Wait for the Auction to finish');
      events.push({ type: 'OVERRIDE', override: { kind: 'END_TURN' } });
      events.push({ type: 'TURN_ENDED', playerId: turn.playerId });
      return passTurn({ ...state, turn: { ...turn, cards: [] } }, events);
    }

    case 'SETTLE_DEBT':
    case 'FORCE_DEBT':
    case 'DECLARE_BANKRUPTCY': {
      const debt = state.debts[0];
      if (state.turn.step !== 'awaitDebt' || !debt) throw new IllegalActionError('No Debt is waiting');
      events.push({ type: 'OVERRIDE', override: { kind: override.kind } });
      if (override.kind === 'DECLARE_BANKRUPTCY') return bankrupt(state, debt.debtorId, debt.creditor, rules, now, events);
      if (override.kind === 'SETTLE_DEBT') return resumeTurn({ ...state, debts: state.debts.slice(1) }, rules, events);
      if (findPlayer(state, debt.debtorId).cash < debt.amount) return bankrupt(state, debt.debtorId, debt.creditor, rules, now, events);
      events.push({ type: 'DEBT_PAID', debtorId: debt.debtorId, creditor: debt.creditor, amount: debt.amount });
      return resumeTurn({ ...settleNow(state, debt, rules), debts: state.debts.slice(1) }, rules, events);
    }

    default:
      throw new IllegalActionError(`${String((override as { kind: unknown }).kind)} is not an Override`);
  }
}

/** The property an Override names, which must not be on offer or up for Auction right now. */
function overrideProperty(state: GameState, index: unknown): number {
  const space = isInt(index) ? state.board[index] : undefined;
  if (!space || !isProperty(space)) throw new IllegalActionError('Pick a property');
  const turn = state.turn!;
  const offered = turn.step === 'awaitBuyDecision' && findPlayer(state, turn.playerId).position === space.index;
  if (offered || state.auction?.index === space.index || state.auctionQueue?.includes(space.index)) {
    throw new IllegalActionError(`${space.name} is being sold right now`);
  }
  return space.index;
}

/** The Player an Override names, who must still be in the game. */
function overridePlayer(state: GameState, playerId: unknown): Player {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.bankrupt) throw new IllegalActionError('Pick a Player still in the game');
  return player;
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

export function appendLog(state: GameState, events: GameEvent[]): GameState {
  if (events.length === 0) return state;
  const start = state.log.length === 0 ? 0 : state.log[state.log.length - 1]!.seq + 1;
  return { ...state, log: [...state.log, ...events.map((event, i) => ({ seq: start + i, event }))] };
}
