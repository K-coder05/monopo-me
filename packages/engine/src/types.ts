export type FreeParkingMode = 'nothing' | 'fixed' | 'jackpot';

export type Rules = {
  minPlayers: number;
  maxPlayers: number;
  startingCash: number;
  goSalary: number;
  doubleSalaryOnExactGo: boolean;
  diceCount: number;
  diceSides: number;
  doublesRollAgain: boolean;
  doublesToJail: number;
  auctionOnDecline: boolean;
  auctionStartBid: number;
  auctionSeconds: number;
  colourGroupRentMultiplier: number;
  stationRents: number[];
  utilityMultipliers: number[];
  freeParkingMode: FreeParkingMode;
  freeParkingAmount: number;
  jailFine: number;
  maxJailTurns: number;
  collectRentInJail: boolean;
  evenBuildRule: boolean;
  housesPerHotel: number;
  /** null = unlimited */
  bankHouses: number | null;
  /** null = unlimited */
  bankHotels: number | null;
  buildingSellbackRate: number;
  mortgageRate: number;
  unmortgageInterest: number;
  tradingEnabled: boolean;
  mustCompleteLapBeforeBuying: boolean;
  turnTimerSeconds: number;
};

export type SpaceType =
  | 'go'
  | 'street'
  | 'station'
  | 'utility'
  | 'chance'
  | 'treasure'
  | 'tax'
  | 'jail'
  | 'freeParking'
  | 'goToJail';

export type SpaceDefinition = {
  index: number;
  name: string;
  type: SpaceType;
  group?: string;
  price?: number;
  houseCost?: number;
  /** Always 6 entries for streets: base, 1–4 houses, hotel. */
  rents?: number[];
  taxAmount?: number;
};

export type Player = {
  id: string;
  name: string;
  color: string;
  cash: number;
  position: number;
  inJail: boolean;
  /** Failed rolls for Doubles during the current stay in Jail. */
  jailTurns: number;
  /** For mustCompleteLapBeforeBuying. */
  hasPassedGo: boolean;
};

/** Live ownership state of one property, kept separate from its Space definition. */
export type Deed = {
  ownerId: string;
  /** 0–4 houses, or HOTEL (5). A street may hold more houses than a since-lowered housesPerHotel. */
  buildings: number;
  mortgaged: boolean;
};

export type TurnStep = 'awaitRoll' | 'awaitBuyDecision' | 'auction' | 'awaitEndTurn';

export type Bid = { playerId: string; amount: number };

/** Open bidding for one unowned property. */
export type Auction = {
  index: number;
  /** Players still in, in turn order. Passing removes a Player for good. */
  bidders: string[];
  highBid?: Bid;
  /** Server time (ms) when the countdown runs out; restarts on every bid. */
  endsAt: number;
};

export type Turn = {
  playerId: string;
  step: TurnStep;
  /**
   * Doubles rolled in a row this turn that earn another roll. Rolling out of Jail with
   * Doubles does not count, and going to Jail resets it.
   */
  doublesCount: number;
  lastRoll: number[];
  round: number;
};

/** How a Player was sent to Jail; cards add their own reason in the cards ticket. */
export type JailReason = 'goToJail' | 'doubles';

export type RollOffRoll = { playerId: string; dice: number[]; total: number };

