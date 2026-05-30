/**
 * Client side of GitHub sign-in. The user authorizes our GitHub App; the redirect `code` is exchanged
 * by our service (`/auth`) for a verified `@handle` + a signed identity JWT. The JWT is the badge the
 * browser presents to `/submit`. (The GitHub App's client secret + bot key live only on the service.)
 */
const IDENTITY_KEY = 'intent-editor.identity';
const STATE_KEY = 'intent-editor.oauth-state';
const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';

export type Identity = { handle: string; jwt: string };

/** GitHub App user-authorization URL. (Apps take no `scope` — permissions are fixed on the App.) */
export function buildAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state });
  return `${GITHUB_AUTHORIZE}?${params}`;
}

/** Parse the OAuth redirect query into `{ code, state }`, or null if there's no code. */
export function parseCallback(search: string): { code: string; state: string } | null {
  const params = new URLSearchParams(search);
  const code = params.get('code');
  const state = params.get('state');
  return code && state ? { code, state } : null;
}

export function randomState(): string {
  return crypto.randomUUID();
}

export function rememberState(storage: Storage, state: string): void {
  storage.setItem(STATE_KEY, state);
}

/** Read and clear the saved state (single-use, for CSRF comparison on callback). */
export function consumeState(storage: Storage): string | null {
  const state = storage.getItem(STATE_KEY);
  storage.removeItem(STATE_KEY);
  return state;
}

/** Exchange the OAuth `code` at the service's `/auth` for a verified identity (handle + JWT). */
export async function exchangeCodeForIdentity(
  serviceUrl: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Identity> {
  const res = await fetchImpl(`${serviceUrl}/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(`Sign-in failed: ${res.status}`);
  const data = (await res.json()) as Partial<Identity>;
  if (!data.jwt || !data.handle) throw new Error('Auth response missing jwt/handle');
  return { handle: data.handle, jwt: data.jwt };
}

export function saveIdentity(storage: Storage, identity: Identity): void {
  storage.setItem(IDENTITY_KEY, JSON.stringify(identity));
}

export function loadIdentity(storage: Storage): Identity | null {
  const raw = storage.getItem(IDENTITY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Identity;
    return parsed && parsed.handle && parsed.jwt ? parsed : null;
  } catch {
    return null;
  }
}

export function clearIdentity(storage: Storage): void {
  storage.removeItem(IDENTITY_KEY);
}
