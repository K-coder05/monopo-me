import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IllegalActionError, validPreset, type Preset } from '@landlord/engine';

/** Names match ignoring case and surrounding spaces. */
const keyOf = (name: string) => name.trim().toLowerCase();

/**
 * Saved Presets, shared by every Room, kept in memory and as one JSON file each in `dir` (no saving
 * without a `dir`). Every Preset is validated on the way in, including those read from disk.
 */
export class Presets {
  private readonly presets = new Map<string, Preset>();

  constructor(private readonly dir?: string) {
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const preset = validPreset(JSON.parse(readFileSync(join(dir, file), 'utf8')));
        this.presets.set(keyOf(preset.name), preset);
      } catch (err) {
        console.error(`Skipping unreadable Preset file ${file}`, err);
      }
    }
  }

  /** Names of the saved Presets, alphabetically. */
  list(): string[] {
    return [...this.presets.values()].map((p) => p.name).sort((a, b) => a.localeCompare(b));
  }

  get(name: string): Preset {
    const preset = this.presets.get(keyOf(name));
    if (!preset) throw new IllegalActionError(`No Preset named ${name}`);
    return preset;
  }

  /** Validates and stores a Preset, replacing any with the same name. */
  save(raw: unknown): Preset {
    const preset = validPreset(raw);
    this.presets.set(keyOf(preset.name), preset);
    if (this.dir) {
      // File names come from a hash of the name, so any name is safe on any filesystem.
      const file = join(this.dir, `${createHash('sha256').update(keyOf(preset.name)).digest('hex').slice(0, 20)}.json`);
      writeFileSync(`${file}.tmp`, JSON.stringify(preset, null, 2));
      renameSync(`${file}.tmp`, file);
    }
    return preset;
  }
}
