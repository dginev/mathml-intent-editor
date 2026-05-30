/**
 * Client side of GitHub OAuth (web flow). Each contributor signs in with their own GitHub account so
 * PRs are attributed to them. GitHub's token exchange needs a client secret, so the `code → token`
 * step goes through a small server-side proxy (see `exchangeCodeForToken`); everything else is here.
 */
const TOKEN_KEY = 'intent-editor.gh-token';
const STATE_KEY = 'intent-editor.oauth-state';
const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';

export function buildAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  scope = 'public_repo',
): string {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, scope, state });
  return `${GITHUB_AUTHORIZE}?${params}`;
}

/** Parse the OAuth redirect query string into `{ code, state }`, or null if there's no code. */
export function parseCallback(search: string): { code: string; state: string } | null {
  const params = new URLSearchParams(search);
  const code = params.get('code');
  const state = params.get('state');
  return code && state ? { code, state } : null;
}

/** A random opaque CSRF state value. */
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

/** Exchange the OAuth `code` for an access token via the server-side proxy. */
export async function exchangeCodeForToken(
  proxyUrl: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(proxyUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('Token exchange response had no access_token');
  return data.access_token;
}

export function saveToken(storage: Storage, token: string): void {
  storage.setItem(TOKEN_KEY, token);
}

export function loadToken(storage: Storage): string | null {
  return storage.getItem(TOKEN_KEY);
}

export function clearToken(storage: Storage): void {
  storage.removeItem(TOKEN_KEY);
}
