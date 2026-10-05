import { useEffect, useState } from 'react';
import type { GameState, JoinedRoom } from '@landlord/engine';
import { socket } from './socket';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { Game } from './Game';

export function App() {
  const [joined, setJoined] = useState<JoinedRoom | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  // Server clock minus this device's clock, for countdowns.
  const [clockOffset, setClockOffset] = useState(0);

  useEffect(() => {
    const onState = ({ state, serverNow }: { state: GameState; serverNow: number }) => {
      setGame(state);
      setClockOffset(serverNow - Date.now());
    };
    socket.on('STATE', onState);
    return () => {
      socket.off('STATE', onState);
    };
  }, []);

  if (!joined || !game) return <Home onJoined={setJoined} />;
  if (game.phase === 'lobby') return <Lobby game={game} me={joined.playerId} />;
  return <Game game={game} me={joined.playerId} clockOffset={clockOffset} />;
}
