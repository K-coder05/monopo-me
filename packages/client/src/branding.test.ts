import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');

describe('branding', () => {
  it('never names Monopoly anywhere in the client', () => {
    const sources = readdirSync(join(root, 'src'), { recursive: true, withFileTypes: true })
      .filter((f) => f.isFile())
      .map((f) => join(f.parentPath, f.name));
    const files = [join(root, 'index.html'), ...sources].filter((f) => !f.endsWith('branding.test.ts'));
    for (const file of files) {
      expect(readFileSync(file, 'utf-8'), file).not.toMatch(/monopoly/i);
    }
  });
});
