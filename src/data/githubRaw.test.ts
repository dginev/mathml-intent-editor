import { describe, expect, it, vi } from 'vitest';
import { fetchDictionary, rawUrl } from './githubRaw';
import { w3cYaml } from '../test/dictFixture';

describe('rawUrl', () => {
  it('builds a raw.githubusercontent URL for a ref', () => {
    expect(rawUrl('dginev', 'mathml-intent-open', 'main', 'open.yml')).toBe(
      'https://raw.githubusercontent.com/dginev/mathml-intent-open/main/open.yml',
    );
    expect(rawUrl('dginev', 'mathml-intent-open', 'intent/dginev', 'open.yml')).toBe(
      'https://raw.githubusercontent.com/dginev/mathml-intent-open/intent/dginev/open.yml',
    );
  });
});

describe('fetchDictionary', () => {
  const yaml = w3cYaml([{ concept: 'power', mathml: ['<math><msup/></math>'] }]);

  it('fetches and parses the dictionary', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => yaml })) as unknown as typeof fetch;
    const concepts = await fetchDictionary('https://example/open.yml', fetchImpl);
    expect(concepts?.map((c) => c.slug)).toEqual(['power']);
  });

  it('returns null when the file/branch does not exist (404)', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 404, text: async () => '' })) as unknown as typeof fetch;
    expect(await fetchDictionary('https://example/open.yml', fetchImpl)).toBeNull();
  });

  it('throws on other HTTP errors', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 500, text: async () => '' })) as unknown as typeof fetch;
    await expect(fetchDictionary('https://example/open.yml', fetchImpl)).rejects.toThrow();
  });
});
