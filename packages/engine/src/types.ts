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

/** The editable fields of a Space definition (type and colour group are fixed). */
export type SpaceField = 'name' | 'price' | 'houseCost' | 'rents' | 'taxAmount';

export type SpaceEdit = { index: number } & Partial<Pick<SpaceDefinition, SpaceField>>;

/** Host edits waiting for a multi-step action to finish; later edits overwrite earlier ones. */
export type PendingEdit = {
  rules: Partial<Rules>;
  /** By space index. */
  board: Record<number, Partial<Pick<SpaceDefinition, SpaceField>>>;
  /** The edit is a reset to the Defaults, so applying it is logged as one. */
  reset?: boolean;
  /** The edit is this Preset's Rules and Board, so applying it later is logged as one. */
  preset?: string;
};

export type DeckKind = 'chance' | 'treasure';

/** Who gives, receives or is targeted by an Effect. */
export type PartySelector =
  | 'drawer'
  | 'bank'
  | 'allOthers'
  | 'everyone'
  | 'drawerChoice'
  | 'random'
  | 'richest'
  | 'poorest'
  | 'left'
  | 'right'
  | { player: string }
  /**
   * A Player named by display name. Presets store named Players this way; in a Room it marks a
   * card loaded from a Preset whose Player is missing, which cannot be drawn until the Host
   * picks a Player for it or disables it.
   */
  | { playerName: string };

/** A number, or an expression: `dice`, `dice * 10` or `percentOfCash(10)` (of the payer's cash). */
export type Amount = number | string;

/** `target` defaults to the drawer. */
export type Effect =
  | { type: 'TRANSFER'; amount: Amount; from: PartySelector; to: PartySelector }
  | { type: 'MOVE_TO'; index: number; collectGo: boolean; target?: PartySelector }
  | { type: 'MOVE_RELATIVE'; steps: number; target?: PartySelector }
  | {
      type: 'MOVE_TO_NEAREST';
      kind: 'station' | 'utility';
      rentMultiplier?: number;
      diceMultiplier?: number;
      target?: PartySelector;
    }
  | { type: 'GO_TO_JAIL'; target?: PartySelector }
  | { type: 'GET_OUT_OF_JAIL' }
  | { type: 'REPAIRS'; perHouse: number; perHotel: number; target?: PartySelector }
  | { type: 'SKIP_TURNS'; count: number; target?: PartySelector }
  | { type: 'EXTRA_TURN'; target?: PartySelector }
  | { type: 'SWAP_POSITION'; target?: PartySelector }
  | { type: 'MANUAL' };

/** `text` may use the {from}, {to} and {amount} placeholders. */
export type Card = {
  id: string;
  deck: DeckKind;
  title: string;
  text: string;
  effects: Effect[];
  keepable: boolean;
  enabled: boolean;
  copies: number;
};

/** The fields of a Card the Host fills in; the id, deck and `keepable` come from the engine. */
export type CardDraft = Pick<Card, 'title' | 'text' | 'effects' | 'enabled' | 'copies'>;

/**
 * What happens to held copies a card edit takes out of play: the Players keep them until used, or
 * lose them now. Required only when the edit touches a held card.
 */
export type HeldCardChoice = 'keep' | 'remove';

/** Rules as a Preset stores them: every key the Host can edit. */
export type PresetRules = Omit<Rules, 'minPlayers' | 'maxPlayers'>;

/** A named copy of Rules, Board and both Decks' cards. Named Players are stored as `{ playerName }`. */
export type Preset = { name: string; rules: PresetRules; board: SpaceDefinition[]; cards: Card[] };

export type Deck = {
  cards: Card[];
  /** Card ids, top first; a card appears once per copy. Drawn cards go to the bottom. */
  drawPile: string[];
};

export type Decks = Record<DeckKind, Deck>;

