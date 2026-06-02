/**
 * Client-side "open the user's own PR" — the browser uses the signed-in user's GitHub token to
 * fork → branch → commit `open.yml` → open/update the PR against the upstream repo, entirely over
 * `api.github.com` (CORS-enabled). Because the *user's* token pushes, the commit is authored by them, so
 * it earns real contribution credit. This replaces the old bot service (`service/src/github.js`), whose
 * `ensureBranch`/`fileSha`/`ensurePullRequest`/`deleteBranch` logic this mirrors — now fork-aware.
 *
 * The maintainer (when `handle === owner`) has write access, so they skip the fork and push the branch
 * to the canonical repo directly; everyone else pushes to their fork (`<handle>/<repo>`).
 */
const API = 'https://api.github.com';

type Fetch = typeof fetch;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** UTF-8-safe base64 (the dictionary carries unicode math symbols). */
function toBase64(s: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function req(token: string, method: string, path: string, body: unknown, fetchImpl: Fetch): Promise<Response> {
  return fetchImpl(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function fail(res: Response, what: string): Promise<never> {
  let detail = '';
  try {
    detail = ((await res.json()) as { message?: string }).message ?? '';
  } catch {
    /* no JSON body */
  }
  throw new Error(`${what} failed: ${res.status}${detail ? ` (${detail})` : ''}`);
}

/** The open PR for a head branch on the upstream repo, or null. */
async function openPrFor(
  owner: string,
  repo: string,
  head: string,
  token: string,
  fetchImpl: Fetch,
): Promise<{ number: number; html_url: string } | null> {
  const res = await req(
    token,
    'GET',
    `/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(head)}&state=open`,
    undefined,
    fetchImpl,
  );
  if (!res.ok) await fail(res, 'list pull requests');
  const data = (await res.json()) as Array<{ number: number; html_url: string }>;
  return data[0] ?? null;
}

const FORK_POLL_TRIES = 10;
const FORK_POLL_MS = 1500;

/** Ensure the signed-in user has a fork of `owner/repo`; forking is async, so poll until it's queryable. */
export async function ensureFork(
  { owner, repo, handle, token }: { owner: string; repo: string; handle: string; token: string },
  fetchImpl: Fetch = fetch,
): Promise<void> {
  const res = await req(token, 'POST', `/repos/${owner}/${repo}/forks`, {}, fetchImpl);
  if (!res.ok && res.status !== 202) await fail(res, 'fork');
  for (let i = 0; i < FORK_POLL_TRIES; i++) {
    const got = await req(token, 'GET', `/repos/${handle}/${repo}`, undefined, fetchImpl);
    if (got.ok) return;
    if (got.status !== 404) await fail(got, 'fork readiness');
    await delay(FORK_POLL_MS);
  }
  throw new Error('fork did not become ready in time');
}

/** Latest commit SHA of `branch` on a repo (used to branch off the *upstream* base for a minimal diff). */
async function refSha(owner: string, repo: string, branch: string, token: string, fetchImpl: Fetch): Promise<string> {
  const res = await req(token, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`, undefined, fetchImpl);
  if (!res.ok) await fail(res, 'read base ref');
  return ((await res.json()) as { object: { sha: string } }).object.sha;
}

/** Create `branch` at `sha` in the target repo if it doesn't already exist. */
async function ensureBranch(
  owner: string,
  repo: string,
  branch: string,
  sha: string,
  token: string,
  fetchImpl: Fetch,
): Promise<void> {
  const got = await req(token, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`, undefined, fetchImpl);
  if (got.ok) return;
  if (got.status !== 404) await fail(got, 'read branch');
  const made = await req(
    token,
    'POST',
    `/repos/${owner}/${repo}/git/refs`,
    { ref: `refs/heads/${branch}`, sha },
    fetchImpl,
  );
  if (!made.ok) await fail(made, 'create branch');
}

/** Current blob SHA of `path` on `ref`, or undefined when the file doesn't exist there yet. */
async function fileSha(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token: string,
  fetchImpl: Fetch,
): Promise<string | undefined> {
  const res = await req(
    token,
    'GET',
    `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    undefined,
    fetchImpl,
  );
  if (res.status === 404) return undefined;
  if (!res.ok) await fail(res, 'read file');
  const data = (await res.json()) as { sha?: string } | unknown[];
  return Array.isArray(data) ? undefined : data.sha;
}

/** Commit `content` to `path` on `branch` (commit authored by the token's user → contribution credit). */
async function putContents(
  owner: string,
  repo: string,
  path: string,
  branch: string,
  content: string,
  message: string,
  sha: string | undefined,
  token: string,
  fetchImpl: Fetch,
): Promise<void> {
  const res = await req(
    token,
    'PUT',
    `/repos/${owner}/${repo}/contents/${path}`,
    { message, content: toBase64(content), branch, ...(sha ? { sha } : {}) },
    fetchImpl,
  );
  if (!res.ok) await fail(res, 'commit');
}

/** Open the PR into `base`, or refresh the title/body of the existing open one for this head. */
async function ensurePullRequest(
  owner: string,
  repo: string,
  base: string,
  head: string,
  title: string,
  body: string,
  token: string,
  fetchImpl: Fetch,
): Promise<{ number: number; html_url: string }> {
  const res = await req(token, 'POST', `/repos/${owner}/${repo}/pulls`, { title, head, base, body }, fetchImpl);
  if (res.ok) return (await res.json()) as { number: number; html_url: string };
  if (res.status !== 422) await fail(res, 'open pull request'); // 422 ⇒ a PR for this head already exists
  const existing = await openPrFor(owner, repo, head, token, fetchImpl);
  if (!existing) return fail(res, 'open pull request');
  const patch = await req(
    token,
    'PATCH',
    `/repos/${owner}/${repo}/pulls/${existing.number}`,
    { title, body },
    fetchImpl,
  );
  return patch.ok ? ((await patch.json()) as { number: number; html_url: string }) : existing;
}

/** Delete a branch ref in the target repo; a no-op (false) if it's already gone. Used on PR close. */
export async function deleteBranch(
  { owner, repo, branch, token }: { owner: string; repo: string; branch: string; token: string },
  fetchImpl: Fetch = fetch,
): Promise<boolean> {
  const res = await req(token, 'DELETE', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, undefined, fetchImpl);
  if (res.ok) return true;
  if (res.status === 404 || res.status === 422) return false;
  return fail(res, 'delete branch');
}

export type SubmitArgs = {
  owner: string;
  repo: string;
  baseBranch: string;
  filePath: string;
  handle: string;
  token: string;
  content: string;
  branch: string;
  title: string;
  description: string;
  message: string;
  fetchImpl?: Fetch;
};

/**
 * Fork (unless the maintainer) → branch off upstream base → commit → open/update the PR. Returns the PR
 * plus `headOwner` (the repo the branch lives in) so the session can later delete it. If the (reused)
 * branch has no open PR, it's dropped first so the new PR is cut fresh off the base (minimal diff).
 */
export async function submitViaFork(
  args: SubmitArgs,
): Promise<{ prNumber: number; prUrl: string; headOwner: string }> {
  const { owner, repo, baseBranch, filePath, handle, token, content, branch, title, description, message } = args;
  const fetchImpl = args.fetchImpl ?? fetch;

  let headOwner = owner;
  if (handle !== owner) {
    await ensureFork({ owner, repo, handle, token }, fetchImpl);
    headOwner = handle;
  }
  const head = `${headOwner}:${branch}`;

  if (!(await openPrFor(owner, repo, head, token, fetchImpl))) {
    await deleteBranch({ owner: headOwner, repo, branch, token }, fetchImpl);
  }
  const sha = await refSha(owner, repo, baseBranch, token, fetchImpl);
  await ensureBranch(headOwner, repo, branch, sha, token, fetchImpl);
  const blobSha = await fileSha(headOwner, repo, filePath, branch, token, fetchImpl);
  await putContents(headOwner, repo, filePath, branch, content, message, blobSha, token, fetchImpl);
  const pr = await ensurePullRequest(owner, repo, baseBranch, head, title, description, token, fetchImpl);
  return { prNumber: pr.number, prUrl: pr.html_url, headOwner };
}
