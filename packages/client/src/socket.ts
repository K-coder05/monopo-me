import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  CardDraft,
  ClientToServer,
  DeckKind,
  HeldCardChoice,
  Override,
  Preset,
  PropertyIntent,
  Rules,
  ServerToClient,
  RejoinKey,
  SpaceEdit,
  TradeSide,
} from '@landlord/engine';

export const socket: Socket<ServerToClient, ClientToServer> = io();

const SESSION_KEY = 'landlord.rejoinKey';

/** The RejoinKey this browser keeps so a refresh or dropped connection puts the Player straight back. */
export function loadRejoinKey(): RejoinKey | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as RejoinKey) : null;
  } catch {
    return null;
  }
}

export function saveRejoinKey(session: RejoinKey) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage blocked: the Player simply cannot auto-rejoin.
  }
}

export function clearRejoinKey() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing stored to clear.
  }
}

export type Intent =
  | 'START_GAME'
  | 'ROLL_DICE'
  | 'PAY_JAIL_FINE'
  | 'USE_JAIL_CARD'
  | 'BUY_PROPERTY'
  | 'DECLINE_PROPERTY'
  | 'PASS_AUCTION'
  | 'END_TURN'
  | 'ACCEPT_TRADE'
  | 'REJECT_TRADE'
  | 'WITHDRAW_TRADE'
  | 'PAY_DEBT'
  | 'DECLARE_BANKRUPTCY'
  | 'REMATCH'
  | 'BACK_TO_LOBBY'
  | 'RESET_TO_DEFAULTS'
  | 'PAUSE'
  | 'RESUME'
  | 'END_GAME'
  | 'LEAVE_ROOM';

/** Resolves with the server's error message, or null if it was accepted. */
function toError(resolve: (error: string | null) => void): Ack {
  return (result) => resolve(result.ok ? null : result.error);
}

/** Resolves with the server's reply, or its error message. */
function toResult<T extends object>(resolve: (result: T | { error: string }) => void): Ack<T> {
  return (result) => resolve(result.ok ? result : { error: result.error });
}

/** Sends an intent and resolves with the server's error message, or null if it was accepted. */
export function send(intent: Intent): Promise<string | null> {
  return new Promise((resolve) => socket.emit(intent, {}, toError(resolve)));
}

/**
 * Builds on, or sells a building from, the street at `index`, or mortgages or unmortgages the
 * property there; resolves like `send`.
 */
export function sendPropertyAction(intent: PropertyIntent, index: number): Promise<string | null> {
  return new Promise((resolve) => socket.emit(intent, { index }, toError(resolve)));
}

/** Dismisses the revealed card; `choiceId` is the Player picked for a `drawerChoice` card. Resolves like `send`. */
export function continueCard(choiceId?: string): Promise<string | null> {
  return new Promise((resolve) => socket.emit('CONTINUE_CARD', { choiceId }, toError(resolve)));
}

/** Bids `amount` in the open Auction; resolves like `send`. */
export function placeBid(amount: number): Promise<string | null> {
  return new Promise((resolve) => socket.emit('PLACE_BID', { amount }, toError(resolve)));
}

/** Proposes, revises or counters the open Trade; resolves like `send`. */
export function proposeTrade(partnerId: string, give: TradeSide, take: TradeSide): Promise<string | null> {
  return new Promise((resolve) => socket.emit('PROPOSE_TRADE', { partnerId, give, take }, toError(resolve)));
}

/** Host only: sends staged Rules changes; the server rejects bad values with a message. Resolves like `send`. */
export function updateRules(changes: Partial<Rules>): Promise<string | null> {
  return new Promise((resolve) => socket.emit('UPDATE_RULES', { changes }, toError(resolve)));
}

/** Host only: sends staged Space definition changes. Resolves like `send`. */
export function updateBoard(edits: SpaceEdit[]): Promise<string | null> {
  return new Promise((resolve) => socket.emit('UPDATE_BOARD', { edits }, toError(resolve)));
}