/** A card being revealed and resolved during the active turn. */
export type ActiveCard = {
  cardId: string;
  deck: DeckKind;
  title: string;
  /** With the placeholders filled in. */
  text: string;
  /** Effects still to resolve, in order. */
  remaining: Effect[];
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
  /** Out of the game; their row stays in `players` so turn order is kept. */
  bankrupt: boolean;
  /** Keepable cards (ids) held until used. */
  heldCards: string[];
  /** Turns still to miss. */
  skipTurns: number;
  /** Set for a Player the Host added mid-game: the round of their first turn. */
  firstRound?: number;
};

/** A person connected to a Room who is not a Player; `color` is the token they asked for. */
export type Spectator = { id: string; name: string; color: string };

/** Live ownership state of one property, kept separate from its Space definition. */
export type Deed = {
  ownerId: string;
  /** 0–4 houses, or HOTEL (5). A street may hold more houses than a since-lowered housesPerHotel. */
  buildings: number;
  mortgaged: boolean;
};

export type TurnStep =
  | 'awaitRoll'
  | 'awaitBuyDecision'
  | 'auction'
  | 'awaitDebt'
  | 'awaitCard'
  /** A MANUAL card waits for the Host to resolve it with Overrides, then carry on. */
  | 'awaitManual'
  | 'awaitEndTurn';

/** The other side of a Debt: one Player or the bank. */
export type Creditor = { type: 'player'; playerId: string } | { type: 'bank' };

/** An amount one Player owes one Creditor. Only Debts the debtor cannot cover wait in the queue. */
export type Debt = {
  debtorId: string;
  creditor: Creditor;
  amount: number;
  /** A payment to the bank of the kind that fills the Jackpot (tax, jail fines). */
  feedsJackpot: boolean;
};

/** What the active turn does once its Debts are settled (or the debtor is bankrupt). */
export type AfterDebts = 'landingResolved' | { moveFromJail: number };

/** What one side of a Trade hands over. */
export type TradeSide = {
  cash: number;
  /** Board indexes of the properties; none may sit in a Colour group with buildings. */
  properties: number[];
  /** Ids of held get-out-of-jail cards. */
  cards: string[];
};

/** The Room's one open offer: `give` goes from the proposer to the partner, `take` the other way. */
export type Trade = {
  proposerId: string;
  partnerId: string;
  give: TradeSide;
  take: TradeSide;
};

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
  /** Set while Debts are being settled. */
  afterDebts?: AfterDebts;
  /**
   * Cards being resolved, the one on top last. A card that moves the drawer onto another card
   * space stacks a new card above it, and the first resumes once that one is done.
   */
  cards: ActiveCard[];
  /** Set for an extra turn: the Player whose place in turn order this turn belongs to. */
  resumeAfter?: string;
  /**
   * Set while a departed Player's properties are Auctioned in the middle of someone else's turn:
   * the step that turn goes back to afterwards.
   */
  resumeStep?: TurnStep;
};

export type JailReason = 'goToJail' | 'doubles' | 'card';

/** A manual Host change to game state, applied at once and logged publicly. */
export type Override =
  /** Adds `amount` (negative to take away) to the Player's cash; cash cannot go below 0. */
  | { kind: 'ADJUST_CASH'; playerId: string; amount: number }
  /** Puts the token on a space: no GO salary and the space is not resolved. */
  | { kind: 'MOVE_TOKEN'; playerId: string; index: number }
  /** Gives the property's Deed to a Player, or back to the bank (`null`). */
  | { kind: 'SET_OWNER'; index: number; ownerId: string | null }
  /** Sets an owned street's building count (0–4 houses, or HOTEL), ignoring the building rules. */
  | { kind: 'SET_BUILDINGS'; index: number; buildings: number }
  | { kind: 'SEND_TO_JAIL'; playerId: string }
  | { kind: 'RELEASE_FROM_JAIL'; playerId: string }
  /** The Player misses their next turn. */
  | { kind: 'SKIP_TURN'; playerId: string }
  /** Ends the current turn now, dropping any card still being resolved. */
  | { kind: 'END_TURN' }
  /** Cancels the blocking Debt without moving cash. */
  | { kind: 'SETTLE_DEBT' }
  /** Makes the debtor pay the blocking Debt now, or go bankrupt to its Creditor if they cannot. */
  | { kind: 'FORCE_DEBT' }
  /** Declares the blocking debtor bankrupt to the Debt's Creditor, whatever they could still raise. */
  | { kind: 'DECLARE_BANKRUPTCY' };

