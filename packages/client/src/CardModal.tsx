import { useState } from 'react';
import type { GameState, PartySelector } from '@landlord/engine';
import { continueCard } from './socket';

const usesChoice = (selector: PartySelector | undefined) => selector === 'drawerChoice';

/**
 * Shown to everyone while a card is revealed, which only the drawer continues, and while a manual
 * card waits for the Host to resolve it with Overrides and carry on.
 */
export function CardModal({ game, me, onHostTools }: { game: GameState; me: string; onHostTools: () => void }) {
  const [choice, setChoice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const turn = game.turn!;
  const card = turn.cards[turn.cards.length - 1];
  if (!card) return null;

  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? 'Someone';
  const manual = turn.step === 'awaitManual';
  const continuer = manual ? game.hostId : turn.playerId;
  const needsChoice = !manual && card.remaining.some((e) =>
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
            {manual && <p className="muted">Resolve this card with Host tools, then press Done.</p>}
            <div className="actions">
              {manual && (
                <button className="secondary" onClick={onHostTools}>
                  Host tools
                </button>
              )}
              <button disabled={needsChoice && !choice} onClick={proceed}>
                {manual ? 'Done' : 'Continue'}
              </button>
            </div>
          </>
        ) : (
          <p className="muted">
            {manual ? `Waiting for ${name(continuer)} (Host) to resolve this card…` : `Waiting for ${name(continuer)} to continue…`}
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
