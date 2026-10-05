import { useEffect, useState } from 'react';
import type { Auction, GameState } from '@landlord/engine';
import { placeBid, send } from './socket';

const RAISES = [1, 10, 50, 100];

/** Seconds left until `endsAt` on the server clock, re-rendering as it counts down. */
function useSecondsLeft(endsAt: number, clockOffset: number): number {
  const left = () => Math.max(0, Math.ceil((endsAt - (Date.now() + clockOffset)) / 1000));
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    const id = setInterval(() => setSeconds(left()), 250);
    return () => clearInterval(id);
  }, [endsAt, clockOffset]);
  return seconds;
}

/** Shown to everyone while an Auction is open. The server runs the countdown; this only displays it. */
export function AuctionModal({
  game,
  auction,
  me,
  clockOffset,
}: {
  game: GameState;
  auction: Auction;
  me: string;
  clockOffset: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const seconds = useSecondsLeft(auction.endsAt, clockOffset);
  const space = game.board[auction.index]!;
  const { highBid } = auction;
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? 'Someone';
  const cash = game.players.find((p) => p.id === me)?.cash ?? 0;
  const inAuction = auction.bidders.includes(me);
  const leading = highBid?.playerId === me;
  // With no bid yet, +1 bids exactly the starting bid.
  const base = highBid?.amount ?? game.rules.auctionStartBid - 1;

  return (
    <div className="backdrop">
      <div className="modal auction" role="dialog" aria-label={`Auction: ${space.name}`}>
        <h2>Auction: {space.name}</h2>
        <p className="countdown" aria-live="polite">
          {game.paused ? 'Paused' : `${seconds}s`}
        </p>
        <p>
          {highBid ? (
            <>
              Current bid <strong>{highBid.amount}</strong> by {highBid.playerId === me ? 'you' : name(highBid.playerId)}
            </>
          ) : (
            <>No bids yet. Bidding starts at {game.rules.auctionStartBid}.</>
          )}
        </p>
        <p className="muted">
          List price {space.price}. You have {cash}.
        </p>

        {inAuction ? (
          <>
            <div className="raises">
              {RAISES.map((raise) => (
                <button
                  key={raise}
                  disabled={leading || base + raise > cash}
                  onClick={async () => setError(await placeBid(base + raise))}
                >
                  +{raise}
                </button>
              ))}
            </div>
            <button className="secondary" disabled={leading} onClick={async () => setError(await send('PASS_AUCTION'))}>
              Pass
            </button>
            {leading && <p className="muted">You have the highest bid.</p>}
          </>
        ) : (
          <p className="muted">You passed and are out of this Auction.</p>
        )}
        <p className="muted">Still in: {auction.bidders.map(name).join(', ')}</p>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
