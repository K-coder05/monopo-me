import { defaultBoard, defaultRules } from './defaults';
import { IllegalActionError } from './engine';
import type { GameEvent, GameState, PendingEdit, Rules, SpaceDefinition, SpaceField } from './types';

/** Host edits to Rules and Board: validation, staging and applying (build spec §5). */

type Check = (value: unknown) => string | null;

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const int = (min: number, max = Infinity): Check => (v) =>
  isNumber(v) && Number.isInteger(v) && v >= min && v <= max
    ? null
    : max === Infinity
      ? `must be a whole number, ${min} or more`
      : `must be a whole number from ${min} to ${max}`;

const fraction: Check = (v) => (isNumber(v) && v >= 0 && v <= 1 ? null : 'must be a number from 0 to 1');
const toggle: Check = (v) => (typeof v === 'boolean' ? null : 'must be on or off');
const numberList = (item: Check, maxLength = 8): Check => (v) =>
  Array.isArray(v) && v.length >= 1 && v.length <= maxLength && v.every((x) => item(x) === null)
    ? null
    : `must be a list of 1–${maxLength} valid numbers`;
const orUnlimited = (check: Check): Check => (v) => (v === null ? null : check(v));

const nonNegativeInt = int(0);

/** Every Rules key the Host may edit (not the Player limits). */
const RULE_CHECKS: Partial<Record<keyof Rules, Check>> = {
  startingCash: nonNegativeInt,
  goSalary: nonNegativeInt,
  doubleSalaryOnExactGo: toggle,
  diceCount: int(1, 6),
  diceSides: int(2, 100),
  doublesRollAgain: toggle,
  doublesToJail: nonNegativeInt,
  auctionOnDecline: toggle,
  auctionStartBid: nonNegativeInt,
  auctionSeconds: int(1, 600),
  colourGroupRentMultiplier: (v) => (isNumber(v) && v >= 0 && v <= 100 ? null : 'must be a number from 0 to 100'),
  stationRents: numberList(nonNegativeInt),
  utilityMultipliers: numberList((v) => (isNumber(v) && v >= 0 && v <= 1000 ? null : 'bad')),
  freeParkingMode: (v) => (v === 'nothing' || v === 'fixed' || v === 'jackpot' ? null : 'must be nothing, fixed or jackpot'),
  freeParkingAmount: nonNegativeInt,
  jailFine: nonNegativeInt,
  maxJailTurns: int(1, 20),
  collectRentInJail: toggle,
  evenBuildRule: toggle,
  housesPerHotel: int(1, 4),
  bankHouses: orUnlimited(nonNegativeInt),
  bankHotels: orUnlimited(nonNegativeInt),
  buildingSellbackRate: fraction,
  mortgageRate: fraction,
  unmortgageInterest: fraction,
  tradingEnabled: toggle,
  mustCompleteLapBeforeBuying: toggle,
  turnTimerSeconds: nonNegativeInt,
};

/** Which editable fields each kind of space has. */
const FIELDS_BY_TYPE: Partial<Record<SpaceDefinition['type'], SpaceField[]>> = {
  go: ['name'],
  street: ['name', 'price', 'houseCost', 'rents'],
  station: ['name', 'price'],
  utility: ['name', 'price'],
  chance: ['name'],
  treasure: ['name'],
  tax: ['name', 'taxAmount'],
  jail: ['name'],
  freeParking: ['name'],
  goToJail: ['name'],
};

const SPACE_FIELDS: SpaceField[] = ['name', 'price', 'houseCost', 'rents', 'taxAmount'];

const SPACE_CHECKS: Record<SpaceField, Check> = {
  name: (v) => (typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 30 ? null : 'must be 1–30 characters'),
  price: nonNegativeInt,
  houseCost: nonNegativeInt,
  rents: (v) =>
    Array.isArray(v) && v.length === 6 && v.every((x) => nonNegativeInt(x) === null)
      ? null
      : 'must have 6 entries (base, 1–4 houses, hotel), each a whole number, 0 or more',
  taxAmount: nonNegativeInt,
};

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Checks a Rules patch from an untrusted sender. */
function validRules(changes: unknown): Partial<Rules> {
  if (!isPlainObject(changes)) throw new IllegalActionError('Rules changes must be an object');
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    const check = (RULE_CHECKS as Record<string, Check | undefined>)[key];
    if (!check) throw new IllegalActionError(`${key} is not an editable rule`);
    const problem = check(value);
    if (problem) throw new IllegalActionError(`${key} ${problem}`);
    out[key] = value;
  }
  return out as Partial<Rules>;
}

