import { useState } from 'react';

/** Where this browser keeps each preference. */
export const PREFERENCE_KEYS = { animate: 'landlord.animate', sound: 'landlord.sound' } as const;

/** A true/false preference this browser remembers, or `initial` when it has none (or no storage). */
export function readPreference(key: string, initial: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? initial : stored === 'true';
  } catch {
    return initial;
  }
}

/** A true/false preference this browser remembers, such as muting sound. Works without storage, just unremembered. */
export function usePreference(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => readPreference(key, initial));
  const set = (next: boolean) => {
    setValue(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      // Storage blocked: the setting lasts until the page closes.
    }
  };
  return [value, set];
}
