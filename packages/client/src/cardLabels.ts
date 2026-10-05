import type { Amount, CardDraft, DeckKind, Effect, GameState, PartySelector } from '@landlord/engine';

export const DECK_LABELS: Record<DeckKind, string> = { chance: 'Chance', treasure: 'Treasure' };

type NamedSelector = Exclude<PartySelector, object>;

export const SELECTOR_LABELS: Record<NamedSelector, string> = {
  drawer: 'the drawer',
  bank: 'the bank',
  allOthers: 'every other player',
  everyone: 'everyone',
  drawerChoice: "the drawer's choice",
  random: 'a random player',
  richest: 'the richest player',
  poorest: 'the poorest player',
  left: 'the next player',
  right: 'the previous player',
};

export const EFFECT_LABELS: Record<Effect['type'], string> = {
  TRANSFER: 'Transfer cash',
  MOVE_TO: 'Move to a space',
  MOVE_RELATIVE: 'Move forward or back',
  MOVE_TO_NEAREST: 'Move to the nearest',
  GO_TO_JAIL: 'Go to Jail',
  GET_OUT_OF_JAIL: 'Get out of Jail free',
  REPAIRS: 'Repairs',
  SKIP_TURNS: 'Skip turns',
  EXTRA_TURN: 'Extra turn',
  SWAP_POSITION: 'Swap places with the drawer',
  MANUAL: 'Manual (Host resolves)',
};

/** Editor shortcuts: each saves as a TRANSFER with these Parties (build spec §6). */
export const SHORTCUTS = {
  collect: { label: 'Collect from bank', from: 'bank', to: 'drawer' },
  pay: { label: 'Pay bank', from: 'drawer', to: 'bank' },
  collectEach: { label: 'Collect from each', from: 'allOthers', to: 'drawer' },
  payEach: { label: 'Pay each', from: 'drawer', to: 'allOthers' },
  steal: { label: 'Steal cash', from: 'drawerChoice', to: 'drawer' },
} as const satisfies Record<string, { label: string; from: PartySelector; to: PartySelector }>;

export type Shortcut = keyof typeof SHORTCUTS;

/** Who a Steal cash shortcut may take from: a Player the drawer picks, the richest or a random one. */
const STEAL_FROM: PartySelector[] = ['drawerChoice', 'richest', 'random'];

/** The shortcut a Transfer matches, so the builder can show it under its friendlier name. */
export function shortcutOf(effect: Effect): Shortcut | undefined {
  if (effect.type !== 'TRANSFER') return undefined;
  if (effect.to === 'drawer' && STEAL_FROM.includes(effect.from)) return 'steal';
  return (Object.keys(SHORTCUTS) as Shortcut[]).find((k) => SHORTCUTS[k].from === effect.from && SHORTCUTS[k].to === effect.to);
}

/** A fresh Effect of `type` (or a shortcut) with sensible starting values, keeping the amount of a Transfer. */
export function newEffect(kind: Effect['type'] | Shortcut, previous?: Effect): Effect {
  const amount: Amount = previous?.type === 'TRANSFER' ? previous.amount : 50;
  if (kind in SHORTCUTS) {
    const { from, to } = SHORTCUTS[kind as Shortcut];
    return { type: 'TRANSFER', amount, from, to };
  }
  switch (kind as Effect['type']) {
    case 'TRANSFER':
      return { type: 'TRANSFER', amount, from: 'drawer', to: 'bank' };
    case 'MOVE_TO':
      return { type: 'MOVE_TO', index: 0, collectGo: true };
    case 'MOVE_RELATIVE':
      return { type: 'MOVE_RELATIVE', steps: -3 };
    case 'MOVE_TO_NEAREST':
      return { type: 'MOVE_TO_NEAREST', kind: 'station', rentMultiplier: 2 };
    case 'REPAIRS':
      return { type: 'REPAIRS', perHouse: 25, perHotel: 100 };
    case 'SKIP_TURNS':
      return { type: 'SKIP_TURNS', count: 1 };
    default:
      return { type: kind } as Effect;
  }
}

export const blankCard = (): CardDraft => ({ title: '', text: '', effects: [newEffect('collect')], enabled: true, copies: 1 });

/** A selector as a value for a <select>, and back. */
export const selectorKey = (s: PartySelector | undefined): string =>
  s === undefined ? 'drawer' : typeof s !== 'object' ? s : 'player' in s ? `player:${s.player}` : `name:${s.playerName}`;
export const selectorFromKey = (key: string): PartySelector =>
  key.startsWith('player:') ? { player: key.slice(7) } : key.startsWith('name:') ? { playerName: key.slice(5) } : (key as PartySelector);

/** A Player a card loaded from a Preset names, who was not in the Room. */
export const missingLabel = (name: string) => `${name} (not in this Room)`;

export function partyName(game: GameState, s: PartySelector | undefined): string {
  if (s === undefined) return SELECTOR_LABELS.drawer;
  if (typeof s !== 'object') return SELECTOR_LABELS[s];
  if ('playerName' in s) return missingLabel(s.playerName);
  return game.players.find((p) => p.id === s.player)?.name ?? 'a missing player';
}

const showAmount = (amount: Amount) => {
  const percent = typeof amount === 'string' ? /^percentOfCash\(\s*([\d.]+)\s*\)$/.exec(amount.trim()) : null;
  return percent ? `${percent[1]}% of cash` : String(amount);
};

/** One short line describing an Effect, for the card list. */
export function summarizeEffect(effect: Effect, game: GameState): string {
  const who = 'target' in effect && effect.target !== undefined && effect.target !== 'drawer' ? ` (${partyName(game, effect.target)})` : '';
  switch (effect.type) {
    case 'TRANSFER':
      return `${partyName(game, effect.from)} pays ${showAmount(effect.amount)} to ${partyName(game, effect.to)}`;
    case 'MOVE_TO':
      return `Move to ${game.board[effect.index]?.name ?? `space ${effect.index}`}${effect.collectGo ? ', collecting salary' : ''}${who}`;
    case 'MOVE_RELATIVE':
      return `Move ${effect.steps > 0 ? 'forward' : 'back'} ${Math.abs(effect.steps)}${who}`;
    case 'MOVE_TO_NEAREST': {
      const pay =
        effect.diceMultiplier !== undefined ? `, pay ${effect.diceMultiplier}× dice` : effect.rentMultiplier !== undefined ? `, pay ${effect.rentMultiplier}× rent` : '';
      return `Move to the nearest ${effect.kind}${pay}${who}`;
    }
    case 'REPAIRS':
      return `Repairs: ${effect.perHouse} per house, ${effect.perHotel} per hotel${who}`;
    case 'SKIP_TURNS':
      return `Miss ${effect.count} turn${effect.count === 1 ? '' : 's'}${who}`;
    default:
      return `${EFFECT_LABELS[effect.type]}${who}`;
  }
}

/** The card text as Players will see it, with placeholders filled in as far as they can be before a draw. */
export function previewText(card: CardDraft, game: GameState): string {
  const transfer = card.effects.find((e) => e.type === 'TRANSFER');
  if (transfer?.type !== 'TRANSFER') return card.text;
  return card.text
    .replace(/\{from\}/g, () => partyName(game, transfer.from))
    .replace(/\{to\}/g, () => partyName(game, transfer.to))
    .replace(/\{amount\}/g, () => showAmount(transfer.amount));
}
