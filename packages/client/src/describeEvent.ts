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
    case 'TURN_ENDED':
      return `${name(event.playerId)} ended their turn`;
  }
}
