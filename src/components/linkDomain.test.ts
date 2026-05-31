import { describe, expect, it } from 'vitest';
import { linkDomain } from './linkDomain';

describe('linkDomain', () => {
  it('labels a URL by its recognizable domain (dropping locale/www prefixes and the TLD)', () => {
    expect(linkDomain('https://en.wikipedia.org/wiki/Group_(mathematics)')).toBe('wikipedia');
    expect(linkDomain('https://mathworld.wolfram.com/Group.html')).toBe('mathworld');
    expect(linkDomain('https://oeis.org/A000045')).toBe('oeis');
    expect(linkDomain('https://www.britannica.com/science/group-theory')).toBe('britannica');
    expect(linkDomain('https://ncatlab.org/nlab/show/group')).toBe('ncatlab');
  });

  it('handles a URL without a protocol', () => {
    expect(linkDomain('en.wikipedia.org/wiki/Ring')).toBe('wikipedia');
  });
});
