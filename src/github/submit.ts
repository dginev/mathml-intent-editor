import { branchName, rotateAfterMerge, withPullRequest, type Session } from './session';
import type { RepoBackend } from './repo';

/**
 * Persist an edit to GitHub: commit the new file content to the session's branch, and open a PR on
 * the first edit. Later edits push onto the same branch, which auto-updates the open PR. Returns the
 * (possibly updated) session.
 */
export async function submitEdit(
  backend: RepoBackend,
  session: Session,
  content: string,
  message: string,
): Promise<Session> {
  const branch = branchName(session);
  await backend.commitFile(branch, content, message);
  if (session.prNumber == null) {
    const prNumber = await backend.openPullRequest(branch, message, '');
    return withPullRequest(session, prNumber);
  }
  return session;
}

/**
 * Before starting a new edit cycle, rotate to a fresh branch if the tracked PR has merged. Otherwise
 * the session is returned unchanged.
 */
export async function refreshSession(backend: RepoBackend, session: Session): Promise<Session> {
  if (session.prNumber != null && (await backend.isPullRequestMerged(session.prNumber))) {
    return rotateAfterMerge(session);
  }
  return session;
}
