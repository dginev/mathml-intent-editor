import type { RepoConfig } from './repo';

/**
 * Backing-repo configuration + auth, from Vite env vars (`.env.local`):
 *   VITE_GH_OWNER, VITE_GH_REPO, VITE_GH_BASE (default "main"), VITE_GH_FILE (default "open.yml")
 *   VITE_GH_TOKEN — a token for dev. In production this is replaced by the anonymous OAuth flow
 *   (see auth.ts, TODO). Returns null when the integration isn't configured, so the app falls back
 *   to local-only edits.
 */
const env = import.meta.env as unknown as Record<string, string | undefined>;

export function repoConfigFromEnv(): RepoConfig | null {
  const owner = env.VITE_GH_OWNER;
  const repo = env.VITE_GH_REPO;
  if (!owner || !repo) return null;
  return {
    owner,
    repo,
    baseBranch: env.VITE_GH_BASE ?? 'main',
    filePath: env.VITE_GH_FILE ?? 'open.yml',
  };
}

export function tokenFromEnv(): string | null {
  return env.VITE_GH_TOKEN ?? null;
}

export type OAuthConfig = { clientId: string; proxyUrl: string; scope: string };

/**
 * GitHub OAuth config from env: VITE_GH_CLIENT_ID, VITE_GH_OAUTH_PROXY (the token-exchange proxy
 * endpoint), VITE_GH_SCOPE (default "public_repo"). Null when sign-in isn't configured.
 */
export function oauthConfigFromEnv(): OAuthConfig | null {
  const clientId = env.VITE_GH_CLIENT_ID;
  const proxyUrl = env.VITE_GH_OAUTH_PROXY;
  if (!clientId || !proxyUrl) return null;
  return { clientId, proxyUrl, scope: env.VITE_GH_SCOPE ?? 'public_repo' };
}