/** Why part of a Card was not carried out. */
export type SkipReason = 'selfTransfer' | 'playerGone' | 'badTarget' | 'badAmount' | 'noSuchSpace' | 'inJail';

export type RollOffRoll = { playerId: string; dice: number[]; total: number };

export type GameEvent =
  | { type: 'PLAYER_JOINED'; playerId: string }
  /** Someone joined after the game started; `name` is kept because Spectators are not Players. */
  | { type: 'SPECTATOR_JOINED'; spectatorId: string; name: string }
  /** The Host made a Spectator a Player. */
  | { type: 'PLAYER_ADDED'; playerId: string }
  /** A Player or Spectator left or was kicked; `name` is kept as their row may be gone. */
  | { type: 'LEFT_ROOM'; id: string; name: string; kicked: boolean }
  /** `automatic` when the old Host had been away too long. */
  | { type: 'HOST_CHANGED'; from: string; to: string; automatic: boolean }
  | { type: 'GAME_PAUSED' }
  | { type: 'GAME_RESUMED' }
  /** The Host ended the game early; there is no Winner. */
  | { type: 'GAME_ENDED' }
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
  | { type: 'TRADE_PROPOSED'; trade: Trade; counter: boolean }
  | { type: 'TRADE_REJECTED'; trade: Trade }
  | { type: 'TRADE_WITHDRAWN'; trade: Trade }
  | { type: 'TRADE_COMPLETED'; trade: Trade }
  | { type: 'TURN_ENDED'; playerId: string }
  | { type: 'CARD_DRAWN'; playerId: string; deck: DeckKind; cardId: string; title: string; text: string }
  | { type: 'DECK_EMPTY'; playerId: string; deck: DeckKind }
  | { type: 'CARD_CONTINUED'; playerId: string; choiceId?: string }
  | { type: 'CARD_TRANSFER'; from: Creditor; to: Creditor; amount: number }
  | { type: 'CARD_EFFECT_SKIPPED'; playerId: string; effect: Effect['type']; reason: SkipReason }
  | { type: 'CARD_KEPT'; playerId: string; cardId: string }
  | { type: 'JAIL_CARD_USED'; playerId: string; cardId: string }
  | { type: 'REPAIRS_PAID'; playerId: string; amount: number; houses: number; hotels: number }
  | { type: 'SKIP_TURNS_SET'; playerId: string; count: number }
  | { type: 'TURN_SKIPPED'; playerId: string }
  | { type: 'EXTRA_TURN_GRANTED'; playerId: string }
  | { type: 'POSITIONS_SWAPPED'; playerId: string; otherId: string }
  | { type: 'DEBT_OWED'; debtorId: string; creditor: Creditor; amount: number }
  | { type: 'DEBT_PAID'; debtorId: string; creditor: Creditor; amount: number }
  | { type: 'BANKRUPT'; playerId: string; creditor: Creditor }
  | { type: 'GAME_OVER'; winnerId: string }
  | { type: 'RETURNED_TO_LOBBY' }
  | { type: 'RULE_CHANGED'; key: keyof Rules; from: Rules[keyof Rules]; to: Rules[keyof Rules] }
  | { type: 'SPACE_CHANGED'; index: number; field: SpaceField; from: SpaceDefinition[SpaceField]; to: SpaceDefinition[SpaceField] }
  | { type: 'DEFAULTS_RESTORED' }
  /** The Host's edits wait for the current Auction, Debt or Card to finish. */
  | { type: 'CHANGES_QUEUED' }
  // Card edits: `text` is left out while deck contents are hidden.
  | { type: 'CARD_ADDED'; deck: DeckKind; cardId: string; title: string; text?: string }
  | { type: 'CARD_EDITED'; deck: DeckKind; cardId: string; title: string; text?: string }
  | { type: 'CARD_COPIES_CHANGED'; deck: DeckKind; cardId: string; title: string; from: number; to: number }
  | { type: 'CARD_ENABLED_CHANGED'; deck: DeckKind; cardId: string; title: string; enabled: boolean }
  | { type: 'CARD_DELETED'; deck: DeckKind; cardId: string; title: string }
  | { type: 'HELD_CARD_REMOVED'; playerId: string; cardId: string; title: string }
  | { type: 'DECK_RESET'; deck: DeckKind }
  | { type: 'DECK_SHUFFLED'; deck: DeckKind }
  | { type: 'DECK_CONTENTS_HIDDEN'; hidden: boolean }
  /** Both Decks are replaced at once; the Rules and Board follow as RULE_CHANGED / SPACE_CHANGED. */
  | { type: 'PRESET_LOADED'; name: string; flaggedCards: number }
  /** A Preset's Rules and Board, queued behind an Auction, Debt or Card, now apply. */
  | { type: 'PRESET_APPLIED'; name: string }
  | { type: 'OVERRIDE'; override: Override }
  /** The Host restored the game to before the last game action or Override. */
  | { type: 'UNDONE' };

