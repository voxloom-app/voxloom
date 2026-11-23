// BUS-229: the deterministic Formal pass. It removes clear fillers and
// expands contractions, and leaves anything it cannot be sure of alone.
import { describe, expect, it } from 'vitest';
import { formalPass } from '../../../src/services/cleanup/formalPass';

const TICKET = 'Like right now, talking to you and uh, yeah, like, that\'s so cool.';

describe('formalPass', () => {
  it('strips the fillers from the BUS-229 sentence and expands that\'s', () => {
    expect(formalPass(TICKET)).toBe('Right now, talking to you and that is so cool.');
    // What Qwen3 0.6B returns for Formal today (it drops only "uh").
    expect(formalPass('Like right now, talking to you and yeah, like, that\'s so cool.'))
      .toBe('Right now, talking to you and that is so cool.');
  });

  it.each([
    ['I like this.', 'I like this.'],
    ['It looks like rain.', 'It looks like rain.'],
    ['We would like to ship.', 'We would like to ship.'],
    ['Something like that works.', 'Something like that works.'],
    ['Things, like apples, are good.', 'Things, like apples, are good.'],
    ['Like I said, we ship.', 'Like I said, we ship.'],
    ['I was like, no way.', 'I was like, no way.'],
    ['Like, I like this.', 'I like this.'],
    ['It is, like, broken.', 'It is broken.'],
    ['And like really fast.', 'And really fast.'],
  ])('keeps verb and preposition "like", drops filler "like": %s', (raw, expected) => {
    expect(formalPass(raw)).toBe(expected);
  });

  it.each([
    ['Um, so I think it\'s been fine.', 'So I think it has been fine.'],
    ['Yeah, I don\'t think we can\'t ship it.', 'I do not think we cannot ship it.'],
    ['It works, you know.', 'It works.'],
    ['Right now, you know, it works.', 'Right now, it works.'],
    ['We should, um, meet at 3 PM, honestly.', 'We should meet at 3 PM.'],
    ['It works. Yeah, so we ship.', 'It works. So we ship.'],
    ['I\'m sure they\'re gonna say we\'ve won\'t.', 'I am sure they are going to say we have will not.'],
    ['Let\'s go, uh, now.', 'Let us go now.'],
  ])('removes fillers and expands contractions: %s', (raw, expected) => {
    expect(formalPass(raw)).toBe(expected);
  });

  it.each([
    'Do you know where it is?',
    'Answer honestly.',
    'He basically agreed.',
    'Rowan\'s laptop is fine.',
    'UH and ER are acronyms here.',
    'I\'d go.',
  ])('leaves meaningful words, possessives and ALL-CAPS alone: %s', (raw) => {
    expect(formalPass(raw)).toBe(raw);
  });

  it('never edits quoted text, code, paths, URLs or names', () => {
    expect(formalPass('He said "um, like, yeah, don\'t" to me.')).toBe('He said "um, like, yeah, don\'t" to me.');
    expect(formalPass('Run `rm -rf ./uh` and open https://x.io/like?um=1 then, uh, wait.'))
      .toBe('Run `rm -rf ./uh` and open https://x.io/like?um=1 then wait.');
    expect(formalPass('Open src/um/like.ts, uh, now.')).toBe('Open src/um/like.ts now.');
    expect(formalPass('Ask Like Inc. about it.')).toBe('Ask Like Inc. about it.');
  });

  it.each([
    ['So basically we need, um, 25 servers by March 3rd, and the budget is $4,500.',
      'So basically we need 25 servers by March 3rd, and the budget is $4,500.'],
    ['Open, um, src/foo.ts now.', 'Open src/foo.ts now.'],
    ['Um, https://example.com', 'https://example.com'],
    ['He said, um, "don\'t go" to me.', 'He said "don\'t go" to me.'],
    ['Um, 25 servers are down.', '25 servers are down.'],
    ['We shipped. Um, `npm test` passes.', 'We shipped. `npm test` passes.'],
  ])('keeps a protected value right after a removed filler (CR #199): %s', (raw, expected) => {
    expect(formalPass(raw)).toBe(expected);
  });

  it.each([
    'Everyone\'s laptop is broken.',
    'Someone\'s car is blocking the driveway.',
  ])('leaves an everyone/someone possessive alone (CR #199): %s', (raw) => {
    expect(formalPass(raw)).toBe(raw);
  });

  it('reads has/is past a removed filler (CR #199)', () => {
    expect(formalPass('It\'s, um, been fine.')).toBe('It has been fine.');
  });

  it('is idempotent', () => {
    const once = formalPass(TICKET);
    expect(formalPass(once)).toBe(once);
  });
});
