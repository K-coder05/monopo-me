import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serveClient } from './serveClient';

describe('serveClient', () => {
  let dir: string;
  let server: Server | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'landlord-client-'));
  });
  afterEach(() => {
    server?.close();
    server = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  /** Starts an app serving `dir` on a free port and returns its base URL. */
  async function start(): Promise<{ base: string; served: boolean }> {
    const app = express();
    const served = serveClient(app, dir);
    app.get('/health', (_req, res) => res.json({ ok: true }));
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    return { base: `http://localhost:${(server.address() as AddressInfo).port}`, served };
  }

  it('serves the built client, including a share link and its assets', async () => {
    writeFileSync(join(dir, 'index.html'), '<title>Landlord</title>');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
    const { base, served } = await start();

    expect(served).toBe(true);
    expect(await (await fetch(`${base}/`)).text()).toContain('Landlord');
    expect(await (await fetch(`${base}/?room=ABCDE`)).text()).toContain('Landlord');
    const asset = await fetch(`${base}/assets/app.js`);
    expect(asset.headers.get('content-type')).toMatch(/javascript/);
    expect((await (await fetch(`${base}/health`)).json())).toEqual({ ok: true });
  });

  it('serves nothing when the client has not been built', async () => {
    const { base, served } = await start();

    expect(served).toBe(false);
    expect((await fetch(`${base}/`)).status).toBe(404);
  });
});
