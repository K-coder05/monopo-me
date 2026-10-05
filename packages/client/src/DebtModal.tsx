import { useState } from 'react';
import { groupHasBuildings, mortgageValue, type GameState } from '@landlord/engine';
import { send, sendPropertyAction } from './socket';

/** Shown to everyone while a Debt blocks play; only the debtor gets the controls. */
export function DebtModal({ game, me, onTrade }: { game: GameState; me: string; onTrade: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const debt = game.debts[0];
  if (!debt) return null;

  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? 'Someone';
  const creditor = debt.creditor.type === 'bank' ? 'the bank' : name(debt.creditor.playerId);

  if (debt.debtorId !== me) {
    return (
      <div className="backdrop">
        <div className="modal" role="dialog" aria-label="Debt">
          <h2>{name(debt.debtorId)} owes a Debt</h2>
          <p>
            {debt.amount} to {creditor}. Waiting for them to sell, mortgage or go bankrupt.
          </p>
        </div>
      </div>
    );
  }

  const cash = game.players.find((p) => p.id === me)?.cash ?? 0;
  const short = debt.amount - cash;
  const mine = game.board.filter((s) => game.deeds[s.index]?.ownerId === me);

  async function run(action: Promise<string | null>) {
    setError(await action);
  }

  return (
    <div className="backdrop">
      <div className="modal debt" role="dialog" aria-label="Debt">
        <h2>
          You owe {debt.amount} to {creditor}
        </h2>
        <p>
          You have {cash}.{' '}
          {short > 0 ? `Sell buildings or mortgage until you have ${short} more.` : 'You can pay now.'}
        </p>
        <ul className="debt-assets">
          {mine.map((s) => {
            const deed = game.deeds[s.index]!;
            return (
              <li key={s.index}>
                <span>
                  {s.name}
                  {deed.mortgaged && ' (mortgaged)'}
                </span>
                <span className="build">
                  {deed.buildings > 0 && (
                    <button className="small secondary" onClick={() => run(sendPropertyAction('SELL_BUILDING', s.index))}>
                      Sell building
                    </button>
                  )}
                  {!deed.mortgaged && (
                    <button
                      className="small secondary"
                      disabled={groupHasBuildings(game, s)}
                      onClick={() => run(sendPropertyAction('MORTGAGE', s.index))}
                    >
                      Mortgage ({mortgageValue(s, game.rules)})
                    </button>
                  )}
                </span>
              </li>
            );
          })}
          {mine.length === 0 && <li className="muted">You own nothing to sell</li>}
        </ul>
        <div className="actions">
          <button disabled={short > 0} onClick={() => run(send('PAY_DEBT'))}>
            Pay {debt.amount}
          </button>
          <button className="secondary" disabled={!game.rules.tradingEnabled || !!game.trade} onClick={onTrade}>
            Trade
          </button>
          <button className="danger" disabled={short <= 0} onClick={() => run(send('DECLARE_BANKRUPTCY'))}>
            Declare Bankruptcy
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
