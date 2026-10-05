import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState, SpaceDefinition } from '@landlord/engine';
import { send, type Intent } from './socket';
import { Board } from './Board';
import { describeEvent } from './describeEvent';
import { TitleDeed } from './TitleDeed';
import { AuctionModal } from './AuctionModal';
import { groupColor } from './spaces';

/** Spaces grouped by Colour group (stations and utilities form their own groups), in Board order. */
function byGroup(spaces: SpaceDefinition[]): [string, SpaceDefinition[]][] {
  const groups = new Map<string, SpaceDefinition[]>();
  for (const s of spaces) {
    const key = s.group ?? s.type;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups];
}

export function Game({ game, me, clockOffset }: { game: GameState; me: string; clockOffset: number }) {
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const closeDeed = useCallback(() => setSelected(null), []);
  const turn = game.turn!;
  const myTurn = turn.playerId === me;
  const logEnd = useRef<HTMLLIElement>(null);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [game.log.length]);

  async function act(intent: Intent) {
    setError(await send(intent));
  }

  const ownedBy = (playerId: string) =>
    game.board.filter((s) => game.deeds[s.index]?.ownerId === playerId);
  const myself = game.players.find((p) => p.id === me);
  const offered = myTurn && turn.step === 'awaitBuyDecision' ? game.board[myself?.position ?? 0] : undefined;

  return (
    <main className="game">
      <Board game={game} onSelect={setSelected} />

      <aside className="side">
        <ul className="strip">
          {game.players.map((p) => (
            <li key={p.id} className={p.id === turn.playerId ? 'active' : ''}>
              <span className="token" style={{ background: p.color }} />
              <span className="pname">
                {p.name}
                {p.id === me && ' (you)'}
              </span>
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
          <button disabled={!myTurn || turn.step !== 'awaitEndTurn'} onClick={() => act('END_TURN')}>
            End turn
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
                {spaces.map((s) => (
                  <li key={s.index}>
                    <button type="button" className="link" onClick={() => setSelected(s.index)}>
                      {s.name}
                      {game.deeds[s.index]?.mortgaged && ' (mortgaged)'}
                    </button>
                  </li>
                ))}
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

      {selected !== null && <TitleDeed game={game} index={selected} onClose={closeDeed} />}
    </main>
  );
}
