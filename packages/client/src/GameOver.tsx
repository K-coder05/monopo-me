import { useState } from 'react';
import type { GameState } from '@landlord/engine';
import { send } from './socket';
import { LeaveButton } from './LeaveButton';

/**
 * The Winner, then the others in reverse order of bankruptcy (the last one out is 2nd). A game the
 * Host ended has no Winner: those still in come first, in turn order.
 */
export function GameOver({ game, me }: { game: GameState; me: string }) {
  const [error, setError] = useState<string | null>(null);
  const isHost = me === game.hostId;
  const stillIn = game.winnerId ? [game.winnerId] : game.players.filter((p) => !p.bankrupt).map((p) => p.id);
  const player = (id: string) => game.players.find((p) => p.id === id);
  // A Player who left after the game is no longer in the Room.
  const ranking = [...stillIn, ...[...game.bankruptcies].reverse()].filter((id) => player(id));

  async function choose(intent: 'REMATCH' | 'BACK_TO_LOBBY') {
    setError(await send(intent));
  }

  return (
    <main className="lobby">
      <h1>Game over</h1>
      {game.winnerId ? (
        <p>
          <strong>{player(game.winnerId)?.name ?? 'Someone'}</strong> wins!
        </p>
      ) : (
        <p>The Host ended the game, so there is no Winner.</p>
      )}
      <ol className="ranking">
        {ranking.map((id) => (
          <li key={id}>
            <span className="token" style={{ background: player(id)?.color }} /> {player(id)?.name}
            {id === me && ' (you)'}
          </li>
        ))}
      </ol>
      {isHost ? (
        <div className="actions">
          <button onClick={() => choose('REMATCH')}>Rematch</button>
          <button className="secondary" onClick={() => choose('BACK_TO_LOBBY')}>
            Back to Lobby
          </button>
        </div>
      ) : (
        <p className="muted">Waiting for the Host to choose Rematch or Back to Lobby.</p>
      )}
      {!isHost && <LeaveButton game={game} me={me} />}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
