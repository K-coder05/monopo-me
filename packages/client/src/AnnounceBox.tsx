import { useState } from 'react';
import { MAX_ANNOUNCEMENT_LENGTH } from '@landlord/engine';
import { announce } from './socket';

/**
 * Host only: an empty box for telling everyone what changed, if anything. Host changes are never
 * announced on their own (see hiddenEdits), so this is the only way Players hear of them.
 */
export function AnnounceBox() {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const problem = await announce(text);
    setError(problem);
    if (!problem) setText('');
  }

  return (
    <div className="announce-box">
      <textarea
        aria-label="Announcement to everyone"
        placeholder="Announce something to everyone (optional)"
        maxLength={MAX_ANNOUNCEMENT_LENGTH}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="secondary" disabled={text.trim() === ''} onClick={submit}>
        Announce
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
