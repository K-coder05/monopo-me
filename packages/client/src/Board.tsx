import { HOTEL, type GameState } from '@landlord/engine';
import { describeBuildings, groupColor } from './spaces';
import { SpaceIcon } from './SpaceIcon';

const SIDE = 11;

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

/**
 * `positions` places tokens that are still walking (see usePlayback); `tumbling` shows dice faces
 * while they roll instead of the last roll.
 */
export function Board({
  game,
  onSelect,
  positions = {},
  tumbling = null,
}: {
  game: GameState;
  onSelect: (index: number) => void;
  positions?: Record<string, number>;
  tumbling?: number[] | null;
}) {
  const dice = tumbling ?? game.turn?.lastRoll ?? [];
  return (
    <div className="board">
      {game.board.map((space) => {
        const { row, col } = gridPosition(space.index);
        const here = game.players.filter((p) => (positions[p.id] ?? p.position) === space.index);
        const corner = space.index % (SIDE - 1) === 0;
        const deed = game.deeds[space.index];
        const owner = deed && game.players.find((p) => p.id === deed.ownerId);
        return (
          <button
            key={space.index}
            type="button"
            className={`space ${corner ? 'corner' : ''} ${deed?.mortgaged ? 'mortgaged' : ''}`}
            style={{ gridRow: row, gridColumn: col }}
            title={owner ? `${space.name} (owned by ${owner.name}${deed.mortgaged ? ', mortgaged' : ''})` : space.name}
            onClick={() => onSelect(space.index)}
          >
            {space.type === 'street' && (
              <div className="bar" style={{ background: groupColor(space.group) }}>
                <Buildings count={deed?.buildings ?? 0} />
              </div>
            )}
            {owner && <div className="owner" style={{ background: owner.color }} aria-label={`Owned by ${owner.name}`} />}
            {deed?.mortgaged && <div className="mortgage-tag">Mortgaged</div>}
            <SpaceIcon type={space.type} className="icon" />
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
        <div className="decks">
          <div className="deck chance">
            <SpaceIcon type="chance" />
            Chance
          </div>
          <div className="deck treasure">
            <SpaceIcon type="treasure" />
            Treasure
          </div>
        </div>
        <div className="title">Landlord</div>
        {game.rules.freeParkingMode === 'jackpot' && <div className="jackpot">Jackpot: {game.bank.jackpot}</div>}
        {dice.length > 0 && (
          <div className={`dice ${tumbling ? 'tumbling' : ''}`} aria-label={tumbling ? 'Rolling' : `Rolled ${dice.join(' and ')}`}>
            {dice.map((d, i) => (
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