export type LogEntry = { seq: number; event: GameEvent };

export type GameState = {
  roomCode: string;
  /** A game ended by the Host is 'finished' with no `winnerId`. */
  phase: 'lobby' | 'playing' | 'finished';
  hostId: string;
  rules: Rules;
  board: SpaceDefinition[];
  /** In turn order once the game has started; join order in the lobby. */
  players: Player[];
  /** People who joined after the game started, until the Host adds them as Players. */
  spectators: Spectator[];
  /** Set while the Host has the game paused: when they paused it (server ms). */
  paused?: { at: number };
  /** Keyed by space index; a property with no Deed belongs to the bank. */
  deeds: Record<number, Deed>;
  turn?: Turn;
  /** Present while the turn is at the 'auction' step. */
  auction?: Auction;
  /** The one open Trade offer, if any. */
  trade?: Trade;
  /** Debts waiting to be settled, in order; the first one is the one blocking play. */
  debts: Debt[];
  /** Bankrupt Players in the order they went out. */
  bankruptcies: string[];
  /** Set once the game is finished: the last Player not bankrupt. */
  winnerId?: string;
  /**
   * Properties still to Auction after a Bankruptcy to the bank. Present (even when empty) while
   * those Auctions run, so closing one knows to start the next instead of ending a landing.
   */
  auctionQueue?: number[];
  /** Players owed an extra turn by a card, in order; each plays right after the current turn. */
  extraTurns: string[];
  decks: Decks;
  /** "Hide deck contents": only the Host may browse the Decks, and card edits are announced by title. */
  decksHidden?: boolean;
  /** Host edits to Rules or Board that arrived mid-action; applied once the action finishes. */
  pendingEdit?: PendingEdit;
  /** Set once Rules or Board change during a game; drives the banner. */
  rulesChangedMidGame?: boolean;
  /** `jackpot` only fills while freeParkingMode is 'jackpot'. */
  bank: { jackpot: number };
  log: LogEntry[];
};

