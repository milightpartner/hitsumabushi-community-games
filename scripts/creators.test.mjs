import { describe, it, expect } from 'vitest';
import { canActFor } from './creators.mjs';

const creators = { milightpartner: { displayName: 'ひつまぶし', members: ['8720soichiro', 'gami8'] } };

describe('creators', () => {
  it('lets a user act as themselves (case-insensitive)', () => {
    expect(canActFor('Alice', 'alice', creators)).toBe(true);
    expect(canActFor('alice', 'bob', creators)).toBe(false);
  });

  it('lets team members act as the team, and nobody else', () => {
    expect(canActFor('milightpartner', '8720soichiro', creators)).toBe(true);
    expect(canActFor('MilightPartner', 'GAMI8', creators)).toBe(true);
    expect(canActFor('milightpartner', 'mallory', creators)).toBe(false);
  });
});
