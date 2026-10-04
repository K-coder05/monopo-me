import { describe, expect, it } from 'vitest';
import { defaultBoard, defaultRules } from '../index';

describe('default Board', () => {
  it('has 40 Space definitions indexed 0–39 in order', () => {
    expect(defaultBoard.map((s) => s.index)).toEqual(Array.from({ length: 40 }, (_, i) => i));
  });

  it('gives every street a 6-entry rent table', () => {
    const streets = defaultBoard.filter((s) => s.type === 'street');
    expect(streets).toHaveLength(22);
    for (const street of streets) expect(street.rents).toHaveLength(6);
  });

  it('carries no trademarked branding', () => {
    expect(JSON.stringify([defaultBoard, defaultRules]).toLowerCase()).not.toContain('monopoly');
  });
});
