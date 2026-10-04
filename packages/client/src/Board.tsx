import type { GameState, SpaceDefinition } from '@landlord/engine';

const SIDE = 11;

const GROUP_COLORS: Record<string, string> = {
  brown: '#8b5a2b',
  lightBlue: '#a8d8f0',
  pink: '#d63a96',
  orange: '#f39c12',
  red: '#e02020',
  yellow: '#f5e050',
  green: '#1fa84f',
  darkBlue: '#1f4fa8',
};

const ICONS: Partial<Record<SpaceDefinition['type'], string>> = {
  go: '➜',
  station: '🚉',
  utility: '💡',
  chance: '?',
  treasure: '🎁',
  tax: '💰',
  jail: '▦',
  freeParking: 'P',
  goToJail: '👮',
};

/** CSS grid row/column for a space: GO bottom-right, then clockwise. Assumes 4 equal sides. */
function gridPosition(index: number): { row: number; col: number } {
  const n = SIDE - 1;
  if (index <= n) return { row: SIDE, col: SIDE - index };
  if (index <= 2 * n) return { row: SIDE - (index - n), col: 1 };
  if (index <= 3 * n) return { row: 1, col: 1 + (index - 2 * n) };
  return { row: 1 + (index - 3 * n), col: SIDE };
}

export function Board({ game }: { game: GameState }) {
  return (
    <div className="board">
      {game.board.map((space) => {
        const { row, col } = gridPosition(space.index);
        const here = game.players.filter((p) => p.position === space.index);
        const corner = space.index % (SIDE - 1) === 0;
        return (
          <div
            key={space.index}
            className={`space ${corner ? 'corner' : ''}`}
            style={{ gridRow: row, gridColumn: col }}
            title={space.name}
          >
            {space.type === 'street' && (
              <div className="bar" style={{ background: GROUP_COLORS[space.group ?? ''] ?? '#999' }} />
            )}
            {ICONS[space.type] && <div className="icon">{ICONS[space.type]}</div>}
            <div className="name">{space.name}</div>
            {space.price !== undefined && <div className="price">{space.price}</div>}
            {space.taxAmount !== undefined && <div className="price">Pay {space.taxAmount}</div>}
            {here.length > 0 && (
              <div className="tokens">
                {here.map((p) => (
                  <span key={p.id} className="token" style={{ background: p.color }} title={p.name} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="centre">
        <div className="title">Landlord</div>
        {game.turn && game.turn.lastRoll.length > 0 && (
          <div className="dice">
            {game.turn.lastRoll.map((d, i) => (
              <span key={i} className="die">
                {d}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
