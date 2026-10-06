import type { GameEvent } from '@landlord/engine';

export type Sound = 'dice' | 'step' | 'cash' | 'pay' | 'card' | 'jail' | 'yourTurn' | 'fanfare';

/**
 * One thing to show for a batch of events, in order: the dice tumbling, a token walking its
 * path, or a sound at the moment it belongs (after the walk that led to it).
 */
export type Beat =
  | { kind: 'dice'; dice: number[] }
  | { kind: 'move'; playerId: string; path: number[] }
  | { kind: 'sound'; sound: Sound };

/** Spaces a token passes through going from `from` to `to`, ending on `to`. Clockwise unless `backward`. */
export function movePath(from: number, to: number, size: number, backward = false): number[] {
  const step = backward ? size - 1 : 1;
  const path: number[] = [];
  for (let at = from; at !== to; ) {
    at = (at + step) % size;
    path.push(at);
  }
  return path;
}

function soundFor(event: GameEvent, me: string): Sound | null {
  switch (event.type) {
    case 'PROPERTY_BOUGHT':
    case 'AUCTION_WON':
    case 'GO_SALARY':
    case 'JACKPOT_WON':
    case 'TRADE_COMPLETED':
      return 'cash';
    case 'RENT_PAID':
    case 'TAX_PAID':
      return 'pay';
    case 'CARD_DRAWN':
      return 'card';
    case 'JAILED':
      return 'jail';
    case 'TURN_STARTED':
      return event.playerId === me ? 'yourTurn' : null;
    default:
      return null;
  }
}

/** The sound a beat starts with: the dice rattle, its cue, or none for a walk (which ticks each step). */
export function cueOf(beat: Beat): Sound | null {
  if (beat.kind === 'dice') return 'dice';
  if (beat.kind === 'sound') return beat.sound;
  return null;
}

/**
 * What to play for a batch of new events on a Board of `size` spaces, as seen by the Player `me`.
 * The game's end gets its fanfare from App, as the Game Over screen replaces this one.
 */
export function plan(events: GameEvent[], size: number, me: string): Beat[] {
  const beats: Beat[] = [];
  for (const event of events) {
    if (event.type === 'DICE_ROLLED') {
      beats.push({ kind: 'dice', dice: event.dice });
    } else if (event.type === 'MOVED') {
      beats.push({ kind: 'move', playerId: event.playerId, path: movePath(event.from, event.to, size, event.backward) });
    } else {
      const sound = soundFor(event, me);
      if (sound) beats.push({ kind: 'sound', sound });
    }
  }
  return beats;
}
