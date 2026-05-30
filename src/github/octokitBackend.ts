import { Octokit } from '@octokit/core';
import type { RepoBackend, RepoConfig } from './repo';

/** UTF-8 safe base64 for the GitHub contents API. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

type Status = { status?: number };

/**
 * `RepoBackend` backed by the GitHub REST API via Octokit. Requires a token with `repo`/contents +
 * pull-request write scope (in production this comes from the anonymous OAuth flow; see `auth.ts`).
 */
export function createOctokitBackend(token: string, config: RepoConfig): RepoBackend {
  const octokit = new Octokit({ auth: token });
  const { owner, repo, baseBranch, filePath } = config;

  async function ensureBranch(branch: string): Promise<void> {
    try {
      await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
        owner,
        repo,
        ref: `heads/${branch}`,
      });
      return; // already exists
    } catch (e) {
      if ((e as Status).status !== 404) throw e;
    }
    const base = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
      owner,
      repo,
      ref: `heads/${baseBranch}`,
    });
    await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: base.data.object.sha,
    });
  }

  async function fileSha(branch: string): Promise<string | undefined> {
    try {
      const res = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner,
        repo,
        path: filePath,
        ref: branch,
      });
      return Array.isArray(res.data) ? undefined : (res.data as { sha: string }).sha;
    } catch (e) {
      if ((e as Status).status === 404) return undefined;
      throw e;
    }
  }

  return {
    async commitFile(branch, content, message) {
      await ensureBranch(branch);
      await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
        owner,
        repo,
        path: filePath,
        message,
        content: toBase64(content),
        branch,
        sha: await fileSha(branch),
      });
    },

    async openPullRequest(branch, title, body) {
      try {
        const res = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
          owner,
          repo,
          title,
          head: branch,
          base: baseBranch,
          body,
        });
        return res.data.number;
      } catch (e) {
        if ((e as Status).status !== 422) throw e; // 422 ⇒ a PR for this head already exists
        const existing = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
          owner,
          repo,
          head: `${owner}:${branch}`,
          state: 'open',
        });
        if (existing.data.length === 0) throw e;
        return existing.data[0].number;
      }
    },

    async isPullRequestMerged(prNumber) {
      const res = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        owner,
        repo,
        pull_number: prNumber,
      });
      return Boolean(res.data.merged);
    },
  };
}