/** Checks space edits from an untrusted sender against the current Board. */
function validBoard(edits: unknown, board: SpaceDefinition[]): PendingEdit['board'] {
  if (!Array.isArray(edits)) throw new IllegalActionError('Board edits must be a list');
  const out: PendingEdit['board'] = {};
  for (const edit of edits as unknown[]) {
    if (!isPlainObject(edit)) throw new IllegalActionError('Each Board edit must be an object');
    const space = Number.isInteger(edit.index) ? board[edit.index as number] : undefined;
    if (!space) throw new IllegalActionError('No such space on the Board');
    const allowed = FIELDS_BY_TYPE[space.type] ?? [];
    const fields: Record<string, unknown> = out[space.index] ?? {};
    for (const [field, value] of Object.entries(edit)) {
      if (field === 'index') continue;
      if (!SPACE_FIELDS.includes(field as SpaceField)) throw new IllegalActionError(`${field} is not an editable space value`);
      if (!allowed.includes(field as SpaceField)) throw new IllegalActionError(`${space.name} has no ${field}`);
      const problem = SPACE_CHECKS[field as SpaceField](value);
      if (problem) throw new IllegalActionError(`${space.name}: ${field} ${problem}`);
      fields[field] = typeof value === 'string' ? value.trim() : value;
    }
    out[space.index] = fields;
  }
  return out;
}

/** The built-in Defaults as one edit that overwrites every Rules key and editable space value. */
function defaultsEdit(): PendingEdit {
  const board: PendingEdit['board'] = {};
  for (const space of defaultBoard) {
    const fields: Record<string, unknown> = {};
    for (const field of FIELDS_BY_TYPE[space.type] ?? []) fields[field] = structuredClone(space[field]);
    board[space.index] = fields;
  }
  return { rules: structuredClone(defaultRules), board, reset: true };
}

function requireHost(state: GameState, playerId: string) {
  if (playerId !== state.hostId) throw new IllegalActionError('Only the Host can change Rules or the Board');
}

function merge(pending: PendingEdit | undefined, edit: PendingEdit): PendingEdit {
  const board: PendingEdit['board'] = { ...pending?.board };
  for (const [index, fields] of Object.entries(edit.board)) board[Number(index)] = { ...board[Number(index)], ...fields };
  return { rules: { ...pending?.rules, ...edit.rules }, board, reset: pending?.reset };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Stages the edit; `applyPending` then applies it unless a multi-step action is running. */
function stage(state: GameState, edit: PendingEdit): GameState {
  return { ...state, pendingEdit: merge(state.pendingEdit, edit) };
}

export function updateRules(state: GameState, playerId: string, changes: unknown): GameState {
  requireHost(state, playerId);
  return stage(state, { rules: validRules(changes), board: {} });
}

export function updateBoard(state: GameState, playerId: string, edits: unknown): GameState {
  requireHost(state, playerId);
  return stage(state, { rules: {}, board: validBoard(edits, state.board) });
}

export function resetToDefaults(state: GameState, playerId: string): GameState {
  requireHost(state, playerId);
  // Replaces anything already waiting, so the reset is not undone by an earlier queued edit.
  return { ...state, pendingEdit: defaultsEdit() };
}

/** A multi-step action is running: an Auction, a Debt or a Card being resolved. */
function isBusy(state: GameState): boolean {
  if (state.phase !== 'playing') return false;
  const step = state.turn?.step;
  return (
    step === 'auction' ||
    step === 'awaitDebt' ||
    step === 'awaitCard' ||
    (state.turn?.cards.length ?? 0) > 0 ||
    state.debts.length > 0 ||
    state.auctionQueue !== undefined
  );
}

/**
 * Applies waiting edits once no multi-step action is running. `justStaged` is true when this
 * action is the Host's edit itself, so a deferred edit is announced once.
 */
export function applyPending(state: GameState, events: GameEvent[], justStaged: boolean): GameState {
  const pending = state.pendingEdit;
  if (!pending) return state;
  if (isBusy(state)) {
    if (justStaged) events.push({ type: 'CHANGES_QUEUED' });
    return state;
  }

  const changes: GameEvent[] = [];
  const rules = { ...state.rules } as Record<string, unknown>;
  for (const [key, to] of Object.entries(pending.rules)) {
    if (same(rules[key], to)) continue;
    changes.push({ type: 'RULE_CHANGED', key: key as keyof Rules, from: rules[key] as never, to: to as never });
    rules[key] = to;
  }
  const board = state.board.map((space) => {
    const fields = pending.board[space.index];
    if (!fields) return space;
    const next: Record<string, unknown> = { ...space };
    for (const [field, to] of Object.entries(fields)) {
      if (same(next[field], to)) continue;
      changes.push({ type: 'SPACE_CHANGED', index: space.index, field: field as SpaceField, from: next[field] as never, to: to as never });
      next[field] = to;
    }
    return next as SpaceDefinition;
  });
  if (pending.reset) events.push({ type: 'DEFAULTS_RESTORED' });
  events.push(...changes);
  return {
    ...state,
    rules: rules as Rules,
    board,
    pendingEdit: undefined,
    rulesChangedMidGame: state.rulesChangedMidGame || (state.phase === 'playing' && changes.length > 0) || undefined,
  };
}
