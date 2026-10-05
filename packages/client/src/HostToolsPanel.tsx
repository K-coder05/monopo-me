import { useState } from 'react';
import { HOTEL, isProperty, UNDO_LIMIT, type GameState, type Override } from '@landlord/engine';
import { hostOverride, send, undo } from './socket';
import { RoomMembers } from './RoomMembers';
import { describeBuildings } from './spaces';

type PlayerSelectProps = { game: GameState; value: string; onChange: (id: string) => void; label: string; withBank?: boolean };

/** A picker over the Players still in the game; with `withBank`, the bank too (as the value ''). */
function PlayerSelect({ game, value, onChange, label, withBank }: PlayerSelectProps) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {withBank && <option value="">The bank</option>}
      {game.players
        .filter((p) => !p.bankrupt)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
    </select>
  );
}

/**
 * Host-only side panel with every Override and Undo. Each applies at once and is logged for
 * everyone; the server refuses what does not fit the game right now and says why.
 */
export function HostToolsPanel({ game, me, away, onClose }: { game: GameState; me: string; away: string[]; onClose: () => void }) {
  const firstPlayer = game.players.find((p) => !p.bankrupt)?.id ?? '';
  const properties = game.board.filter(isProperty);
  const [error, setError] = useState<string | null>(null);
  const [cashPlayer, setCashPlayer] = useState(firstPlayer);
  const [amount, setAmount] = useState('');
  const [movePlayer, setMovePlayer] = useState(firstPlayer);
  const [moveTo, setMoveTo] = useState(0);
  const [deedIndex, setDeedIndex] = useState(properties[0]?.index ?? 0);
  const [deedOwner, setDeedOwner] = useState('');
  const [streetIndex, setStreetIndex] = useState<number | null>(null);
  const [buildings, setBuildings] = useState(0);
  const [jailPlayer, setJailPlayer] = useState(firstPlayer);
  const [skipPlayer, setSkipPlayer] = useState(firstPlayer);

  const turn = game.turn;
  const debt = turn?.step === 'awaitDebt' ? game.debts[0] : undefined;
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? 'Someone';
  const ownedStreets = game.board.filter((s) => s.type === 'street' && game.deeds[s.index]);
  const street = ownedStreets.find((s) => s.index === streetIndex) ?? ownedStreets[0];
  const jailed = game.players.find((p) => p.id === jailPlayer)?.inJail ?? false;
  const cashDelta = Number(amount);
  const [ending, setEnding] = useState(false);

  async function apply(override: Override) {
    setError(await hostOverride(override));
  }

  return (
    <aside className="rules-panel" aria-label="Host tools">
      <div className="rules-head">
        <h2>Host tools</h2>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="muted">Overrides change the game at once and are logged for everyone.</p>
      {turn?.step === 'awaitManual' && <p className="notice">A manual card is waiting: resolve it here, then press Done on the card.</p>}

      <h3>Undo</h3>
      <div className="actions">
        <button className="secondary" onClick={async () => setError(await undo())}>
          Undo last action
        </button>
      </div>
      <p className="muted">Goes back up to {UNDO_LIMIT} steps. Rules, Board and card edits stay; dice are rolled afresh.</p>

      <h3>Cash</h3>
      <div className="actions">
        <PlayerSelect game={game} label="Player" value={cashPlayer} onChange={setCashPlayer} />
        <input type="number" step={1} placeholder="+/- amount" aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button
          disabled={!Number.isInteger(cashDelta) || cashDelta === 0}
          onClick={() => apply({ kind: 'ADJUST_CASH', playerId: cashPlayer, amount: cashDelta })}
        >
          Adjust
        </button>
      </div>

      <h3>Move a token</h3>
      <div className="actions">
        <PlayerSelect game={game} label="Player to move" value={movePlayer} onChange={setMovePlayer} />
        <select aria-label="Space" value={moveTo} onChange={(e) => setMoveTo(Number(e.target.value))}>
          {game.board.map((s) => (
            <option key={s.index} value={s.index}>
              {s.name}
            </option>
          ))}
        </select>
        <button onClick={() => apply({ kind: 'MOVE_TOKEN', playerId: movePlayer, index: moveTo })}>Move</button>
      </div>
      <p className="muted">No GO salary, and the space is not resolved.</p>

      <h3>Deeds</h3>
      <div className="actions">
        <select aria-label="Property" value={deedIndex} onChange={(e) => setDeedIndex(Number(e.target.value))}>
          {properties.map((s) => {
            const deed = game.deeds[s.index];
            return (
              <option key={s.index} value={s.index}>
                {s.name} ({deed ? name(deed.ownerId) : 'bank'})
              </option>
            );
          })}
        </select>
        <PlayerSelect game={game} label="New owner" value={deedOwner} onChange={setDeedOwner} withBank />
        <button onClick={() => apply({ kind: 'SET_OWNER', index: deedIndex, ownerId: deedOwner || null })}>Give</button>
      </div>

      <h3>Buildings</h3>
      {street ? (
        <div className="actions">
          <select aria-label="Street" value={street.index} onChange={(e) => setStreetIndex(Number(e.target.value))}>
            {ownedStreets.map((s) => (
              <option key={s.index} value={s.index}>
                {s.name} ({describeBuildings(game.deeds[s.index]!.buildings)})
              </option>
            ))}
          </select>
          <select aria-label="Buildings" value={buildings} onChange={(e) => setBuildings(Number(e.target.value))}>
            {[0, 1, 2, 3, 4, HOTEL].map((b) => (
              <option key={b} value={b}>
                {describeBuildings(b)}
              </option>
            ))}
          </select>
          <button onClick={() => apply({ kind: 'SET_BUILDINGS', index: street.index, buildings })}>Set</button>
        </div>
      ) : (
        <p className="muted">No street is owned yet.</p>
      )}

      <h3>Jail</h3>
      <div className="actions">
        <PlayerSelect game={game} label="Player for Jail" value={jailPlayer} onChange={setJailPlayer} />
        {jailed ? (
          <button onClick={() => apply({ kind: 'RELEASE_FROM_JAIL', playerId: jailPlayer })}>Release</button>
        ) : (
          <button onClick={() => apply({ kind: 'SEND_TO_JAIL', playerId: jailPlayer })}>Send to Jail</button>
        )}
      </div>

      <h3>Turns</h3>
      <div className="actions">
        <PlayerSelect game={game} label="Player to skip" value={skipPlayer} onChange={setSkipPlayer} />
        <button className="secondary" onClick={() => apply({ kind: 'SKIP_TURN', playerId: skipPlayer })}>
          Skip their next turn
        </button>
      </div>
      {turn && (
        <div className="actions">
          <button disabled={turn.step === 'awaitDebt' || turn.step === 'auction'} onClick={() => apply({ kind: 'END_TURN' })}>
            End {name(turn.playerId)}&apos;s turn now
          </button>
        </div>
      )}

      <h3>Debt</h3>
      {debt ? (
        <>
          <p>
            {name(debt.debtorId)} owes {debt.amount} to {debt.creditor.type === 'bank' ? 'the bank' : name(debt.creditor.playerId)}.
          </p>
          <div className="actions">
            <button className="secondary" onClick={() => apply({ kind: 'SETTLE_DEBT' })}>
              Cancel it
            </button>
            <button onClick={() => apply({ kind: 'FORCE_DEBT' })}>Force it (pay or go bankrupt)</button>
            <button className="secondary" onClick={() => apply({ kind: 'DECLARE_BANKRUPTCY' })}>
              Declare them bankrupt
            </button>
          </div>
        </>
      ) : (
        <p className="muted">Nobody owes anything right now.</p>
      )}

      <h3>Players and Spectators</h3>
      <RoomMembers game={game} me={me} away={away} />

      <h3>End the game</h3>
      <div className="actions">
        {ending ? (
          <>
            <button onClick={async () => setError(await send('END_GAME'))}>End it now, with no Winner</button>
            <button className="secondary" onClick={() => setEnding(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="secondary" onClick={() => setEnding(true)}>
            End game
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}
    </aside>
  );
}
