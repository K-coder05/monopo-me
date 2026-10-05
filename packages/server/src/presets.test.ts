import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IllegalActionError, toPreset, type Preset } from '@landlord/engine';
import { Rooms } from './rooms';
import { Presets } from './presets';

describe('Presets store', () => {
  let dir: string;
  let preset: Preset;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'landlord-presets-'));
    const rooms = new Rooms(() => {});
    const host = rooms.create('Ann', '#e6194b');
    rooms.act(host.roomCode, { type: 'UPDATE_RULES', playerId: host.playerId, changes: { goSalary: 400 } });
    preset = toPreset(rooms.get(host.roomCode)!, 'House rules');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps saved Presets across a restart, in their own folder', () => {
    new Presets(dir).save(preset);

    const reopened = new Presets(dir);
    expect(reopened.list()).toEqual(['House rules']);
    expect(reopened.get('House rules')).toEqual(preset);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('replaces a Preset saved again under the same name, ignoring case', () => {
    const presets = new Presets(dir);
    presets.save(preset);
    presets.save({ ...preset, name: 'HOUSE RULES', rules: { ...preset.rules, goSalary: 500 } });

    const reopened = new Presets(dir);
    expect(reopened.list()).toEqual(['HOUSE RULES']);
    expect(reopened.get('house rules').rules.goSalary).toBe(500);
  });

  it('refuses an invalid Preset and an unknown name', () => {
    const presets = new Presets(dir);
    expect(() => presets.save({ ...preset, board: [] })).toThrow(IllegalActionError);
    expect(() => presets.get('Nope')).toThrow(IllegalActionError);
    expect(presets.list()).toEqual([]);
  });

  it('skips a damaged file on disk', () => {
    new Presets(dir).save(preset);
    writeFileSync(join(dir, 'broken.json'), '{ not json');
    writeFileSync(join(dir, 'tampered.json'), JSON.stringify({ ...preset, name: 'Tampered', cards: 'x' }));

    expect(new Presets(dir).list()).toEqual(['House rules']);
  });
});
