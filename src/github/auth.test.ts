import { describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizeUrl,
  consumeState,
  exchangeCodeForToken,
  loadToken,
  parseCallback,
  rememberState,
  saveToken,
} from './auth';

const fakeStorage = (): Storage => {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
};

describe('buildAuthorizeUrl', () => {
  it('targets GitHub with client id, redirect, scope and state', () => {
    const url = new URL(buildAuthorizeUrl('CID', 'https://app.example/cb', 'st8', 'public_repo'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('CID');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/cb');
    expect(url.searchParams.get('scope')).toBe('public_repo');
    expect(url.searchParams.get('state')).toBe('st8');
  });
});

describe('parseCallback', () => {
  it('extracts code and state', () => {
    expect(parseCallback('?code=abc&state=xyz')).toEqual({ code: 'abc', state: 'xyz' });
  });
  it('returns null without a code', () => {
    expect(parseCallback('?error=access_denied')).toBeNull();
    expect(parseCallback('')).toBeNull();
  });
});

describe('state round-trip (CSRF)', () => {
  it('remembers then consumes once', () => {
    const s = fakeStorage();
    rememberState(s, 'st8');
    expect(consumeState(s)).toBe('st8');
    expect(consumeState(s)).toBeNull(); // single-use
  });
});

describe('exchangeCodeForToken', () => {
  it('POSTs the code to the proxy and returns the token', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'gho_x' }),
    })) as unknown as typeof fetch;
    const token = await exchangeCodeForToken('https://proxy.example/token', 'code1', fetchImpl);
    expect(token).toBe('gho_x');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://proxy.example/token',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws when the proxy fails or omits the token', async () => {
    const bad = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(exchangeCodeForToken('p', 'c', bad)).rejects.toThrow();
    const noToken = (async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(exchangeCodeForToken('p', 'c', noToken)).rejects.toThrow();
  });
});

describe('token storage', () => {
  it('saves and loads the token', () => {
    const s = fakeStorage();
    expect(loadToken(s)).toBeNull();
    saveToken(s, 'gho_x');
    expect(loadToken(s)).toBe('gho_x');
  });
});
