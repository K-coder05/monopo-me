import { useEffect, useState } from 'react';
import type { GameState, RejoinKey } from '@landlord/engine';
import { clearRejoinKey, loadRejoinKey, saveRejoinKey, socket } from './socket';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { Game } from './Game';
import { GameOver } from './GameOver';

export function App() {
  const [joined, setJoined] = useState<RejoinKey | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  // Server clock minus this device's clock, for countdowns.
  const [clockOffset, setClockOffset] = useState(0);
  // Players with no open connection.
  const [away, setAway] = useState<string[]>([]);

  useEffect(() => {
    const onState = ({ state, serverNow, away }: { state: GameState; serverNow: number; away: string[] }) => {
      setGame(state);
      setAway(away);
      setClockOffset(serverNow - Date.now());
    };
    // On every (re)connect, take our Player back if this browser holds a RejoinKey. A refused token
    // means the Room is gone or the token is stale, so forget it.
    const rejoin = () => {
      const session = loadRejoinKey();
      if (!session) return;
      socket.emit('REJOIN_ROOM', { roomCode: session.roomCode, token: session.token }, (result) => {
        if (result.ok) setJoined(session);
        else if (result.error === 'Could not rejoin that Room') clearRejoinKey();
      });
    };
    socket.on('STATE', onState);
    socket.on('connect', rejoin);
    if (socket.connected) rejoin();
    return () => {
      socket.off('STATE', onState);
      socket.off('connect', rejoin);
    };
  }, []);

  if (!joined || !game) {
    return (
      <Home
        onJoined={(session) => {
          saveRejoinKey(session);
          setJoined(session);
        }}
      />
    );
  }
  if (game.phase === 'lobby') return <Lobby game={game} me={joined.playerId} away={away} />;
  if (game.phase === 'finished') return <GameOver game={game} me={joined.playerId} />;
  return <Game game={game} me={joined.playerId} clockOffset={clockOffset} away={away} />;
}
