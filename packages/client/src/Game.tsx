import { useEffect, useRef, useState } from 'react';
import type { GameState } from '@landlord/engine';
import { send } from './socket';
import { Board } from './Board';
import { describeEvent } from './describeEvent';

export function Game({ game, me }: { game: GameState; me: string }) {
  const [error, setError] = useState<string | null>(null);
  const turn = game.turn!;
  const myTurn = turn.playerId === me;
  const logEnd = useRef<HTMLLIElement>(null);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [game.log.length]);

  async function act(intent: 'ROLL_DICE' | 'END_TURN') {
    setError(await send(intent));
  }

  return (
    <main className="game">
      <Board game={game} />

      <aside className="side">
        <ul className="strip">
          {game.players.map((p) => (
            <li key={p.id} className={p.id === turn.playerId ? 'active' : ''}>
              <span className="token" style={{ background: p.color }} />
              <span className="pname">
                {p.name}
                {p.id === me && ' (you)'}
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

        <ol className="log" aria-label="Game log">
          {game.log.map((entry) => (
            <li key={entry.seq}>{describeEvent(entry.event, game)}</li>
          ))}
          <li ref={logEnd} aria-hidden />
        </ol>
      </aside>
    </main>
  );
}
