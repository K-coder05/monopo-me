import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express } from 'express';

/**
 * Serves the built client from `dir` (its `index.html` and assets), so one process runs the whole
 * game in production. Returns false, serving nothing, when the client has not been built.
 */
export function serveClient(app: Express, dir: string): boolean {
  if (!existsSync(join(dir, 'index.html'))) return false;
  app.use(express.static(dir));
  return true;
}
