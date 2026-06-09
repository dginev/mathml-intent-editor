/** The public backing repo + the file within it that holds the dictionary. */
export type RepoConfig = { owner: string; repo: string; baseBranch: string; filePath: string };

/**
 * Configuration from Vite env vars (set in `.env.local` for dev, or the Pages build):
 *   VITE_GH_OWNER, VITE_GH_REPO, VITE_GH_BASE (default "main"), VITE_GH_FILE (default "open.yml")
 *     — the public backing repo, read directly from raw.githubusercontent.
 *   VITE_GH_CLIENT_ID  — the GitHub App's client id (public).
 *   VITE_GH_SERVICE    — base URL of the auth+PR service (e.g. https://intent-api.latexml.rs).
 *
 * Each `*FromEnv()` returns null when unset, so the app degrades gracefully: no repo config → seed
 * fallback (dev/e2e); no service config → editing stays local-only (no sign-in gate, no PRs).
 */
const env = import.meta.env as unknown as Record<string, string | undefined>;

/**
 * The canonical public backing repo. Used as the self-contained default target for the PR-review feature
 * so it works even in the seed dev server (no env): reviewing reads `main` + a PR head from raw directly,
 * independent of whether the rest of the app is in seed or live mode. In production `repoConfigFromEnv()`
 * resolves to the same values.
 */
export const DATA_REPO: RepoConfig = {
  owner: 'dginev',
  repo: 'mathml-intent-open',
  baseBranch: 'main',
  filePath: 'open.yml',
};

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

export type ServiceConfig = { clientId: string; serviceUrl: string };

export function serviceConfigFromEnv(): ServiceConfig | null {
  const clientId = env.VITE_GH_CLIENT_ID;
  const serviceUrl = env.VITE_GH_SERVICE;
  if (!clientId || !serviceUrl) return null;
  return { clientId, serviceUrl: serviceUrl.replace(/\/+$/, '') };
}
