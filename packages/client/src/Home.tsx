import { useState, type FormEvent } from 'react';
import { MAX_NAME_LENGTH, ROOM_CODE_LENGTH, TOKEN_COLORS, type Ack, type JoinedRoom } from '@landlord/engine';
import { socket } from './socket';

export function Home({ onJoined }: { onJoined: (joined: JoinedRoom) => void }) {
  const linkedCode = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(TOKEN_COLORS[0]);
  const [code, setCode] = useState(linkedCode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reply: Ack<JoinedRoom> = (result) => {
    setBusy(false);
    if (result.ok) onJoined({ roomCode: result.roomCode, playerId: result.playerId });
    else setError(result.error);
  };

  function create() {
    setBusy(true);
    setError(null);
    socket.emit('CREATE_ROOM', { name, color }, reply);
  }

  function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    socket.emit('JOIN_ROOM', { roomCode: code, name, color }, reply);
  }

  const nameOk = name.trim().length > 0;

  return (
    <main className="home">
      <h1>Landlord</h1>

      <label>
        Your name
        <input value={name} maxLength={MAX_NAME_LENGTH} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>

      <fieldset className="colors">
        <legend>Token colour</legend>
        {TOKEN_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={c === color ? 'swatch selected' : 'swatch'}
            style={{ background: c }}
            aria-label={`Colour ${c}`}
            aria-pressed={c === color}
            onClick={() => setColor(c)}
          />
        ))}
      </fieldset>

      <form onSubmit={join} className="join">
        <input
          placeholder="Room code"
          value={code}
          maxLength={ROOM_CODE_LENGTH}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          aria-label="Room code"
        />
        <button type="submit" disabled={busy || !nameOk || code.length !== ROOM_CODE_LENGTH}>
          Join room
        </button>
      </form>

      {!linkedCode && (
        <>
          <p className="or">or</p>
          <button onClick={create} disabled={busy || !nameOk}>
            Create a new room
          </button>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  );
}
