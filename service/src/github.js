import { Octokit } from '@octokit/core';
import { createAppAuth } from '@octokit/auth-app';

const UA = 'mathml-intent-editor-service';

/** Exchange a user OAuth `code` for a user-to-server token (GitHub App client_id + secret). */
export async function exchangeCode(code, { clientId, clientSecret }) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`OAuth exchange failed: ${data.error_description || data.error || res.status}`);
  }
  return data.access_token;
}

/** Resolve the authenticated user's `@handle` from a user token. */
export async function loginFor(userToken) {
  const res = await fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${userToken}`, accept: 'application/vnd.github+json', 'user-agent': UA },
  });
  if (!res.ok) throw new Error(`User lookup failed: ${res.status}`);
  const data = await res.json();
  if (!data.login) throw new Error('No login on user response');
  return data.login;
}

/** Octokit authenticated as the GitHub App installation (the controlled bot account). */
export function makeBotOctokit({ appId, privateKey, installationId }) {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey, installationId },
    userAgent: UA,
  });
}

const status = (e) => e?.status ?? e?.response?.status;

async function ensureBranch(octokit, owner, repo, baseBranch, branch) {
  try {
    await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', { owner, repo, ref: `heads/${branch}` });
    return;
  } catch (e) {
    if (status(e) !== 404) throw e;
  }
  const base = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
    owner, repo, ref: `heads/${baseBranch}`,
  });
  await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
    owner, repo, ref: `refs/heads/${branch}`, sha: base.data.object.sha,
  });
}

async function fileSha(octokit, owner, repo, path, ref) {
  try {
    const res = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', { owner, repo, path, ref });
    return Array.isArray(res.data) ? undefined : res.data.sha;
  } catch (e) {
    if (status(e) === 404) return undefined;
    throw e;
  }
}

/** PR title + Markdown body, with the editor's attribution appended as a footer. */
function prMeta(handle, title, description) {
  const finalTitle = (title || '').trim() || `Intent dictionary updates from @${handle}`;
  const attribution = `_Proposed by @${handle} via the MathML Intent Open Editor._`;
  const desc = (description || '').trim();
  const body = desc ? `${desc}\n\n---\n${attribution}` : attribution;
  return { title: finalTitle, body };
}

async function ensurePullRequest(octokit, owner, repo, baseBranch, branch, handle, title, description) {
  const meta = prMeta(handle, title, description);
  try {
    const res = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
      owner, repo, title: meta.title, head: branch, base: baseBranch, body: meta.body,
    });
    return res.data;
  } catch (e) {
    if (status(e) !== 422) throw e; // 422 ⇒ a PR for this head already exists
    const existing = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
      owner, repo, head: `${owner}:${branch}`, state: 'open',
    });
    if (existing.data.length === 0) throw e;
    const pr = existing.data[0];
    try {
      // refresh the title + description to reflect the latest batch (best-effort)
      await octokit.request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}', {
        owner, repo, pull_number: pr.number, title: meta.title, body: meta.body,
      });
    } catch {
      /* keep the PR even if updating its title/description fails */
    }
    return pr;
  }
}

/** The open PR for this head branch, or null. */
async function openPrFor(octokit, owner, repo, branch) {
  const res = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
    owner, repo, head: `${owner}:${branch}`, state: 'open',
  });
  return res.data[0] ?? null;
}

/** Delete a branch ref; a no-op if it's already gone. */
async function deleteBranch(octokit, owner, repo, branch) {
  try {
    await octokit.request('DELETE /repos/{owner}/{repo}/git/refs/{ref}', { owner, repo, ref: `heads/${branch}` });
    return true;
  } catch (e) {
    if (status(e) === 404 || status(e) === 422) return false; // already deleted
    throw e;
  }
}

/**
 * Build the bot `submit` operation: commit `content` to `intent/<handle>` and ensure the PR into the
 * base branch is open. If the branch has NO open PR (its previous PR was closed/merged), the stale
 * branch is dropped first so a fresh branch is cut off the current base — keeping the new PR's diff
 * minimal. An open PR is left in place and pushing onto it auto-updates it. Returns `{ prNumber, prUrl }`.
 */
export function makeSubmit({ octokit, owner, repo, baseBranch, filePath }) {
  return async function submit({ handle, content, message, title, description, branch: requested }) {
    // The client picks a unique branch per PR (`<handle>-<date>-<concept>`); reuse it while its PR is
    // open (a new commit updates the PR), else cut it fresh off the base. Fall back to a per-handle name.
    const branch = requested || `intent/${handle}`;
    if (!(await openPrFor(octokit, owner, repo, branch))) await deleteBranch(octokit, owner, repo, branch);
    await ensureBranch(octokit, owner, repo, baseBranch, branch);
    await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
      owner,
      repo,
      path: filePath,
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
      sha: await fileSha(octokit, owner, repo, filePath, branch),
    });
    const pr = await ensurePullRequest(octokit, owner, repo, baseBranch, branch, handle, title, description);
    return { prNumber: pr.number, prUrl: pr.html_url };
  };
}

/**
 * Build the bot `reset` operation: delete the user's `intent/<handle>` branch (a no-op if absent). The
 * client calls this when it detects the branch's PR was closed/merged, so the next edit starts a fresh
 * branch off the current base. Returns `{ deleted }`.
 */
export function makeReset({ octokit, owner, repo }) {
  return async function reset({ handle, branch }) {
    const deleted = await deleteBranch(octokit, owner, repo, branch || `intent/${handle}`);
    return { deleted };
  };
}
