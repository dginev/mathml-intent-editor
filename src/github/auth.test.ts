import { describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizeUrl,
  clearIdentity,
  consumeState,
  exchangeCodeForIdentity,
  isExpired,
  loadIdentity,
  parseCallback,
  rememberState,
  saveIdentity,
  secondsUntilExpiry,
  type Identity,
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
  it('targets GitHub with client id, redirect and state (no scope for a GitHub App)', () => {
    const url = new URL(buildAuthorizeUrl('CID', 'https://app.example/cb', 'st8'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('CID');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/cb');
    expect(url.searchParams.get('state')).toBe('st8');
    expect(url.searchParams.has('scope')).toBe(false);
  });
});

describe('parseCallback', () => {
  it('extracts code and state, or null', () => {
    expect(parseCallback('?code=abc&state=xyz')).toEqual({ code: 'abc', state: 'xyz' });
    expect(parseCallback('?error=access_denied')).toBeNull();
  });
});

describe('state round-trip (CSRF)', () => {
  it('remembers then consumes once', () => {
    const s = fakeStorage();
    rememberState(s, 'st8');
    expect(consumeState(s)).toBe('st8');
    expect(consumeState(s)).toBeNull();
  });
});

describe('exchangeCodeForIdentity', () => {
  it('POSTs the code to /auth and returns { handle, jwt }', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ handle: 'dginev', jwt: 'jwt123' }),
    })) as unknown as typeof fetch;
    const id = await exchangeCodeForIdentity('https://svc.example', 'code1', fetchImpl);
    expect(id).toEqual({ handle: 'dginev', jwt: 'jwt123' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://svc.example/auth',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws when the service errors or omits fields', async () => {
    const bad = (async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(exchangeCodeForIdentity('s', 'c', bad)).rejects.toThrow();
    const partial = (async () => ({ ok: true, status: 200, json: async () => ({ handle: 'x' }) })) as unknown as typeof fetch;
    await expect(exchangeCodeForIdentity('s', 'c', partial)).rejects.toThrow();
  });
});

describe('identity storage', () => {
  it('saves, loads and clears the identity', () => {
    const s = fakeStorage();
    const id: Identity = { handle: 'dginev', jwt: 'jwt123' };
    expect(loadIdentity(s)).toBeNull();
    saveIdentity(s, id);
    expect(loadIdentity(s)).toEqual(id);
    clearIdentity(s);
    expect(loadIdentity(s)).toBeNull();
  });

  it('treats a stored but expired session as signed-out (and drops it)', () => {
    const s = fakeStorage();
    saveIdentity(s, { handle: 'dginev', jwt: jwtExp(-60) }); // expired a minute ago
    expect(loadIdentity(s)).toBeNull();
    expect(s.getItem('intent-editor.identity')).toBeNull(); // pruned
  });

  it('loads a still-valid session', () => {
    const s = fakeStorage();
    const id: Identity = { handle: 'dginev', jwt: jwtExp(3600) }; // an hour left
    saveIdentity(s, id);
    expect(loadIdentity(s)).toEqual(id);
  });
});

/** Build a JWT-shaped string with a base64url payload carrying `exp` (now + `inSeconds`). */
const jwtExp = (inSeconds: number): string => {
  const exp = Math.floor(Date.now() / 1000) + inSeconds;
  const body = btoa(JSON.stringify({ handle: 'dginev', exp }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${body}.sig`;
};

describe('session expiry', () => {
  it('isExpired is true past exp, false before, false without an exp claim', () => {
    expect(isExpired({ handle: 'x', jwt: jwtExp(-1) })).toBe(true);
    expect(isExpired({ handle: 'x', jwt: jwtExp(60) })).toBe(false);
    expect(isExpired({ handle: 'x', jwt: 'no-exp-token' })).toBe(false);
  });

  it('secondsUntilExpiry reflects the remaining lifetime (null without exp)', () => {
    expect(secondsUntilExpiry({ handle: 'x', jwt: jwtExp(120) })).toBeGreaterThan(110);
    expect(secondsUntilExpiry({ handle: 'x', jwt: 'no-exp-token' })).toBeNull();
  });
});