/** Host only: adds a card to a Deck. Resolves like `send`. */
export function addCard(deck: DeckKind, card: CardDraft): Promise<string | null> {
  return new Promise((resolve) => socket.emit('ADD_CARD', { deck, card }, toError(resolve)));
}

/** Host only: saves a card's form; `held` answers what happens to copies a Player holds. Resolves like `send`. */
export function editCard(cardId: string, card: CardDraft, held?: HeldCardChoice): Promise<string | null> {
  return new Promise((resolve) => socket.emit('EDIT_CARD', { cardId, card, held }, toError(resolve)));
}

/** Host only: deletes a card; `held` as for `editCard`. Resolves like `send`. */
export function deleteCard(cardId: string, held?: HeldCardChoice): Promise<string | null> {
  return new Promise((resolve) => socket.emit('DELETE_CARD', { cardId, held }, toError(resolve)));
}

/** Host only: puts back the Default cards for a Deck, freshly shuffled. Resolves like `send`. */
export function resetDeck(deck: DeckKind): Promise<string | null> {
  return new Promise((resolve) => socket.emit('RESET_DECK', { deck }, toError(resolve)));
}

/** Host only: shuffles a Deck's draw pile now. Resolves like `send`. */
export function shuffleDeck(deck: DeckKind): Promise<string | null> {
  return new Promise((resolve) => socket.emit('SHUFFLE_DECK', { deck }, toError(resolve)));
}

/** Host only: turns "hide deck contents" on or off. Resolves like `send`. */
export function hideDeckContents(hidden: boolean): Promise<string | null> {
  return new Promise((resolve) => socket.emit('HIDE_DECK_CONTENTS', { hidden }, toError(resolve)));
}

/** Host only: names of the Presets saved on the server, or the server's error message. */
export function listPresets(): Promise<{ names: string[] } | { error: string }> {
  return new Promise((resolve) => socket.emit('LIST_PRESETS', {}, toResult(resolve)));
}

/** Host only: saves the Room's Rules, Board and Decks as a Preset. Resolves like `send`. */
export function savePreset(name: string): Promise<string | null> {
  return new Promise((resolve) => socket.emit('SAVE_PRESET', { name }, toError(resolve)));
}

/** Host only: loads a saved Preset into the Room. Resolves like `send`. */
export function loadPreset(name: string): Promise<string | null> {
  return new Promise((resolve) => socket.emit('LOAD_PRESET', { name }, toError(resolve)));
}

/** Host only: a saved Preset, to download, or the server's error message. */
export function exportPreset(name: string): Promise<{ preset: Preset } | { error: string }> {
  return new Promise((resolve) => socket.emit('EXPORT_PRESET', { name }, toResult(resolve)));
}

/** Host only: saves a Preset read from a file; resolves with its name, or the server's error message. */
export function importPreset(preset: Preset): Promise<{ name: string } | { error: string }> {
  return new Promise((resolve) => socket.emit('IMPORT_PRESET', { preset }, toResult(resolve)));
}

/** Host only: applies an Override to the game; the server checks it. Resolves like `send`. */
export function hostOverride(override: Override): Promise<string | null> {
  return new Promise((resolve) => socket.emit('HOST_OVERRIDE', { override }, toError(resolve)));
}

/** Host only: steps back over the last game action or Override. Resolves like `send`. */
export function undo(): Promise<string | null> {
  return new Promise((resolve) => socket.emit('UNDO', {}, toError(resolve)));
}

/** Host only: removes a Player (bankrupt to the bank mid-game) or Spectator. Resolves like `send`. */
export function kick(targetId: string): Promise<string | null> {
  return new Promise((resolve) => socket.emit('KICK', { targetId }, toError(resolve)));
}

/** Host only: hands the Host role to another Player. Resolves like `send`. */
export function transferHost(playerId: string): Promise<string | null> {
  return new Promise((resolve) => socket.emit('TRANSFER_HOST', { playerId }, toError(resolve)));
}

/** Host only: makes a Spectator a Player. Resolves like `send`. */
export function addPlayer(spectatorId: string): Promise<string | null> {
  return new Promise((resolve) => socket.emit('ADD_PLAYER', { spectatorId }, toError(resolve)));
}
