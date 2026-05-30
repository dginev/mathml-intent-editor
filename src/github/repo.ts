/**
 * The GitHub operations the editor needs, abstracted so the submit orchestration can be unit-tested
 * against a mock and the real implementation (Octokit) can be swapped in. See `octokitBackend.ts`.
 */
export type RepoConfig = {
  owner: string;
  repo: string;
  /** Branch PRs target, e.g. "main". */
  baseBranch: string;
  /** Path of the backing dictionary file in the repo, e.g. "open.yml". */
  filePath: string;
};

export type RepoBackend = {
  /**
   * Commit `content` to `filePath` on `branch`, creating `branch` off the base branch if needed.
   * Pushing more commits to a branch with an open PR auto-updates that PR.
   */
  commitFile(branch: string, content: string, message: string): Promise<void>;
  /** Open a PR from `branch` into the base branch; returns the PR number. */
  openPullRequest(branch: string, title: string, body: string): Promise<number>;
  /** Whether the given PR has been merged. */
  isPullRequestMerged(prNumber: number): Promise<boolean>;
};
