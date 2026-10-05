import type {
  Action,
  ActionResult,
  Auction,
  GameEvent,
  GameState,
  JailReason,
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

/**
 * A Deed's `buildings` value for a hotel; 0–4 are houses. It matches the hotel's (last) entry in a
 * street's rent table, so house levels above housesPerHotel are skipped.
 */
export const HOTEL = 5;

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
    deeds: {},
    bank: { jackpot: 0 },
    log: [],
  };
  return appendLog(state, [{ type: 'PLAYER_JOINED', playerId: host.id }]);
}

/** `now` is the server's clock in ms; the engine reads it only for Auction countdowns. */
export function applyAction(state: GameState, action: Action, rules: Rules, rng: Rng, now: number): ActionResult {
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
    case 'PAY_JAIL_FINE':
      next = payJailFine(state, action.playerId, rules, events);
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
      next = passAuction(state, action.playerId, rules, events);
      break;
    case 'EXPIRE_AUCTION':
      next = expireAuction(state, rules, now, events);
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
    case 'END_TURN':
      next = endTurn(state, action.playerId, events);
      break;
    default:
      throw new IllegalActionError(`Unknown action ${(action as Action).type}`);
  }
  return { state: appendLog(next, events), events };
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
  };
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
    turn: { playerId: first.id, step: 'awaitRoll', doublesCount: 0, lastRoll: [], round: 1 },
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
    next = rollInJail(next, playerId, doubles, rules, events);
    if (findPlayer(next, playerId).inJail) return { ...next, turn: { ...next.turn!, step: 'awaitEndTurn' } };
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

/**
 * A jailed Player's roll: Doubles release them; otherwise they stay, until the failure that
 * reaches maxJailTurns forces the fine and releases them. Moving by the roll is up to the caller.
 */
function rollInJail(state: GameState, playerId: string, doubles: boolean, rules: Rules, events: GameEvent[]): GameState {
  if (doubles) return releaseFromJail(state, playerId, events);
  const failedRolls = findPlayer(state, playerId).jailTurns + 1;
  if (failedRolls >= rules.maxJailTurns) {
    return releaseFromJail(chargeJailFine(state, playerId, true, rules, events), playerId, events);
  }
  events.push({ type: 'STILL_IN_JAIL', playerId, failedRolls });
  return updatePlayer(state, playerId, (p) => ({ ...p, jailTurns: failedRolls }));
}

function payJailFine(state: GameState, playerId: string, rules: Rules, events: GameEvent[]): GameState {
  requireTurn(state, playerId, 'awaitRoll');
  const player = findPlayer(state, playerId);
  if (!player.inJail) throw new IllegalActionError('You are not in Jail');
  if (player.cash < rules.jailFine) {
    throw new IllegalActionError(`You need ${rules.jailFine} to pay the fine, but have ${player.cash}`);
  }
  return releaseFromJail(chargeJailFine(state, playerId, false, rules, events), playerId, events);
}

/** `forced` when the Player has used up their rolls; until Debts exist, a forced fine can take cash negative. */
function chargeJailFine(state: GameState, playerId: string, forced: boolean, rules: Rules, events: GameEvent[]): GameState {
  events.push({ type: 'JAIL_FINE_PAID', playerId, amount: rules.jailFine, forced });
  return payBankFeedingJackpot(state, playerId, rules.jailFine, rules);
}

/**
 * Moves the Player straight to the Jail space without passing GO, and ends their turn with no
 * extra roll for any Doubles.
 */
function sendToJail(state: GameState, playerId: string, reason: JailReason, events: GameEvent[]): GameState {
  events.push({ type: 'JAILED', playerId, reason });
  const jail = state.board.find((s) => s.type === 'jail')?.index;
  const jailed = updatePlayer(state, playerId, (p) => ({ ...p, position: jail ?? p.position, inJail: true, jailTurns: 0 }));
  return { ...jailed, turn: { ...jailed.turn!, step: 'awaitEndTurn', doublesCount: 0 } };
}

/** Every way out of Jail ends here: the fine, Doubles, and (from the cards ticket) a get-out-of-jail card. */
function releaseFromJail(state: GameState, playerId: string, events: GameEvent[]): GameState {
  events.push({ type: 'LEFT_JAIL', playerId });
  return updatePlayer(state, playerId, (p) => ({ ...p, inJail: false, jailTurns: 0 }));
}

/**
 * Moves `playerId` `steps` spaces clockwise, paying goSalary each time they land on or pass GO.
 * A move that ends on GO pays double when doubleSalaryOnExactGo is on.
 */
function moveForward(state: GameState, playerId: string, steps: number, rules: Rules, events: GameEvent[]): GameState {
  const size = state.board.length;
  const go = goIndex(state.board);
  const from = findPlayer(state, playerId).position;
  const to = (from + steps) % size;
  events.push({ type: 'MOVED', playerId, from, to });

  const laps = go === undefined ? 0 : Math.floor((((from - go + size) % size) + steps) / size);
  const exactBonus = laps > 0 && to === go && rules.doubleSalaryOnExactGo ? 1 : 0;
  const salary = (laps + exactBonus) * rules.goSalary;
  if (salary > 0) events.push({ type: 'GO_SALARY', playerId, amount: salary });
  return updatePlayer(state, playerId, (p) => ({
    ...p,
    position: to,
    cash: p.cash + salary,
    hasPassedGo: p.hasPassedGo || laps > 0,
  }));
}

