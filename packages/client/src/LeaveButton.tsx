import { useState } from 'react';
import type { GameState } from '@landlord/engine';
import { send } from './socket';

/**
 * Leaves the Room for good, after a confirm. Mid-game a Player goes bankrupt to the bank. The Host
 * must hand on the role first, so they do not get the button.
 */
export function LeaveButton({ game, me }: { game: GameState; me: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (me === game.hostId) return null;
  const goesBankrupt = game.phase === 'playing' && game.players.some((p) => p.id === me && !p.bankrupt);

  return (
    <>
      {confirming ? (
        <>
          <button onClick={async () => setError(await send('LEAVE_ROOM'))}>
            {goesBankrupt ? 'Leave and go bankrupt' : 'Leave the Room'}
          </button>{' '}
          <button className="secondary" onClick={() => setConfirming(false)}>
            Stay
          </button>
        </>
      ) : (
        <button className="secondary" onClick={() => setConfirming(true)}>
          Leave
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}
