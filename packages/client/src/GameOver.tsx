import { useState } from 'react';
import type { GameState } from '@landlord/engine';
import { send } from './socket';

/** The Winner, then the others in reverse order of bankruptcy (the last one out is 2nd). */
export function GameOver({ game, me }: { game: GameState; me: string }) {
  const [error, setError] = useState<string | null>(null);
  const isHost = me === game.hostId;
  const ranking = [game.winnerId!, ...[...game.bankruptcies].reverse()];
  const player = (id: string) => game.players.find((p) => p.id === id);

  async function choose(intent: 'REMATCH' | 'BACK_TO_LOBBY') {
    setError(await send(intent));
  }

  return (
    <main className="lobby">
      <h1>Game over</h1>
      <p>
        <strong>{player(game.winnerId!)?.name}</strong> wins!
      </p>
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
      {error && <p className="error">{error}</p>}
    </main>
  );
}
