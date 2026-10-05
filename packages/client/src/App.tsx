import { useEffect, useState } from 'react';
import type { GameEvent, GameState, RejoinKey } from '@landlord/engine';
import { clearRejoinKey, loadRejoinKey, saveRejoinKey, socket } from './socket';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { Game } from './Game';
import { GameOver } from './GameOver';
import { describeEvent } from './describeEvent';

const TOAST_MS = 6000;
const HOST_EDITS: GameEvent['type'][] = [
  'RULE_CHANGED',
  'SPACE_CHANGED',
  'DEFAULTS_RESTORED',
  'CHANGES_QUEUED',
  'CARD_ADDED',
  'CARD_EDITED',
  'CARD_COPIES_CHANGED',
  'CARD_ENABLED_CHANGED',
  'CARD_DELETED',
  'HELD_CARD_REMOVED',
  'DECK_RESET',
  'DECK_SHUFFLED',
  'DECK_CONTENTS_HIDDEN',
  'PRESET_LOADED',
  'PRESET_APPLIED',
];
const isHostEdit = (e: GameEvent) => HOST_EDITS.includes(e.type);

let nextToastId = 0;

export function App() {
  const [joined, setJoined] = useState<RejoinKey | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  // Server clock minus this device's clock, for countdowns.
  const [clockOffset, setClockOffset] = useState(0);
  // Players with no open connection.
  const [away, setAway] = useState<string[]>([]);
  // Rules, Board and card changes, shown to everyone for a few seconds.
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);

  useEffect(() => {
    const onState = ({ state, events, serverNow, away }: { state: GameState; events: GameEvent[]; serverNow: number; away: string[] }) => {
      setGame(state);
      // A reset or Preset load is one toast, not one per value it changed.
      const reset = events.some((e) => e.type === 'DEFAULTS_RESTORED' || e.type === 'PRESET_LOADED' || e.type === 'PRESET_APPLIED');
      const fresh = events.filter((e) => isHostEdit(e) && !(reset && (e.type === 'RULE_CHANGED' || e.type === 'SPACE_CHANGED'))).map((e) => ({ id: nextToastId++, text: describeEvent(e, state) }));
      if (fresh.length > 0) {
        setToasts((current) => [...current, ...fresh]);
        setTimeout(() => setToasts((current) => current.filter((t) => !fresh.some((f) => f.id === t.id))), TOAST_MS);
      }
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
  const screen =
    game.phase === 'lobby' ? (
      <Lobby game={game} me={joined.playerId} away={away} />
    ) : game.phase === 'finished' ? (
      <GameOver game={game} me={joined.playerId} />
    ) : (
      <Game game={game} me={joined.playerId} clockOffset={clockOffset} away={away} />
    );
  return (
    <>
      {screen}
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
