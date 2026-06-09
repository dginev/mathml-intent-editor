import { useEffect, useReducer, useRef } from 'react';
import { listClosedPullRequests, listOpenPullRequests, type PullRequest } from '../github/pulls';
import type { RepoConfig } from '../github/config';

type Lists = { open: PullRequest[]; closed: PullRequest[] };
type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | ({ status: 'ready' } & Lists);

type LoadAction = { type: 'loading' } | { type: 'error'; message: string } | ({ type: 'ready' } & Lists);

// A reducer (not useState) so the effect's synchronous "loading" reset is a dispatch — the codebase's
// pattern for an effect that resets-then-fetches (see useDictionary), and lint-clean.
function reduce(_s: LoadState, a: LoadAction): LoadState {
  if (a.type === 'ready') return { status: 'ready', open: a.open, closed: a.closed };
  if (a.type === 'error') return { status: 'error', message: a.message };
  return { status: 'loading' };
}

/** One selectable PR row. Closed/merged PRs carry a state tag and diff against their branch point. */
function PrItem({ pr, onSelect }: { pr: PullRequest; onSelect: (pr: PullRequest) => void }) {
  return (
    <li>
      <button type="button" className="pr-item" onClick={() => onSelect(pr)}>
        <span className="pr-num">#{pr.number}</span>
        <span className="pr-title">{pr.title}</span>
        {pr.state === 'closed' && (
          <span className={`pr-tag ${pr.merged ? 'merged' : 'closed'}`}>{pr.merged ? 'merged' : 'closed'}</span>
        )}
        <span className="pr-meta">
          @{pr.author}
          {pr.updatedAt ? ` · ${pr.updatedAt.slice(0, 10)}` : ''}
        </span>
      </button>
    </li>
  );
}

/**
 * A native `<dialog>` listing the backing repo's pull requests — open ones (diffed against live `main`)
 * and closed/merged ones (diffed against the commit they branched from) — so a reviewer can pull either
 * into the table. Reads the public GitHub API (no token). PRs aren't pre-filtered to those that touch
 * `open.yml` (that would cost an API call each), so picking a no-op PR simply shows an empty diff.
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

  // (Re)fetch both PR lists each time the dialog opens (and on Retry) — fresh state every visit.
  useEffect(() => {
    if (!open) return;
    let live = true;
    dispatch({ type: 'loading' });
    Promise.all([listOpenPullRequests(repo.owner, repo.repo), listClosedPullRequests(repo.owner, repo.repo)])
      .then(([openPrs, closedPrs]) => live && dispatch({ type: 'ready', open: openPrs, closed: closedPrs }))
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
          Pick a pull request against{' '}
          <code>
            {repo.owner}/{repo.repo}
          </code>{' '}
          to see its <code>{repo.filePath}</code> changes in the table. Open PRs are compared to the
          current <code>{repo.baseBranch}</code>; closed PRs to the commit they branched from.
        </p>

        {state.status === 'loading' && (
          <p className="status">
            <span className="spinner" aria-hidden="true" /> Loading pull requests…
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

        {state.status === 'ready' && (
          <>
            <section className="pr-group" data-testid="pr-group-open">
              <h3 className="pr-group-head">Open pull requests</h3>
              {state.open.length === 0 ? (
                <p className="status">None open.</p>
              ) : (
                <ul className="pr-list">
                  {state.open.map((pr) => (
                    <PrItem key={pr.number} pr={pr} onSelect={onSelect} />
                  ))}
                </ul>
              )}
            </section>

            <section className="pr-group" data-testid="pr-group-closed">
              <h3 className="pr-group-head">Closed pull requests</h3>
              {state.closed.length === 0 ? (
                <p className="status">None closed.</p>
              ) : (
                <ul className="pr-list">
                  {state.closed.map((pr) => (
                    <PrItem key={pr.number} pr={pr} onSelect={onSelect} />
                  ))}
                </ul>
              )}
            </section>
          </>
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
