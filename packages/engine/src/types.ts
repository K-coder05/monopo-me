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
};

export type TurnStep = 'awaitRoll' | 'awaitEndTurn';

export type Turn = {
  playerId: string;
  step: TurnStep;
  lastRoll: number[];
  round: number;
};

export type RollOffRoll = { playerId: string; dice: number[]; total: number };

export type GameEvent =
  | { type: 'PLAYER_JOINED'; playerId: string }
  | { type: 'GAME_STARTED' }
  | { type: 'ROLL_OFF'; rolls: RollOffRoll[] }
  | { type: 'TURN_ORDER_SET'; playerIds: string[] }
  | { type: 'TURN_STARTED'; playerId: string; round: number }
  | { type: 'DICE_ROLLED'; playerId: string; dice: number[]; total: number }
  | { type: 'MOVED'; playerId: string; from: number; to: number }
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
  turn?: Turn;
  log: LogEntry[];
};

export type Action =
  | { type: 'JOIN_ROOM'; playerId: string; name: string; color: string }
  | { type: 'START_GAME'; playerId: string }
  | { type: 'ROLL_DICE'; playerId: string }
  | { type: 'END_TURN'; playerId: string };

/** Randomness injected by the server. Returns an integer in [0, maxExclusive). */
export type Rng = { int(maxExclusive: number): number };

export type ActionResult = { state: GameState; events: GameEvent[] };
