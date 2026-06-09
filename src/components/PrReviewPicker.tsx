import { useEffect, useReducer, useRef } from 'react';
import { listOpenPullRequests, type PullRequest } from '../github/pulls';
import type { RepoConfig } from '../github/config';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; prs: PullRequest[] };

type LoadAction = { type: 'loading' } | { type: 'error'; message: string } | { type: 'ready'; prs: PullRequest[] };

// A reducer (not useState) so the effect's synchronous "loading" reset is a dispatch — the codebase's
// pattern for an effect that resets-then-fetches (see useDictionary), and lint-clean.
function reduce(_s: LoadState, a: LoadAction): LoadState {
  return a.type === 'ready' ? { status: 'ready', prs: a.prs } : a.type === 'error' ? { status: 'error', message: a.message } : { status: 'loading' };
}

/**
 * A native `<dialog>` that lists the backing repo's open pull requests and lets the reviewer pick one to
 * visualize. Reads the public GitHub API (no token); each pick enters read-only review mode upstream.
 * Open PRs are listed as-is — not pre-filtered to those that touch `open.yml` (that would cost an extra
 * API call each), so picking a PR with no dictionary changes simply shows an empty diff.
 */
export function PrReviewPicker({
  repo,
  open,
  onClose,
  onSelect,
}: {
  repo: RepoConfig;
  open: boolean;
  onClose: () => void;
  onSelect: (pr: PullRequest) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, dispatch] = useReducer(reduce, { status: 'loading' });
  const [reloadKey, bumpReload] = useReducer((n: number) => n + 1, 0);

  // Drive the modal from `open` (showModal centres + traps focus; close() restores focus on dismiss).
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  // (Re)fetch the open PRs each time the dialog opens (and on Retry) — fresh state every visit.
  useEffect(() => {
    if (!open) return;
    let live = true;
    dispatch({ type: 'loading' });
    listOpenPullRequests(repo.owner, repo.repo)
      .then((prs) => live && dispatch({ type: 'ready', prs }))
      .catch((e) => live && dispatch({ type: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [open, repo.owner, repo.repo, reloadKey]);

  return (
    <dialog
      ref={ref}
      className="modal pr-picker"
      aria-label="Review a pull request"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(); // backdrop click
      }}
    >
      <div className="pr-picker-body">
        <h2>Review a pull request</h2>
        <p className="pr-picker-hint">
          Pick an open pull request against{' '}
          <code>
            {repo.owner}/{repo.repo}
          </code>{' '}
          to see its <code>{repo.filePath}</code> changes rendered into the table.
        </p>

        {state.status === 'loading' && (
          <p className="status">
            <span className="spinner" aria-hidden="true" /> Loading open pull requests…
          </p>
        )}

        {state.status === 'error' && (
          <div className="pr-picker-error" role="alert">
            <p>Couldn’t load pull requests: {state.message}</p>
            <button type="button" onClick={bumpReload}>
              Retry
            </button>
          </div>
        )}

        {state.status === 'ready' && state.prs.length === 0 && (
          <p className="status">No open pull requests.</p>
        )}

        {state.status === 'ready' && state.prs.length > 0 && (
          <ul className="pr-list">
            {state.prs.map((pr) => (
              <li key={pr.number}>
                <button type="button" className="pr-item" onClick={() => onSelect(pr)}>
                  <span className="pr-num">#{pr.number}</span>
                  <span className="pr-title">{pr.title}</span>
                  <span className="pr-meta">
                    @{pr.author}
                    {pr.updatedAt ? ` · ${pr.updatedAt.slice(0, 10)}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
