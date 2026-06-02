/**
 * Client side of GitHub sign-in. The user authorizes our **classic OAuth App** (scope `public_repo`);
 * the redirect `code` is exchanged by our thin service (`/auth`) for the user's GitHub **access token**
 * (the OAuth token endpoint has no CORS + needs the client secret, so the exchange is server-side). The
 * browser then uses that token directly against `api.github.com` to fork + commit + open the PR — so the
 * PR is genuinely the user's and the commit earns them contribution credit. The token is long-lived
 * (classic OAuth tokens don't expire unless revoked), so there's no session/JWT/renew machinery.
 */
const IDENTITY_KEY = 'intent-editor.identity';
const STATE_KEY = 'intent-editor.oauth-state';
const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';

/** `public_repo` — push to the user's fork of the (public) data repo + open the PR. */
export const OAUTH_SCOPE = 'public_repo';

/** A signed-in user: their `@handle` and a GitHub access token scoped to `public_repo`. */
export type Identity = { handle: string; token: string };

/** Classic OAuth App authorization URL (takes a `scope`, unlike a GitHub App). */
export function buildAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  scope: string = OAUTH_SCOPE,
): string {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, scope, state });
  return `${GITHUB_AUTHORIZE}?${params}`;
}

/** Parse the OAuth redirect query into `{ code, state }`, or null if there's no code. */
export function parseCallback(search: string): { code: string; state: string } | null {
  const params = new URLSearchParams(search);
  const code = params.get('code');
  const state = params.get('state');
  return code && state ? { code, state } : null;
}

/**
 * Parse an OAuth *failure* redirect (`?error=…&error_description=…`), or null when there's no error.
 * GitHub redirects back this way for catchable failures (e.g. the user cancels the authorization).
 */
export function parseCallbackError(search: string): { error: string; description?: string } | null {
  const params = new URLSearchParams(search);
  const error = params.get('error');
  if (!error) return null;
  return { error, description: params.get('error_description') ?? undefined };
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

/** Exchange the OAuth `code` at the service's `/auth` for the user's identity (handle + access token). */
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
  if (!data.token || !data.handle) throw new Error('Auth response missing token/handle');
  return { handle: data.handle, token: data.token };
}

export function saveIdentity(storage: Storage, identity: Identity): void {
  storage.setItem(IDENTITY_KEY, JSON.stringify(identity));
}

export function loadIdentity(storage: Storage): Identity | null {
  const raw = storage.getItem(IDENTITY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Identity;
    return parsed && parsed.handle && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

export function clearIdentity(storage: Storage): void {
  storage.removeItem(IDENTITY_KEY);
}
