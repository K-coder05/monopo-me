import { setMusicMuted, setMusicVolume, useMusic } from './music';

/** Mute button and volume slider for the background music, pinned to a corner of every screen. */
export function MusicControls() {
  const { muted, volume } = useMusic();
  return (
    <div className="music-controls">
      <button
        className="secondary"
        onClick={() => setMusicMuted(!muted)}
        aria-label={muted ? 'Unmute music' : 'Mute music'}
        aria-pressed={muted}
        title={muted ? 'Unmute music' : 'Mute music'}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
          {muted ? (
            <path d="m16 9 6 6m0-6-6 6" />
          ) : (
            <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
          )}
        </svg>
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        onChange={(e) => setMusicVolume(Number(e.target.value))}
        aria-label="Music volume"
      />
    </div>
  );
}