export type GameEvent =
  | { type: 'PLAYER_JOINED'; playerId: string }
  | { type: 'GAME_STARTED' }
  | { type: 'ROLL_OFF'; rolls: RollOffRoll[] }
  | { type: 'TURN_ORDER_SET'; playerIds: string[] }
  | { type: 'TURN_STARTED'; playerId: string; round: number }
  | { type: 'DICE_ROLLED'; playerId: string; dice: number[]; total: number }
  | { type: 'MOVED'; playerId: string; from: number; to: number }
  | { type: 'GO_SALARY'; playerId: string; amount: number }
  | { type: 'ROLL_AGAIN'; playerId: string }
  | { type: 'JAILED'; playerId: string; reason: JailReason }
  | { type: 'STILL_IN_JAIL'; playerId: string; failedRolls: number }
  | { type: 'JAIL_FINE_PAID'; playerId: string; amount: number; forced: boolean }
  | { type: 'LEFT_JAIL'; playerId: string }
  | { type: 'TAX_PAID'; playerId: string; index: number; amount: number }
  | { type: 'FREE_PARKING_PAID'; playerId: string; amount: number }
  | { type: 'JACKPOT_WON'; playerId: string; amount: number }
  | { type: 'PROPERTY_OFFERED'; playerId: string; index: number; price: number }
  | { type: 'PURCHASE_LOCKED'; playerId: string; index: number }
  | { type: 'PROPERTY_BOUGHT'; playerId: string; index: number; price: number }
  | { type: 'PROPERTY_DECLINED'; playerId: string; index: number }
  | { type: 'RENT_PAID'; playerId: string; ownerId: string; index: number; amount: number }
  | { type: 'RENT_WAIVED'; playerId: string; ownerId: string; index: number; reason: 'mortgaged' | 'ownerInJail' }
  | { type: 'AUCTION_STARTED'; index: number; endsAt: number }
  | { type: 'BID_PLACED'; playerId: string; amount: number; endsAt: number }
  | { type: 'AUCTION_PASSED'; playerId: string }
  | { type: 'AUCTION_WON'; playerId: string; index: number; amount: number }
  | { type: 'AUCTION_UNSOLD'; index: number }
  /** `buildings` is the street's new building count (HOTEL for a hotel). */
  | { type: 'BUILDING_BUILT'; playerId: string; index: number; buildings: number; cost: number }
  | { type: 'BUILDING_SOLD'; playerId: string; index: number; buildings: number; amount: number }
  | { type: 'PROPERTY_MORTGAGED'; playerId: string; index: number; amount: number }
  | { type: 'PROPERTY_UNMORTGAGED'; playerId: string; index: number; cost: number }
  | { type: 'TURN_ENDED'; playerId: string };

export type LogEntry = { seq: number; event: GameEvent };

export type GameState = {
  roomCode: string;
  phase: 'lobby' | 'playing';
  hostId: string;
  rules: Rules;
  board: SpaceDefinition[];
  /** In turn order once the game has started; join order in the lobby. */
  players: Player[];
  /** Keyed by space index; a property with no Deed belongs to the bank. */
  deeds: Record<number, Deed>;
  turn?: Turn;
  /** Present while the turn is at the 'auction' step. */
  auction?: Auction;
  /** `jackpot` only fills while freeParkingMode is 'jackpot'. */
  bank: { jackpot: number };
  log: LogEntry[];
};

export type Action =
  | { type: 'JOIN_ROOM'; playerId: string; name: string; color: string }
  | { type: 'START_GAME'; playerId: string }
  | { type: 'ROLL_DICE'; playerId: string }
  | { type: 'PAY_JAIL_FINE'; playerId: string }
  | { type: 'BUY_PROPERTY'; playerId: string }
  | { type: 'DECLINE_PROPERTY'; playerId: string }
  | { type: 'PLACE_BID'; playerId: string; amount: number }
  | { type: 'PASS_AUCTION'; playerId: string }
  /** Sent by the server's countdown, not by a Player. */
  | { type: 'EXPIRE_AUCTION' }
  | { type: 'BUILD'; playerId: string; index: number }
  | { type: 'SELL_BUILDING'; playerId: string; index: number }
  | { type: 'MORTGAGE'; playerId: string; index: number }
  | { type: 'UNMORTGAGE'; playerId: string; index: number }
  | { type: 'END_TURN'; playerId: string };

/** Randomness injected by the server. Returns an integer in [0, maxExclusive). */
export type Rng = { int(maxExclusive: number): number };

export type ActionResult = { state: GameState; events: GameEvent[] };
