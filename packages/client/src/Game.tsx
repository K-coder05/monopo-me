import { useCallback, useEffect, useRef, useState } from 'react';
import {
  colourGroup,
  groupHasBuildings,
  HOTEL,
  mortgageValue,
  unmortgageCost,
  type GameState,
  type PropertyIntent,
  type SpaceDefinition,
} from '@landlord/engine';
import { send, sendPropertyAction, type Intent } from './socket';
import { Board } from './Board';
import { describeEvent } from './describeEvent';
import { TitleDeed } from './TitleDeed';
import { AuctionModal } from './AuctionModal';
import { CardModal } from './CardModal';
import { DebtModal } from './DebtModal';
import { TradeModal, tradePartners } from './TradeModal';
import { describeBuildings, groupColor } from './spaces';

/** Spaces grouped by Colour group (stations and utilities form their own groups), in Board order. */
function byGroup(spaces: SpaceDefinition[]): [string, SpaceDefinition[]][] {
  const groups = new Map<string, SpaceDefinition[]>();
  for (const s of spaces) {
    const key = s.group ?? s.type;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups];
}

export function Game({ game, me, clockOffset, away }: { game: GameState; me: string; clockOffset: number; away: string[] }) {
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [building, setBuilding] = useState(false);
  const closeDeed = useCallback(() => setSelected(null), []);
  const closeBuilder = useCallback(() => setBuilding(false), []);
  const turn = game.turn!;
  const myTurn = turn.playerId === me;
  const logEnd = useRef<HTMLLIElement>(null);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [game.log.length]);

  async function act(intent: Intent) {
    setError(await send(intent));
  }

  async function actOnProperty(intent: PropertyIntent, index: number) {
    setError(await sendPropertyAction(intent, index));
  }

  const ownedBy = (playerId: string) =>
    game.board.filter((s) => game.deeds[s.index]?.ownerId === playerId);
  const myself = game.players.find((p) => p.id === me);
  const offered = myTurn && turn.step === 'awaitBuyDecision' ? game.board[myself?.position ?? 0] : undefined;
  // The engine enforces the rest (even building, cash, bank stock) and explains any refusal.
  const owesDebt = turn.step === 'awaitDebt' && game.debts[0]?.debtorId === me;
  const canManageProperties = myTurn && (turn.step === 'awaitRoll' || turn.step === 'awaitEndTurn');
  // While paying a Debt, selling and mortgaging are open whoever's turn it is; building is not.
  const canSell = canManageProperties || owesDebt;
  const holdsGroup = (s: SpaceDefinition) => colourGroup(game.board, s.group).every((g) => game.deeds[g.index]?.ownerId === me);
  const canPayFine =
    myTurn && turn.step === 'awaitRoll' && !!myself?.inJail && myself.cash >= game.rules.jailFine;
  const canUseJailCard = myTurn && turn.step === 'awaitRoll' && !!myself?.inJail && myself.heldCards.length > 0;

  return (
    <main className="game">
      <Board game={game} onSelect={setSelected} />

      <aside className="side">
        <ul className="strip">
          {game.players.map((p) => (
            <li key={p.id} className={p.bankrupt ? 'bankrupt' : p.id === turn.playerId ? 'active' : ''}>
              <span className="token" style={{ background: p.color }} />
              <span className="pname">
                {p.name}
                {p.id === me && ' (you)'}
              </span>
              {away.includes(p.id) && (
                <span className="away" title="Not connected right now">
                  Away
                </span>
              )}
              {p.heldCards.length > 0 && (
                <span className="muted" title="Get-out-of-jail cards held">
                  {p.heldCards.length} jail card{p.heldCards.length > 1 ? 's' : ''}
                </span>
              )}
              {p.inJail && (
                <span className="jailed" title={`Failed rolls: ${p.jailTurns} of ${game.rules.maxJailTurns}`}>
                  In Jail
                </span>
              )}
              <span className="owned" title="Properties owned">
                {ownedBy(p.id).length} owned
              </span>
              <span className="cash">{p.cash}</span>
            </li>
          ))}
        </ul>

        <div className="actions">
          <button disabled={!myTurn || turn.step !== 'awaitRoll'} onClick={() => act('ROLL_DICE')}>
            Roll
          </button>
          <button disabled={!canPayFine} onClick={() => act('PAY_JAIL_FINE')}>
            Pay fine ({game.rules.jailFine})
          </button>
          <button disabled={!canUseJailCard} onClick={() => act('USE_JAIL_CARD')}>
            Use jail card
          </button>
          <button disabled={!myTurn || turn.step !== 'awaitEndTurn'} onClick={() => act('END_TURN')}>
            End turn
          </button>
          <button
            className="secondary"
            disabled={!game.rules.tradingEnabled || !!game.trade || !!myself?.bankrupt || tradePartners(game, me).length === 0}
            onClick={() => setBuilding(true)}
          >
            Trade
          </button>
        </div>
        {error && <p className="error">{error}</p>}

        <section className="mine" aria-label="My properties">
          <h3>My properties</h3>
          {ownedBy(me).length === 0 ? (
            <p className="muted">None yet</p>
          ) : (
            byGroup(ownedBy(me)).map(([group, spaces]) => (
              <ul key={group} style={{ borderLeftColor: groupColor(group) }}>
                {spaces.map((s) => {
                  const buildings = game.deeds[s.index]?.buildings ?? 0;
                  const mortgaged = !!game.deeds[s.index]?.mortgaged;
                  return (
                    <li key={s.index}>
                      <button type="button" className="link" onClick={() => setSelected(s.index)}>
                        {s.name}
                        {mortgaged && ' (mortgaged)'}
                      </button>
                      {buildings > 0 && (
                        <span className="muted"> · {describeBuildings(buildings)}</span>
                      )}
                      <span className="build">
                        {s.type === 'street' && (holdsGroup(s) || buildings > 0) && (
                          <>
                            <button
                              className="small"
                              disabled={!canManageProperties || buildings === HOTEL}
                              onClick={() => actOnProperty('BUILD', s.index)}
                            >
                              Build ({s.houseCost})
                            </button>
                            <button
                              className="small secondary"
                              disabled={!canSell || buildings === 0}
                              onClick={() => actOnProperty('SELL_BUILDING', s.index)}
                            >
                              Sell
                            </button>
                          </>
                        )}
                        {mortgaged ? (
                          <button
                            className="small secondary"
                            disabled={!canManageProperties}
                            onClick={() => actOnProperty('UNMORTGAGE', s.index)}
                          >
                            Unmortgage ({unmortgageCost(s, game.rules)})
                          </button>
                        ) : (
                          <button
                            className="small secondary"
                            disabled={!canSell || groupHasBuildings(game, s)}
                            onClick={() => actOnProperty('MORTGAGE', s.index)}
                          >
                            Mortgage ({mortgageValue(s, game.rules)})
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ))
          )}
        </section>

        <ol className="log" aria-label="Game log">
          {game.log.map((entry) => (
            <li key={entry.seq}>{describeEvent(entry.event, game)}</li>
          ))}
          <li ref={logEnd} aria-hidden />
        </ol>
      </aside>

      {offered && selected === null && (
        <div className="backdrop">
          <div className="modal" role="dialog" aria-label={`Buy ${offered.name}?`}>
            <h2>Buy {offered.name}?</h2>
            <p>
              List price {offered.price}. You have {myself?.cash}.
            </p>
            <div className="actions">
              <button disabled={(myself?.cash ?? 0) < (offered.price ?? 0)} onClick={() => act('BUY_PROPERTY')}>
                Buy for {offered.price}
              </button>
              <button className="secondary" onClick={() => act('DECLINE_PROPERTY')}>
                Decline
              </button>
            </div>
            <button type="button" className="link" onClick={() => setSelected(offered.index)}>
              View title deed
            </button>
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      )}

      {/* Stays up under an open title deed so nobody loses the countdown while checking the property. */}
      {game.auction && <AuctionModal game={game} auction={game.auction} me={me} clockOffset={clockOffset} />}

      {game.turn?.step === 'awaitDebt' && <DebtModal game={game} me={me} onTrade={() => setBuilding(true)} />}

      {/* After the Debt modal so a debtor's builder opens on top of it. Keyed so each offer starts a fresh builder. */}
      {(building || game.trade) && (
        <TradeModal
          key={`${building}-${JSON.stringify(game.trade ?? null)}`}
          game={game}
          me={me}
          building={building}
          onBuild={() => setBuilding(true)}
          onClose={closeBuilder}
        />
      )}

      {game.turn?.step === 'awaitCard' && <CardModal game={game} me={me} />}

      {selected !== null && <TitleDeed game={game} index={selected} onClose={closeDeed} />}
    </main>
  );
}