export type Action =
  | { type: 'JOIN_ROOM'; playerId: string; name: string; color: string }
  | { type: 'START_GAME'; playerId: string }
  | { type: 'ROLL_DICE'; playerId: string }
  | { type: 'PAY_JAIL_FINE'; playerId: string }
  | { type: 'USE_JAIL_CARD'; playerId: string }
  /**
   * The drawer dismisses a revealed card, or the Host carries on after resolving a MANUAL card.
   * `choiceId` answers a `drawerChoice` selector.
   */
  | { type: 'CONTINUE_CARD'; playerId: string; choiceId?: string }
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
  /** From the active Player to anyone, from anyone to the active Player, or from a debtor to anyone. */
  | { type: 'PROPOSE_TRADE'; playerId: string; partnerId: string; give: TradeSide; take: TradeSide }
  | { type: 'ACCEPT_TRADE'; playerId: string }
  | { type: 'REJECT_TRADE'; playerId: string }
  | { type: 'WITHDRAW_TRADE'; playerId: string }
  | { type: 'END_TURN'; playerId: string }
  | { type: 'PAY_DEBT'; playerId: string }
  | { type: 'DECLARE_BANKRUPTCY'; playerId: string }
  /** Host only, from the Game Over screen. */
  | { type: 'REMATCH'; playerId: string }
  | { type: 'BACK_TO_LOBBY'; playerId: string }
  /** Host only. `changes` holds only the keys to change. */
  | { type: 'UPDATE_RULES'; playerId: string; changes: Partial<Rules> }
  /** Host only. */
  | { type: 'UPDATE_BOARD'; playerId: string; edits: SpaceEdit[] }
  /** Host only: the built-in Defaults for Rules and Board. */
  | { type: 'RESET_TO_DEFAULTS'; playerId: string }
  // Card editor, Host only. Card edits apply at once; a card being resolved finishes as it was.
  | { type: 'ADD_CARD'; playerId: string; deck: DeckKind; card: CardDraft }
  | { type: 'EDIT_CARD'; playerId: string; cardId: string; card: CardDraft; held?: HeldCardChoice }
  | { type: 'DELETE_CARD'; playerId: string; cardId: string; held?: HeldCardChoice }
  /** The built-in Default cards for one Deck, freshly shuffled. */
  | { type: 'RESET_DECK'; playerId: string; deck: DeckKind }
  | { type: 'SHUFFLE_DECK'; playerId: string; deck: DeckKind }
  | { type: 'HIDE_DECK_CONTENTS'; playerId: string; hidden: boolean }
  /** Host only. The Rules and Board wait like any Rules edit; the Decks are replaced at once. */
  | { type: 'LOAD_PRESET'; playerId: string; preset: Preset }
  /** Host only. `override` comes from an untrusted sender; the engine checks it. */
  | { type: 'HOST_OVERRIDE'; playerId: string; override: Override }
  // Room membership. `playerId` is who sends it; a Spectator may only leave.
  /** Host only: freezes play and the Auction countdown for everyone. */
  | { type: 'PAUSE'; playerId: string }
  | { type: 'RESUME'; playerId: string }
  /** Host only: finishes the game now with no Winner. */
  | { type: 'END_GAME'; playerId: string }
  /** A Player who leaves mid-game goes bankrupt to the bank; the Host must hand on the role first. */
  | { type: 'LEAVE_ROOM'; playerId: string }
  /** Host only: removes a Player (bankrupt to the bank mid-game) or a Spectator. */
  | { type: 'KICK'; playerId: string; targetId: string }
  /** Host only: hands the Host role to another Player. */
  | { type: 'TRANSFER_HOST'; playerId: string; toId: string }
  /** Sent by the server once the Host has been away too long, not by a Player. */
  | { type: 'HOST_TIMED_OUT'; toId: string }
  /** Host only: makes a Spectator a Player with startingCash, last in turn order. */
  | { type: 'ADD_PLAYER'; playerId: string; spectatorId: string };

/** Randomness injected by the server. Returns an integer in [0, maxExclusive). */
export type Rng = { int(maxExclusive: number): number };

export type ActionResult = { state: GameState; events: GameEvent[] };
