import { useEffect, useState } from 'react';
import type { GameEvent, GameState, RejoinKey } from '@landlord/engine';
import { clearRejoinKey, loadRejoinKey, saveRejoinKey, socket } from './socket';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { Game } from './Game';
import { GameOver } from './GameOver';
import { MusicControls } from './MusicControls';
import { describeEvent } from './describeEvent';
import { playSound } from './sounds';
import { PREFERENCE_KEYS, readPreference } from './usePreference';

const TOAST_MS = 6000;
// Rules and Board changes are kept from every Player, so only card edits get a toast.
const HOST_EDITS: GameEvent['type'][] = [
  'CARD_ADDED',
  'CARD_EDITED',
  'CARD_COPIES_CHANGED',
  'CARD_ENABLED_CHANGED',
  'CARD_DELETED',
  'HELD_CARD_REMOVED',
  'DECK_RESET',
  'DECK_SHUFFLED',
  'DECK_CONTENTS_HIDDEN',
];
const isHostEdit = (e: GameEvent) => HOST_EDITS.includes(e.type);

let nextToastId = 0;

export function App() {
  const [joined, setJoined] = useState<RejoinKey | null>(null);
  // Why this browser is back on the Home screen, after leaving or being kicked.
  const [notice, setNotice] = useState<string | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  // Server clock minus this device's clock, for countdowns.
  const [clockOffset, setClockOffset] = useState(0);
  // Players with no open connection.
  const [away, setAway] = useState<string[]>([]);
  // Card changes, shown to everyone for a few seconds.
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);

  useEffect(() => {
    const onState = ({ state, events, serverNow, away }: { state: GameState; events: GameEvent[]; serverNow: number; away: string[] }) => {
      setGame(state);
      // The Game screen (and its sounds) gives way to Game Over in this same update, so cheer here.
      if (events.some((e) => e.type === 'GAME_OVER') && readPreference(PREFERENCE_KEYS.sound, true)) playSound('fanfare');
      const fresh = events.filter(isHostEdit).map((e) => ({ id: nextToastId++, text: describeEvent(e, state) }));
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
    // Left or kicked: the stored token no longer works, so start afresh.
    const onRemoved = ({ kicked }: { kicked: boolean }) => {
      clearRejoinKey();
      setJoined(null);
      setGame(null);
      setNotice(kicked ? 'The Host removed you from the Room.' : 'You left the Room.');
    };
    socket.on('STATE', onState);
    socket.on('REMOVED', onRemoved);
    socket.on('connect', rejoin);
    if (socket.connected) rejoin();
    return () => {
      socket.off('STATE', onState);
      socket.off('REMOVED', onRemoved);
      socket.off('connect', rejoin);
    };
  }, []);

  if (!joined || !game) {
    return (
      <>
        <Home
          notice={notice}
          onJoined={(session) => {
            saveRejoinKey(session);
            setNotice(null);
            setJoined(session);
          }}
        />
        <MusicControls />
      </>
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
      <MusicControls />
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
