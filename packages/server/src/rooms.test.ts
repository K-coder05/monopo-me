import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IllegalActionError, type CardDraft, type Rng } from '@landlord/engine';
import { IDLE_EXPIRY_MS, Rooms } from './rooms';

let n = 0;
const rng: Rng = { int: (max) => n++ % max };
const COLORS = ['#e6194b', '#3cb44b', '#4363d8'] as [string, string, string];

describe('Rooms persistence and reconnect', () => {
  let dir: string;
  let clock: number;
  const open = () => new Rooms(() => {}, rng, () => clock, dir);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'landlord-rooms-'));
    clock = 1_000_000;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reloads a Room, with its game state, after a restart', () => {
    const before = open();
    const host = before.create('Ann', COLORS[0]);
    before.join(host.roomCode, 'Bob', COLORS[1]);
    const started = before.act(host.roomCode, { type: 'START_GAME', playerId: host.playerId });

    const after = open();
    expect(after.get(host.roomCode)).toEqual(started.state);
  });

  it('lets a Player rejoin with their token, and nobody else', () => {
    const rooms = open();
    const host = rooms.create('Ann', COLORS[0]);
    const bob = rooms.join(host.roomCode, 'Bob', COLORS[1]);

    const restarted = open();
    expect(restarted.rejoin(host.roomCode, bob.token)).toBe(bob.playerId);
    expect(() => restarted.rejoin(host.roomCode, 'forged')).toThrow(IllegalActionError);
    expect(() => restarted.rejoin(host.roomCode, '')).toThrow(IllegalActionError);
    expect(() => restarted.rejoin('NOPE1', bob.token)).toThrow(IllegalActionError);
  });

  it('keeps Rules edits per Room and across a restart, and refuses a non-host', () => {
    const rooms = open();
    const host = rooms.create('Ann', COLORS[0]);
    const bob = rooms.join(host.roomCode, 'Bob', COLORS[1]);
    const other = rooms.create('Cy', COLORS[2]);

    expect(() =>
      rooms.act(host.roomCode, { type: 'UPDATE_RULES', playerId: bob.playerId, changes: { goSalary: 1 } }),
    ).toThrow(IllegalActionError);
    rooms.act(host.roomCode, { type: 'UPDATE_RULES', playerId: host.playerId, changes: { goSalary: 400 } });

    expect(open().get(host.roomCode)!.rules.goSalary).toBe(400);
    expect(rooms.get(other.roomCode)!.rules.goSalary).toBe(200);
  });

  it('keeps card edits per Room and across a restart, and refuses a non-host', () => {
    const rooms = open();
    const host = rooms.create('Ann', COLORS[0]);
    const bob = rooms.join(host.roomCode, 'Bob', COLORS[1]);
    const card: CardDraft = { title: 'Windfall', text: 'Collect 5.', effects: [{ type: 'TRANSFER', amount: 5, from: 'bank', to: 'drawer' }], enabled: true, copies: 1 };

    expect(() => rooms.act(host.roomCode, { type: 'ADD_CARD', playerId: bob.playerId, deck: 'chance', card })).toThrow(IllegalActionError);
    rooms.act(host.roomCode, { type: 'ADD_CARD', playerId: host.playerId, deck: 'chance', card });

    expect(open().get(host.roomCode)!.decks.chance.cards.map((c) => c.title)).toContain('Windfall');
  });

  it('tracks who is connected', () => {
    const rooms = open();
    const host = rooms.create('Ann', COLORS[0]);
    const bob = rooms.join(host.roomCode, 'Bob', COLORS[1]);
    expect(rooms.away(host.roomCode)).toEqual([host.playerId, bob.playerId]);

    rooms.connect(host.roomCode, host.playerId);
    rooms.connect(host.roomCode, bob.playerId);
    expect(rooms.away(host.roomCode)).toEqual([]);

    // A refresh connects the new socket before the old one disconnects.
    rooms.connect(host.roomCode, host.playerId);
    rooms.disconnect(host.roomCode, host.playerId);
    expect(rooms.away(host.roomCode)).toEqual([]);
    rooms.disconnect(host.roomCode, host.playerId);
    expect(rooms.away(host.roomCode)).toEqual([host.playerId]);
  });

  it('deletes Rooms idle for 30 days, including their file', () => {
    const rooms = open();
    const idle = rooms.create('Ann', COLORS[0]);
    clock += IDLE_EXPIRY_MS - 1;
    const active = rooms.create('Bob', COLORS[1]);
    clock += 2;
    rooms.expireIdle();

    expect(rooms.get(idle.roomCode)).toBeUndefined();
    expect(rooms.get(active.roomCode)).toBeDefined();
    expect(readdirSync(dir)).toEqual([`${active.roomCode}.json`]);
  });

  it('expires stale Rooms on load', () => {
    const rooms = open();
    const room = rooms.create('Ann', COLORS[0]);
    clock += IDLE_EXPIRY_MS + 1;
    expect(open().get(room.roomCode)).toBeUndefined();
  });

  it('counts an action as activity', () => {
    const rooms = open();
    const host = rooms.create('Ann', COLORS[0]);
    clock += IDLE_EXPIRY_MS - 1;
    rooms.join(host.roomCode, 'Bob', COLORS[1]);
    clock += IDLE_EXPIRY_MS - 1;
    rooms.expireIdle();
    expect(rooms.get(host.roomCode)).toBeDefined();
  });
});
