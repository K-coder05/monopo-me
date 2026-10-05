import type { GameEvent, GameState } from '@landlord/engine';

/** One line of game log text for an event. */
export function describeEvent(event: GameEvent, game: GameState): string {
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? 'Someone';
  const space = (index: number) => game.board[index]?.name ?? `space ${index}`;

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
    case 'TURN_ENDED':
      return `${name(event.playerId)} ended their turn`;
  }
}
