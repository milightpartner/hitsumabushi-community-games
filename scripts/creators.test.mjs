import { describe, it, expect } from 'vitest';
import { canActFor, creatorDisplayName } from './creators.mjs';

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

  it('credits the team display name, or the login itself', () => {
    expect(creatorDisplayName('milightpartner', creators)).toBe('ひつまぶし');
    expect(creatorDisplayName('alice', creators)).toBe('alice');
    expect(creatorDisplayName('alice', undefined)).toBe('alice');
  });
});