/** Resolves the space `playerId` is standing on and sets the next turn step. */
function land(state: GameState, playerId: string, rules: Rules, events: GameEvent[]): GameState {
  const player = findPlayer(state, playerId);
  const space = state.board[player.position]!;
  const finishLanding = (s: GameState) => landingResolved(s, rules, events);
  if (space.type === 'goToJail') return sendToJail(state, playerId, 'goToJail', events);
  if (space.type === 'tax') {
    const amount = space.taxAmount ?? 0;
    events.push({ type: 'TAX_PAID', playerId, index: space.index, amount });
    return finishLanding(payBankFeedingJackpot(state, playerId, amount, rules));
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

  const amount = rentFor(state, space, deed.ownerId, rules);
  events.push({ type: 'RENT_PAID', playerId, ownerId: deed.ownerId, index: space.index, amount });
  // Until Debts exist, a Player who cannot cover the rent goes into negative cash.
  return finishLanding(adjustCash(adjustCash(state, playerId, -amount), deed.ownerId, amount));
}

/**
 * Called once the landing space is fully resolved (including any buy decision or Auction):
 * the Player rolls again after Doubles when doublesRollAgain is on, otherwise may end their turn.
 */
function landingResolved(state: GameState, rules: Rules, events: GameEvent[]): GameState {
  const turn = state.turn!;
  if (turn.doublesCount > 0 && rules.doublesRollAgain && !findPlayer(state, turn.playerId).inJail) {
    events.push({ type: 'ROLL_AGAIN', playerId: turn.playerId });
    return { ...state, turn: { ...turn, step: 'awaitRoll' } };
  }
  return { ...state, turn: { ...turn, step: 'awaitEndTurn' } };
}

/**
 * A payment to the bank of the kind that feeds the Jackpot: tax, jail fines and card Transfers
 * to the bank. Purchases, building costs and unmortgage interest must not use this.
 * Until Debts exist, a Player who cannot cover it goes into negative cash.
 */
function payBankFeedingJackpot(state: GameState, playerId: string, amount: number, rules: Rules): GameState {
  const paid = adjustCash(state, playerId, -amount);
  if (rules.freeParkingMode !== 'jackpot') return paid;
  return { ...paid, bank: { ...paid.bank, jackpot: paid.bank.jackpot + amount } };
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
    auction: { index, bidders: state.players.map((p) => p.id), endsAt },
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
  return settleIfDecided({ ...state, auction: { ...auction, highBid: { playerId, amount }, endsAt } }, rules, events);
}

function passAuction(state: GameState, playerId: string, rules: Rules, events: GameEvent[]): GameState {
  const auction = requireBidder(state, playerId);
  if (auction.highBid?.playerId === playerId) throw new IllegalActionError('You cannot pass while you have the highest bid');
  events.push({ type: 'AUCTION_PASSED', playerId });
  const bidders = auction.bidders.filter((id) => id !== playerId);
  return settleIfDecided({ ...state, auction: { ...auction, bidders } }, rules, events);
}

function expireAuction(state: GameState, rules: Rules, now: number, events: GameEvent[]): GameState {
  const auction = requireAuction(state);
  if (now < auction.endsAt) throw new IllegalActionError('The Auction countdown has not run out');
  return settleAuction(state, auction, rules, events);
}

/**
 * Ends the Auction once nobody can change the result: everyone has passed, or the only
 * Player left holds the highest bid. A lone Player with no bid yet may still bid.
 */
function settleIfDecided(state: GameState, rules: Rules, events: GameEvent[]): GameState {
  const auction = state.auction!;
  const [last, ...others] = auction.bidders;
  const decided = last === undefined || (others.length === 0 && auction.highBid?.playerId === last);
  return decided ? settleAuction(state, auction, rules, events) : state;
}

/** The highest bidder pays and takes the Deed; with no bids the property stays with the bank. */
function settleAuction(state: GameState, { index, highBid }: Auction, rules: Rules, events: GameEvent[]): GameState {
  const closed: GameState = { ...state, auction: undefined };
  if (!highBid) {
    events.push({ type: 'AUCTION_UNSOLD', index });
    return landingResolved(closed, rules, events);
  }
  const { playerId, amount } = highBid;
  events.push({ type: 'AUCTION_WON', playerId, index, amount });
  const paid = adjustCash(closed, playerId, -amount);
  const deeds = { ...paid.deeds, [index]: { ownerId: playerId, buildings: 0, mortgaged: false } };
  return landingResolved({ ...paid, deeds }, rules, events);
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
  requirePropertyMoment(state, playerId);
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
  requirePropertyMoment(state, playerId);
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

function endTurn(state: GameState, playerId: string, events: GameEvent[]): GameState {
  const turn = requireTurn(state, playerId, 'awaitEndTurn');
  events.push({ type: 'TURN_ENDED', playerId });

  const index = state.players.findIndex((p) => p.id === playerId);
  const nextIndex = (index + 1) % state.players.length;
  const round = nextIndex === 0 ? turn.round + 1 : turn.round;
  const nextId = state.players[nextIndex]!.id;
  events.push({ type: 'TURN_STARTED', playerId: nextId, round });
  return { ...state, turn: { playerId: nextId, step: 'awaitRoll', doublesCount: 0, lastRoll: [], round } };
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

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function appendLog(state: GameState, events: GameEvent[]): GameState {
  if (events.length === 0) return state;
  const start = state.log.length === 0 ? 0 : state.log[state.log.length - 1]!.seq + 1;
  return { ...state, log: [...state.log, ...events.map((event, i) => ({ seq: start + i, event }))] };
}
