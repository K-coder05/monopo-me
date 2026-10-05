import { useState } from 'react';
import type { GameState } from '@landlord/engine';
import { addPlayer, kick, transferHost } from './socket';

/**
 * Everyone in the Room: the Players, then the Spectators. The Host gets per-person controls to
 * hand on the Host role, add a Spectator as a Player, or kick (after confirming).
 */
export function RoomMembers({ game, me, away }: { game: GameState; me: string; away: string[] }) {
  const [error, setError] = useState<string | null>(null);
  const [kicking, setKicking] = useState<string | null>(null);
  const isHost = me === game.hostId;
  const midGame = game.phase === 'playing';

  async function run(request: Promise<string | null>) {
    setKicking(null);
    setError(await request);
  }

  const kickControls = (id: string, name: string) =>
    kicking === id ? (
      <>
        <button className="small" onClick={() => run(kick(id))}>
          Kick {name}
          {midGame && game.players.some((p) => p.id === id) ? ' (goes bankrupt)' : ''}
        </button>
        <button className="small secondary" onClick={() => setKicking(null)}>
          Cancel
        </button>
      </>
    ) : (
      <button className="small secondary" onClick={() => setKicking(id)}>
        Kick
      </button>
    );

  return (
    <>
      <ul className="players">
        {game.players.map((p) => (
          <li key={p.id}>
            <span className="token" style={{ background: p.color }} />
            {p.name}
            {p.id === game.hostId && <em> (Host)</em>}
            {p.bankrupt && <em className="muted"> (bankrupt)</em>}
            {away.includes(p.id) && <em className="muted"> (away)</em>}
            {p.id === me && <em> (you)</em>}
            {isHost && p.id !== me && (
              <span className="build">
                {!(midGame && p.bankrupt) && (
                  <button className="small secondary" onClick={() => run(transferHost(p.id))}>
                    Make Host
                  </button>
                )}
                {!(midGame && p.bankrupt) && kickControls(p.id, p.name)}
              </span>
            )}
          </li>
        ))}
      </ul>
      {game.spectators.length > 0 && (
        <>
          <h3>Spectators</h3>
          <ul className="players">
            {game.spectators.map((s) => (
              <li key={s.id}>
                <span className="token" style={{ background: s.color }} />
                {s.name}
                {s.id === me && <em> (you)</em>}
                {isHost && (
                  <span className="build">
                    {game.phase !== 'finished' && (
                      <button
                        className="small"
                        disabled={game.players.length >= game.rules.maxPlayers}
                        title={midGame ? `Joins on GO with ${game.rules.startingCash}, last in turn order, from next round` : undefined}
                        onClick={() => run(addPlayer(s.id))}
                      >
                        Add as Player
                      </button>
                    )}
                    {kickControls(s.id, s.name)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}
