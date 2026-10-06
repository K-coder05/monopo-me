import { useSyncExternalStore } from 'react';
import track from '../../../assets/audio/background.mp3';

/** Where this browser keeps its music settings. Per Player: never synced or set by the Host. */
const KEYS = { muted: 'landlord.music.muted', volume: 'landlord.music.volume' } as const;
const DEFAULT_VOLUME = 0.3;

export type MusicSettings = { muted: boolean; volume: number };

function load(): MusicSettings {
  try {
    const volume = Number(localStorage.getItem(KEYS.volume));
    return {
      muted: localStorage.getItem(KEYS.muted) === 'true',
      volume: localStorage.getItem(KEYS.volume) !== null && volume >= 0 && volume <= 1 ? volume : DEFAULT_VOLUME,
    };
  } catch {
    return { muted: false, volume: DEFAULT_VOLUME };
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the setting lasts until the page closes.
  }
}

let settings = load();
// Browsers block autoplay, so the music waits for the first tap or key press.
let unlocked = false;
let audio: HTMLAudioElement | null = null;
const listeners = new Set<() => void>();

/** Plays when the page has been interacted with, is unmuted and is in view; pauses otherwise. */
function sync() {
  if (!audio) {
    if (!unlocked) return;
    audio = new Audio(track);
    audio.loop = true;
  }
  audio.volume = settings.volume;
  if (unlocked && !settings.muted && document.visibilityState === 'visible') void audio.play().catch(() => {});
  else audio.pause();
}

function update(next: Partial<MusicSettings>) {
  settings = { ...settings, ...next };
  listeners.forEach((l) => l());
  sync();
}

export function setMusicMuted(muted: boolean) {
  save(KEYS.muted, String(muted));
  update({ muted });
}

export function setMusicVolume(volume: number) {
  save(KEYS.volume, String(volume));
  update({ volume });
}

/** This browser's music settings, re-rendering when they change. */
export function useMusic(): MusicSettings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => settings,
  );
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    unlocked = true;
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    sync();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', sync);
}
