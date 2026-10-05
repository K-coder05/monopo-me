import { useState } from 'react';
import type { GameState } from '@landlord/engine';
import { send } from './socket';

export function Lobby({ game, me, away }: { game: GameState; me: string; away: string[] }) {
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/?room=${game.roomCode}`;
  const isHost = me === game.hostId;
  const enough = game.players.length >= game.rules.minPlayers;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError('Could not copy; select the link and copy it by hand');
    }
  }

  return (
    <main className="lobby">
      <h1>Lobby</h1>
      <p>
        Room code <strong className="code">{game.roomCode}</strong>
      </p>
      <p className="share">
        <input readOnly value={link} aria-label="Share link" onFocus={(e) => e.target.select()} />
        <button onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
      </p>

      <h2>
        Players ({game.players.length}/{game.rules.maxPlayers})
      </h2>
      <ul className="players">
        {game.players.map((p) => (
          <li key={p.id}>
            <span className="token" style={{ background: p.color }} />
            {p.name}
            {p.id === game.hostId && <em> (Host)</em>}
            {away.includes(p.id) && <em className="muted"> (away)</em>}
            {p.id === me && <em> (you)</em>}
          </li>
        ))}
      </ul>

      {isHost ? (
        <button
          onClick={async () => setError(await send('START_GAME'))}
          disabled={!enough}
          title={enough ? undefined : `Needs at least ${game.rules.minPlayers} Players`}
        >
          Start game
        </button>
      ) : (
        <p>Waiting for the Host to start the game…</p>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
