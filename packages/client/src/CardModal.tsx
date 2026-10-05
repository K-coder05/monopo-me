import { useState } from 'react';
import type { GameState, PartySelector } from '@landlord/engine';
import { continueCard } from './socket';

const usesChoice = (selector: PartySelector | undefined) => selector === 'drawerChoice';

/** Shown to everyone while a card is revealed; only the drawer (or the Host, for a manual card) continues. */
export function CardModal({ game, me }: { game: GameState; me: string }) {
  const [choice, setChoice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const turn = game.turn!;
  const card = turn.cards[turn.cards.length - 1];
  if (!card) return null;

  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? 'Someone';
  const manual = card.remaining.some((e) => e.type === 'MANUAL');
  const continuer = manual ? game.hostId : turn.playerId;
  const needsChoice = card.remaining.some((e) =>
    e.type === 'TRANSFER' ? usesChoice(e.from) || usesChoice(e.to) : 'target' in e && usesChoice(e.target),
  );
  const options = game.players.filter((p) => !p.bankrupt);

  async function proceed() {
    setError(await continueCard(needsChoice ? choice : undefined));
  }

  return (
    <div className="backdrop">
      <div className="modal card" role="dialog" aria-label={card.title}>
        <p className="muted">
          {name(turn.playerId)} drew {card.deck === 'chance' ? 'Chance' : 'Treasure'}
        </p>
        <h2>{card.title}</h2>
        <p>{card.text}</p>
        {continuer === me ? (
          <>
            {needsChoice && (
              <label>
                Choose a Player{' '}
                <select value={choice} onChange={(e) => setChoice(e.target.value)}>
                  <option value="">Pick…</option>
                  {options.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="actions">
              <button disabled={needsChoice && !choice} onClick={proceed}>
                Continue
              </button>
            </div>
          </>
        ) : (
          <p className="muted">Waiting for {name(continuer)} to continue…</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
