import { DECK_LABELS } from './cardLabels';
import { RULE_LABELS, SPACE_FIELD_LABELS, showValue } from './ruleLabels';
import { HOTEL, type Creditor, type GameEvent, type GameState, type SkipReason, type TradeSide } from '@landlord/engine';

const SKIP_TEXT: Record<SkipReason, string> = {
  selfTransfer: 'a Player cannot pay themselves',
  playerGone: 'the named Player is bankrupt or gone',
  badTarget: 'that target does not fit this effect',
  badAmount: 'the amount could not be read',
  noSuchSpace: 'there is no such space',
  inJail: 'a Player in Jail cannot move',
};

/** One line of game log text for an event. */
export function describeEvent(event: GameEvent, game: GameState): string {
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? 'Someone';
  const creditor = (c: Creditor) => (c.type === 'bank' ? 'the bank' : name(c.playerId));
  const space = (index: number) => game.board[index]?.name ?? `space ${index}`;

  const side = (s: TradeSide) => {
    const parts = [
      ...(s.cash > 0 ? [`${s.cash} cash`] : []),
      ...s.properties.map(space),
      ...s.cards.map(() => 'a jail card'),
    ];
    return parts.length > 0 ? parts.join(', ') : 'nothing';
  };

  switch (event.type) {
    case 'PLAYER_JOINED':
      return `${name(event.playerId)} joined`;
    case 'GAME_STARTED':
      return 'The game has started. Rolling for turn order…';
    case 'ROLL_OFF':
      return `Roll-off: ${event.rolls.map((r) => `${name(r.playerId)} ${r.total}`).join(', ')}`;
    case 'TURN_ORDER_SET':
      return `Turn order: ${event.playerIds.map(name).join(' → ')}`;
    case 'TURN_STARTED':
      return `Round ${event.round}: ${name(event.playerId)}'s turn`;
    case 'DICE_ROLLED':
      return `${name(event.playerId)} rolled ${event.dice.join(' + ')} = ${event.total}`;
    case 'MOVED':
      return `${name(event.playerId)} moved from ${space(event.from)} to ${space(event.to)}`;
    case 'GO_SALARY':
      return `${name(event.playerId)} collected ${event.amount} salary`;
    case 'ROLL_AGAIN':
      return `Doubles! ${name(event.playerId)} rolls again`;
    case 'JAILED':
      return event.reason === 'doubles'
        ? `${name(event.playerId)} rolled too many Doubles in a row and went to Jail`
        : `${name(event.playerId)} went to Jail`;
    case 'STILL_IN_JAIL':
      return `${name(event.playerId)} stays in Jail (failed roll ${event.failedRolls})`;
    case 'JAIL_FINE_PAID':
      return event.forced
        ? `${name(event.playerId)} is out of rolls and must pay the ${event.amount} Jail fine`
        : `${name(event.playerId)} paid the ${event.amount} Jail fine`;
    case 'LEFT_JAIL':
      return `${name(event.playerId)} is out of Jail`;
    case 'TAX_PAID':
      return `${name(event.playerId)} paid ${event.amount} for ${space(event.index)}`;
    case 'FREE_PARKING_PAID':
      return `${name(event.playerId)} collected ${event.amount} on Free Parking`;
    case 'JACKPOT_WON':
      return `${name(event.playerId)} won the Jackpot: ${event.amount}`;
    case 'PROPERTY_OFFERED':
      return `${name(event.playerId)} may buy ${space(event.index)} for ${event.price}`;
    case 'PURCHASE_LOCKED':
      return `${name(event.playerId)} cannot buy ${space(event.index)} before passing GO`;
    case 'PROPERTY_BOUGHT':
      return `${name(event.playerId)} bought ${space(event.index)} for ${event.price}`;
    case 'PROPERTY_DECLINED':
      return `${name(event.playerId)} declined ${space(event.index)}`;
    case 'RENT_PAID':
      return `${name(event.playerId)} paid ${event.amount} rent to ${name(event.ownerId)} for ${space(event.index)}`;
    case 'RENT_WAIVED':
      return event.reason === 'mortgaged'
        ? `No rent: ${space(event.index)} is mortgaged`
        : `No rent: ${name(event.ownerId)} is in Jail`;
    case 'AUCTION_STARTED':
      return `Auction for ${space(event.index)} is open to everyone`;
    case 'BID_PLACED':
      return `${name(event.playerId)} bid ${event.amount}`;
    case 'AUCTION_PASSED':
      return `${name(event.playerId)} passed`;
    case 'AUCTION_WON':
      return `${name(event.playerId)} won ${space(event.index)} at auction for ${event.amount}`;
    case 'AUCTION_UNSOLD':
      return `Nobody bid; ${space(event.index)} stays with the bank`;
    case 'BUILDING_BUILT':
      return `${name(event.playerId)} built ${event.buildings === HOTEL ? 'a hotel' : 'a house'} on ${space(event.index)} for ${event.cost}`;
    case 'BUILDING_SOLD':
      return `${name(event.playerId)} sold a building on ${space(event.index)} for ${event.amount}`;
    case 'PROPERTY_MORTGAGED':
      return `${name(event.playerId)} mortgaged ${space(event.index)} for ${event.amount}`;
    case 'PROPERTY_UNMORTGAGED':
      return `${name(event.playerId)} unmortgaged ${space(event.index)} for ${event.cost}`;
    case 'TRADE_PROPOSED':
      return `${name(event.trade.proposerId)} ${event.counter ? 'countered' : 'offered'} ${name(event.trade.partnerId)}: ${side(event.trade.give)} for ${side(event.trade.take)}`;
    case 'TRADE_REJECTED':
      return `${name(event.trade.partnerId)} rejected ${name(event.trade.proposerId)}'s offer`;
    case 'TRADE_WITHDRAWN':
      return `${name(event.trade.proposerId)} withdrew their offer to ${name(event.trade.partnerId)}`;
    case 'TRADE_COMPLETED':
      return `Trade: ${name(event.trade.proposerId)} gave ${side(event.trade.give)}; ${name(event.trade.partnerId)} gave ${side(event.trade.take)}`;
    case 'TURN_ENDED':
      return `${name(event.playerId)} ended their turn`;
    case 'CARD_DRAWN':
      return `${name(event.playerId)} drew ${event.deck === 'chance' ? 'Chance' : 'Treasure'}: ${event.title}. ${event.text}`;
    case 'DECK_EMPTY':
      return `The ${event.deck === 'chance' ? 'Chance' : 'Treasure'} deck is empty; nothing happens`;
    case 'CARD_CONTINUED':
      return event.choiceId ? `${name(event.playerId)} chose ${name(event.choiceId)}` : `${name(event.playerId)} continued`;
    case 'CARD_TRANSFER':
      return `${creditor(event.from)} → ${creditor(event.to)}: ${event.amount}`;
    case 'CARD_EFFECT_SKIPPED':
      return `Card effect skipped: ${SKIP_TEXT[event.reason]}`;
    case 'CARD_KEPT':
      return `${name(event.playerId)} keeps a get-out-of-jail card`;
    case 'JAIL_CARD_USED':
      return `${name(event.playerId)} used a get-out-of-jail card`;
    case 'REPAIRS_PAID':
      return `${name(event.playerId)} paid ${event.amount} for repairs (${event.houses} houses, ${event.hotels} hotels)`;
    case 'SKIP_TURNS_SET':
      return `${name(event.playerId)} will miss ${event.count} turn${event.count === 1 ? '' : 's'}`;
    case 'TURN_SKIPPED':
      return `${name(event.playerId)} misses their turn`;
    case 'EXTRA_TURN_GRANTED':
      return `${name(event.playerId)} gets an extra turn`;
    case 'POSITIONS_SWAPPED':
      return `${name(event.playerId)} and ${name(event.otherId)} swapped places`;
    case 'DEBT_OWED':
      return `${name(event.debtorId)} owes ${event.amount} to ${creditor(event.creditor)} and must sell or mortgage`;
    case 'DEBT_PAID':
      return `${name(event.debtorId)} paid their ${event.amount} Debt to ${creditor(event.creditor)}`;
    case 'BANKRUPT':
      return `${name(event.playerId)} is bankrupt; everything goes to ${creditor(event.creditor)}`;
    case 'GAME_OVER':
      return `Game over: ${name(event.winnerId)} wins!`;
    case 'RETURNED_TO_LOBBY':
      return 'Back in the Lobby';
    case 'RULE_CHANGED':
      return `Host changed ${RULE_LABELS[event.key] ?? event.key}: ${showValue(event.from)} → ${showValue(event.to)}`;
    case 'SPACE_CHANGED':
      return `Host changed ${event.field === 'name' ? String(event.from) : (game.board[event.index]?.name ?? `space ${event.index}`)} ${SPACE_FIELD_LABELS[event.field]}: ${showValue(event.from)} → ${showValue(event.to)}`;
    case 'DEFAULTS_RESTORED':
      return 'Host reset Rules and Board to the defaults';
    case 'CHANGES_QUEUED':
      return "Host's changes will apply when the current action finishes";
    case 'CARD_ADDED':
      return `Host added ${DECK_LABELS[event.deck]} card "${event.title}"${event.text ? `: ${event.text}` : ''}`;
    case 'CARD_EDITED':
      return `Host edited ${DECK_LABELS[event.deck]} card "${event.title}"${event.text ? `: ${event.text}` : ''}`;
    case 'CARD_COPIES_CHANGED':
      return `Host changed copies of ${DECK_LABELS[event.deck]} card "${event.title}": ${event.from} → ${event.to}`;
    case 'CARD_ENABLED_CHANGED':
      return `Host ${event.enabled ? 'enabled' : 'disabled'} ${DECK_LABELS[event.deck]} card "${event.title}"`;
    case 'CARD_DELETED':
      return `Host deleted ${DECK_LABELS[event.deck]} card "${event.title}"`;
    case 'HELD_CARD_REMOVED':
      return `Host took "${event.title}" away from ${name(event.playerId)}`;
    case 'DECK_RESET':
      return `Host reset the ${DECK_LABELS[event.deck]} deck to the defaults`;
    case 'DECK_SHUFFLED':
      return `Host shuffled the ${DECK_LABELS[event.deck]} deck`;
    case 'DECK_CONTENTS_HIDDEN':
      return event.hidden ? 'Host hid the deck contents' : 'Host made the deck contents visible';
    case 'PRESET_LOADED':
      return `Host loaded the Preset "${event.name}"${
        event.flaggedCards > 0
          ? `; ${event.flaggedCards} card${event.flaggedCards === 1 ? ' names a Player' : 's name Players'} not in this Room and won't be drawn until the Host picks someone`
          : ''
      }`;
    case 'PRESET_APPLIED':
      return `The Rules and Board from the Preset "${event.name}" now apply`;
  }
}
