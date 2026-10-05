import type { Rules, SpaceField } from '@landlord/engine';

/** How the editor shows each Rules key; `kind` decides the input and how its text is read back. */
export type RuleField = {
  key: keyof Rules;
  label: string;
  kind: 'number' | 'toggle' | 'list' | 'mode' | 'unlimited';
};

export const RULE_FIELDS: RuleField[] = [
  { key: 'startingCash', label: 'Starting cash', kind: 'number' },
  { key: 'goSalary', label: 'GO salary', kind: 'number' },
  { key: 'doubleSalaryOnExactGo', label: 'Double salary on exact GO', kind: 'toggle' },
  { key: 'diceCount', label: 'Dice', kind: 'number' },
  { key: 'diceSides', label: 'Sides per die', kind: 'number' },
  { key: 'doublesRollAgain', label: 'Doubles roll again', kind: 'toggle' },
  { key: 'doublesToJail', label: 'Doubles in a row to Jail (0 = never)', kind: 'number' },
  { key: 'auctionOnDecline', label: 'Auction when declined', kind: 'toggle' },
  { key: 'auctionStartBid', label: 'Auction start bid', kind: 'number' },
  { key: 'auctionSeconds', label: 'Auction countdown (s)', kind: 'number' },
  { key: 'colourGroupRentMultiplier', label: 'Colour group rent multiplier', kind: 'number' },
  { key: 'stationRents', label: 'Station rents (comma separated)', kind: 'list' },
  { key: 'utilityMultipliers', label: 'Utility multipliers (comma separated)', kind: 'list' },
  { key: 'freeParkingMode', label: 'Free Parking', kind: 'mode' },
  { key: 'freeParkingAmount', label: 'Free Parking fixed amount', kind: 'number' },
  { key: 'jailFine', label: 'Jail fine', kind: 'number' },
  { key: 'maxJailTurns', label: 'Max turns in Jail', kind: 'number' },
  { key: 'collectRentInJail', label: 'Collect rent while in Jail', kind: 'toggle' },
  { key: 'evenBuildRule', label: 'Even build rule', kind: 'toggle' },
  { key: 'housesPerHotel', label: 'Houses per hotel (1–4)', kind: 'number' },
  { key: 'bankHouses', label: 'Bank houses (blank = unlimited)', kind: 'unlimited' },
  { key: 'bankHotels', label: 'Bank hotels (blank = unlimited)', kind: 'unlimited' },
  { key: 'buildingSellbackRate', label: 'Building sell-back rate (0–1)', kind: 'number' },
  { key: 'mortgageRate', label: 'Mortgage rate (0–1)', kind: 'number' },
  { key: 'unmortgageInterest', label: 'Unmortgage interest (0–1)', kind: 'number' },
  { key: 'tradingEnabled', label: 'Trading enabled', kind: 'toggle' },
  { key: 'mustCompleteLapBeforeBuying', label: 'Must complete a lap before buying', kind: 'toggle' },
  { key: 'turnTimerSeconds', label: 'Turn timer (s, 0 = off)', kind: 'number' },
];

export const FREE_PARKING_MODES = ['nothing', 'fixed', 'jackpot'] as const;

export const RULE_LABELS = Object.fromEntries(RULE_FIELDS.map((f) => [f.key, f.label])) as Record<string, string>;

export const SPACE_FIELD_LABELS: Record<SpaceField, string> = {
  name: 'name',
  price: 'price',
  houseCost: 'house cost',
  rents: 'rents',
  taxAmount: 'tax',
};

/** A value as shown in the log and toasts. */
export function showValue(value: unknown): string {
  if (value === null) return 'unlimited';
  if (value === true) return 'on';
  if (value === false) return 'off';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}
