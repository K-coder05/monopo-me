import { useState } from 'react';
import type { GameState } from '@landlord/engine';
import { send } from './socket';
import { RulesPanel } from './RulesPanel';
import { CardsPanel } from './CardsPanel';
import { PresetsPanel } from './PresetsPanel';
import { RoomMembers } from './RoomMembers';
import { LeaveButton } from './LeaveButton';

export function Lobby({ game, me, away }: { game: GameState; me: string; away: string[] }) {
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const link = `${location.origin}/?room=${game.roomCode}`;
  const isHost = me === game.hostId;
  const enough = game.players.length >= game.rules.minPlayers;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError('Could not copy; select the link and copy it by hand');
    }
  }

  return (
    <main className="lobby">
      <h1>Lobby</h1>
      <p>
        Room code <strong className="code">{game.roomCode}</strong>
      </p>
      <p className="share">
        <input readOnly value={link} aria-label="Share link" onFocus={(e) => e.target.select()} />
        <button onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
      </p>

      <h2>
        Players ({game.players.length}/{game.rules.maxPlayers})
      </h2>
      <RoomMembers game={game} me={me} away={away} />

      <p>
        <button type="button" className="secondary" onClick={() => setRulesOpen(true)}>
          Rules
        </button>{' '}
        <button type="button" className="secondary" onClick={() => setCardsOpen(true)}>
          Cards
        </button>
        {isHost && (
          <>
            {' '}
            <button type="button" className="secondary" onClick={() => setPresetsOpen(true)}>
              Presets
            </button>
          </>
        )}
      </p>
      {rulesOpen && <RulesPanel game={game} me={me} onClose={() => setRulesOpen(false)} />}
      {cardsOpen && <CardsPanel game={game} me={me} onClose={() => setCardsOpen(false)} />}
      {presetsOpen && <PresetsPanel game={game} onClose={() => setPresetsOpen(false)} />}

      {isHost ? (
        <button
          onClick={async () => setError(await send('START_GAME'))}
          disabled={!enough}
          title={enough ? undefined : `Needs at least ${game.rules.minPlayers} Players`}
        >
          Start game
        </button>
      ) : (
        <p>Waiting for the Host to start the game…</p>
      )}
      {error && <p className="error">{error}</p>}
      {!isHost && (
        <p>
          <LeaveButton game={game} me={me} />
        </p>
      )}
    </main>
  );
}
