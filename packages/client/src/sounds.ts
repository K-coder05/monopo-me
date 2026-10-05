import type { Sound } from './playback';

/** A note: frequency in Hz, start and length in seconds from when the sound plays. */
type Note = { freq: number; at: number; length: number; wave?: OscillatorType; volume?: number };

// Short synthesized cues, so the game ships no audio files.
const SOUNDS: Record<Sound, Note[]> = {
  dice: [0, 0.0625, 0.125, 0.2, 0.2875].map((at, i) => ({ freq: 180 + ((i * 97) % 160), at, length: 0.04, wave: 'square', volume: 0.08 })),
  step: [{ freq: 660, at: 0, length: 0.04, wave: 'triangle', volume: 0.12 }],
  cash: [
    { freq: 988, at: 0, length: 0.08 },
    { freq: 1319, at: 0.08, length: 0.18 },
  ],
  pay: [
    { freq: 523, at: 0, length: 0.1 },
    { freq: 392, at: 0.1, length: 0.18 },
  ],
  card: [{ freq: 740, at: 0, length: 0.12, wave: 'sawtooth', volume: 0.06 }],
  jail: [
    { freq: 220, at: 0, length: 0.18, wave: 'square', volume: 0.1 },
    { freq: 165, at: 0.2, length: 0.3, wave: 'square', volume: 0.1 },
  ],
  yourTurn: [
    { freq: 784, at: 0, length: 0.1 },
    { freq: 1047, at: 0.1, length: 0.2 },
  ],
  fanfare: [
    { freq: 523, at: 0, length: 0.14 },
    { freq: 659, at: 0.14, length: 0.14 },
    { freq: 784, at: 0.28, length: 0.14 },
    { freq: 1047, at: 0.42, length: 0.4 },
  ],
};

let context: AudioContext | null = null;

/** Plays a sound effect. Browsers block audio until the page has been tapped once; until then this is silent. */
export function playSound(sound: Sound) {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const start = context.currentTime;
    for (const note of SOUNDS[sound]) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = note.wave ?? 'sine';
      osc.frequency.value = note.freq;
      const volume = note.volume ?? 0.15;
      gain.gain.setValueAtTime(volume, start + note.at);
      gain.gain.exponentialRampToValueAtTime(0.001, start + note.at + note.length);
      osc.connect(gain).connect(context.destination);
      osc.start(start + note.at);
      osc.stop(start + note.at + note.length);
    }
  } catch {
    // No Web Audio here: play on in silence.
  }
}
