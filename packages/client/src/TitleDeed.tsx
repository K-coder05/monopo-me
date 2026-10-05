import { useEffect } from 'react';
import { isProperty, mortgageValue, unmortgageCost, type GameState, type SpaceDefinition } from '@landlord/engine';
import { describeBuildings, groupColor } from './spaces';

/** Title-deed card for any space: rent table, owner and mortgage status. */
export function TitleDeed({ game, index, onClose }: { game: GameState; index: number; onClose: () => void }) {
  const space = game.board[index]!;
  const deed = game.deeds[index];
  const owner = deed && game.players.find((p) => p.id === deed.ownerId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal deed" role="dialog" aria-label={space.name} onClick={(e) => e.stopPropagation()}>
        <header style={space.type === 'street' ? { background: groupColor(space.group) } : undefined}>
          <h2>{space.name}</h2>
        </header>

        {isProperty(space) ? (
          <>
            <RentTable space={space} game={game} />
            <dl>
              <dt>List price</dt>
              <dd>{space.price}</dd>
              {space.houseCost !== undefined && (
                <>
                  <dt>House cost</dt>
                  <dd>{space.houseCost}</dd>
                </>
              )}
              <dt>Mortgage value</dt>
              <dd>{mortgageValue(space, game.rules)}</dd>
              <dt>Unmortgage cost</dt>
              <dd>{unmortgageCost(space, game.rules)}</dd>
              <dt>Owner</dt>
              <dd>
                {owner ? (
                  <>
                    <span className="token" style={{ background: owner.color }} /> {owner.name}
                  </>
                ) : (
                  'Bank'
                )}
              </dd>
              {deed && space.type === 'street' && (
                <>
                  <dt>Buildings</dt>
                  <dd>{deed.buildings === 0 ? 'none' : describeBuildings(deed.buildings)}</dd>
                </>
              )}
              {deed && (
                <>
                  <dt>Mortgaged</dt>
                  <dd>{deed.mortgaged ? 'Yes' : 'No'}</dd>
                </>
              )}
            </dl>
          </>
        ) : (
          <p>{describeSpace(space)}</p>
        )}

        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function RentTable({ space, game }: { space: SpaceDefinition; game: GameState }) {
  const { rules } = game;
  let rows: [string, string][];
  if (space.type === 'street') {
    const rents = space.rents ?? [];
    rows = [
      ['Rent', `${rents[0]}`],
      ['With full Colour group', `${Math.ceil((rents[0] ?? 0) * rules.colourGroupRentMultiplier)}`],
      ...rents.slice(1, 5).map((r, i): [string, string] => [`With ${i + 1} house${i ? 's' : ''}`, `${r}`]),
      ['With hotel', `${rents[5]}`],
    ];
  } else if (space.type === 'station') {
    rows = rules.stationRents.map((r, i) => [`${i + 1} station${i ? 's' : ''} owned`, `${r}`]);
  } else {
    rows = rules.utilityMultipliers.map((m, i) => [`${i + 1} utilit${i ? 'ies' : 'y'} owned`, `${m} × dice`]);
  }
  return (
    <table>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td>{label}</td>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function describeSpace(space: SpaceDefinition): string {
  switch (space.type) {
    case 'go':
      return 'Collect your salary as you pass.';
    case 'tax':
      return `Pay ${space.taxAmount} to the bank.`;
    case 'chance':
    case 'treasure':
      return 'Draw a card.';
    case 'jail':
      return 'Just visiting, unless you are in Jail.';
    case 'freeParking':
      return 'Take a rest.';
    case 'goToJail':
      return 'Go straight to Jail.';
    default:
      return '';
  }
}
