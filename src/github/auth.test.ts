import { describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizeUrl,
  clearIdentity,
  consumeState,
  exchangeCodeForIdentity,
  loadIdentity,
  parseCallback,
  parseCallbackError,
  rememberState,
  saveIdentity,
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
  it('targets GitHub with client id, redirect, state and the public_repo scope (OAuth App)', () => {
    const url = new URL(buildAuthorizeUrl('CID', 'https://app.example/cb', 'st8'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('CID');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/cb');
    expect(url.searchParams.get('state')).toBe('st8');
    expect(url.searchParams.get('scope')).toBe('public_repo');
  });
});

describe('parseCallback', () => {
  it('extracts code and state, or null', () => {
    expect(parseCallback('?code=abc&state=xyz')).toEqual({ code: 'abc', state: 'xyz' });
    expect(parseCallback('?error=access_denied')).toBeNull();
  });
});

describe('parseCallbackError', () => {
  it('extracts an OAuth error + description, or null when there is none', () => {
    expect(parseCallbackError('?error=access_denied&error_description=The+user+denied')).toEqual({
      error: 'access_denied',
      description: 'The user denied',
    });
    expect(parseCallbackError('?code=abc&state=xyz')).toBeNull();
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
  it('POSTs the code to /auth and returns { handle, token }', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ handle: 'dginev', token: 'gho_abc' }),
    })) as unknown as typeof fetch;
    const id = await exchangeCodeForIdentity('https://svc.example', 'code1', fetchImpl);
    expect(id).toEqual({ handle: 'dginev', token: 'gho_abc' });
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
    const id: Identity = { handle: 'dginev', token: 'gho_abc' };
    expect(loadIdentity(s)).toBeNull();
    saveIdentity(s, id);
    expect(loadIdentity(s)).toEqual(id);
    clearIdentity(s);
    expect(loadIdentity(s)).toBeNull();
  });

  it('rejects a malformed / fieldless stored identity', () => {
    const s = fakeStorage();
    s.setItem('intent-editor.identity', JSON.stringify({ handle: 'x' })); // no token
    expect(loadIdentity(s)).toBeNull();
  });
});
