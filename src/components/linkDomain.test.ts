import { describe, expect, it } from 'vitest';
import { linkDomain } from './linkDomain';

describe('linkDomain', () => {
  it('labels a recognized encyclopedia by name (regardless of subdomain)', () => {
    expect(linkDomain('https://en.wikipedia.org/wiki/Group_(mathematics)')).toBe('wikipedia');
    expect(linkDomain('https://mathworld.wolfram.com/Group.html')).toBe('mathworld');
    expect(linkDomain('https://oeis.org/A000045')).toBe('oeis');
    expect(linkDomain('https://www.britannica.com/science/group-theory')).toBe('britannica');
    expect(linkDomain('https://ncatlab.org/nlab/show/group')).toBe('ncatlab');
  });

  it('recognizes the math reference sites in the whitelist', () => {
    expect(linkDomain('https://planetmath.org/group')).toBe('planetmath');
    expect(linkDomain('https://ncatlab.org/nlab/show/group')).toBe('ncatlab');
    expect(linkDomain('https://dlmf.nist.gov/5.2')).toBe('dlmf');
    expect(linkDomain('https://arxiv.org/abs/2101.00001')).toBe('arxiv');
  });

  it('falls back to the filename for an unrecognized site', () => {
    expect(linkDomain('https://home.iiserb.ac.in/~kashyap/Group/thesis_abhay.pdf')).toBe(
      'thesis_abhay.pdf',
    );
    expect(linkDomain('https://example.org/papers/On%20Groups.pdf')).toBe('On Groups.pdf');
  });

  it('falls back to the bare host when an unrecognized URL has no path', () => {
    expect(linkDomain('https://www.example.com/')).toBe('example.com');
    expect(linkDomain('https://example.com')).toBe('example.com');
  });

  it('tolerates a missing protocol', () => {
    expect(linkDomain('en.wikipedia.org/wiki/Ring')).toBe('wikipedia');
  });
});
