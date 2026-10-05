import { HOTEL, type GameState, type SpaceDefinition } from '@landlord/engine';
import { describeBuildings, groupColor } from './spaces';

const SIDE = 11;

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

function Buildings({ count }: { count: number }) {
  if (count === 0) return null;
  if (count === HOTEL) return <span className="hotel" aria-label="Hotel" />;
  return (
    <span className="houses" aria-label={describeBuildings(count)}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="house" />
      ))}
    </span>
  );
}

export function Board({ game, onSelect }: { game: GameState; onSelect: (index: number) => void }) {
  return (
    <div className="board">
      {game.board.map((space) => {
        const { row, col } = gridPosition(space.index);
        const here = game.players.filter((p) => p.position === space.index);
        const corner = space.index % (SIDE - 1) === 0;
        const deed = game.deeds[space.index];
        const owner = deed && game.players.find((p) => p.id === deed.ownerId);
        return (
          <button
            key={space.index}
            type="button"
            className={`space ${corner ? 'corner' : ''}`}
            style={{ gridRow: row, gridColumn: col }}
            title={owner ? `${space.name} (owned by ${owner.name})` : space.name}
            onClick={() => onSelect(space.index)}
          >
            {space.type === 'street' && (
              <div className="bar" style={{ background: groupColor(space.group) }}>
                <Buildings count={deed?.buildings ?? 0} />
              </div>
            )}
            {owner && <div className="owner" style={{ background: owner.color }} aria-label={`Owned by ${owner.name}`} />}
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
          </button>
        );
      })}
      <div className="centre">
        <div className="title">Landlord</div>
        {game.rules.freeParkingMode === 'jackpot' && <div className="jackpot">Jackpot: {game.bank.jackpot}</div>}
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
