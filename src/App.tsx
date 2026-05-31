import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSeedSource, createSource, type ConceptSource } from './data/source';
import { loadDictionary } from './data/loadDictionary';
import { loadEdits, recordEdit, clearEdits } from './data/editCache';
import { conceptId } from './data/conceptId';
import { byConcept } from './data/serialize';
import { ConceptTable } from './components/ConceptTable';
import {
  buildAuthorizeUrl,
  clearIdentity,
  consumeState,
  exchangeCodeForIdentity,
  loadIdentity,
  parseCallback,
  randomState,
  rememberState,
  saveIdentity,
  type Identity,
} from './github/auth';
import { repoConfigFromEnv, serviceConfigFromEnv } from './github/config';
import { resetSession, submitToService } from './github/submitClient';
import { clearPr, fetchPullState, loadPr, savePr, type ActivePr } from './github/prSession';
import type { Concept } from './types';
import './App.css';

// The editor pulls in Temml (~the bulk of the bundle); load it only when a user starts editing.
const NotationEditor = lazy(() =>
  import('./components/NotationEditor').then((m) => ({ default: m.NotationEditor })),
);

/** Clone the small synthetic seed fixture this many times to exercise the table at the 10k+ row target. */
const DEV_MULTIPLIER = 1200;
/** Rows fetched per page — the initial load and each page-down increment (~a couple of viewports). */
const PAGE = 50;

const THEME_KEY = 'intent-editor.theme';
type Theme = 'light' | 'dark';
/** Current theme — the inline script in index.html already set `data-theme` (saved or OS preference). */
function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export default function App() {
  const [source, setSource] = useState<ConceptSource | null>(null);
  const [rows, setRows] = useState<Concept[]>([]); // loaded prefix of the full list
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Concept | null>(null);
  const [creating, setCreating] = useState(false); // the open modal is for a brand-new concept
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [total, setTotal] = useState(0); // row count (set on load, decremented on delete)
  // Edits/adds/deletes batch locally; one Save submits the whole batch as a single PR update.
  const [dirty, setDirty] = useState(() => Object.keys(loadEdits(localStorage)).length > 0);
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null); // row flashed red pre-confirm
  // The PR the user's branch terminates in; when it closes/merges we reset the session and reload.
  const [activePr, setActivePr] = useState<ActivePr | null>(() => loadPr(localStorage));
  const [reloadKey, setReloadKey] = useState(0); // bump to force a fresh dictionary load
  const loadingRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Drive the native modal dialog from `editing` (showModal centres + traps focus; close() on cancel).
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (editing && !d.open) d.showModal();
    else if (!editing && d.open) d.close();
  }, [editing]);

  // Config: backing repo (raw reads) and the auth+PR service. Either may be absent → graceful fallback.
  const repo = useMemo(() => repoConfigFromEnv(), []);
  const service = useMemo(() => serviceConfigFromEnv(), []);

  // Identity: a verified @handle + JWT from the service's /auth. Required to edit when a service is
  // configured; without a service the app is local-only (no gate, no PRs).
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity(localStorage));
  const [submitState, setSubmitState] = useState<string | null>(null);
  // True from the moment we return with an OAuth code until /auth resolves — drives the "Signing in…"
  // spinner. Initialized synchronously so the spinner shows immediately on the redirect back.
  const [authPending, setAuthPending] = useState(
    () => !!(serviceConfigFromEnv() && parseCallback(window.location.search)),
  );
  const handle = identity?.handle ?? null;

  // Complete the OAuth redirect (?code=…&state=…): verify state, exchange via /auth, store identity.
  useEffect(() => {
    if (!service) return;
    const cb = parseCallback(window.location.search);
    if (!cb) return;
    const cleanUrl = window.location.origin + window.location.pathname;
    const valid = cb.state === consumeState(localStorage);
    window.history.replaceState(null, '', cleanUrl);
    void (valid
      ? exchangeCodeForIdentity(service.serviceUrl, cb.code).then((id) => {
          saveIdentity(localStorage, id);
          setIdentity(id);
        })
      : Promise.reject(new Error('state mismatch'))
    )
      .catch((e) => setSubmitState(`Sign-in failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setAuthPending(false));
  }, [service]);

  // Load the dictionary. Reloads when the signed-in handle changes (to read the user's branch).
  useEffect(() => {
    let live = true;
    const done = (s: ConceptSource, c: string[] = []) => {
      if (!live) return;
      setRows([]);
      setSource(s);
      setTotal(s.total);
      setConflicts(c);
    };
    if (repo) {
      loadDictionary({ ...repo, handle, edits: loadEdits(localStorage) })
        .then(({ concepts, conflicts }) => done(createSource(concepts), conflicts))
        .catch((e) => live && setError(String(e)));
    } else {
      createSeedSource(DEV_MULTIPLIER)
        .then((s) => done(s))
        .catch((e) => live && setError(String(e)));
    }
    return () => {
      live = false;
    };
  }, [repo, handle, reloadKey]);

  // When the user's working PR is closed or merged, end the session: ask the service to delete the
  // (now stale) intent/<handle> branch, drop local edits, and reload clean from the base branch. Checked
  // on mount and whenever the tab regains focus (e.g. after closing the PR on GitHub in another tab).
  const resetIfPrClosed = useCallback(async () => {
    if (!service || !repo || !identity || !activePr) return;
    if ((await fetchPullState(repo.owner, repo.repo, activePr.number)) !== 'closed') return;
    try {
      await resetSession(service.serviceUrl, identity.jwt); // delete the branch (best-effort)
    } catch {
      /* lazy cleanup on the next /submit covers a failed reset */
    }
    clearEdits(localStorage);
    clearPr(localStorage);
    const closed = activePr.number;
    setActivePr(null);
    setSubmitState(`PR #${closed} closed — started a fresh session.`);
    setReloadKey((k) => k + 1);
  }, [service, repo, identity, activePr]);

  useEffect(() => {
    // resetIfPrClosed setStates only AFTER an async PR-status fetch (an external-state check), never
    // synchronously — the rule can't see past the await, so the warning is a false positive here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void resetIfPrClosed();
    const onFocus = () => void resetIfPrClosed();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [resetIfPrClosed]);

  // Page the next chunk in on demand; guarded so overlapping scroll events don't double-fetch.
  const loadMore = useCallback(async () => {
    if (!source || loadingRef.current) return;
    const start = rows.length;
    if (start >= source.total) return;
    loadingRef.current = true;
    try {
      const next = await source.fetchRange(start, start + PAGE);
      setRows((prev) => (prev.length === start ? [...prev, ...next] : prev));
    } finally {
      loadingRef.current = false;
    }
  }, [source, rows.length]);

  // Load the first page once a (new) source is ready.
  useEffect(() => {
    if (source) void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const signIn = useCallback(() => {
    if (!service) return;
    const state = randomState();
    rememberState(localStorage, state);
    const redirectUri = window.location.origin + window.location.pathname;
    window.location.assign(buildAuthorizeUrl(service.clientId, redirectUri, state));
  }, [service]);

  const signOut = useCallback(() => {
    clearIdentity(localStorage);
    clearPr(localStorage);
    setActivePr(null);
    setIdentity(null);
    setSubmitState(null);
  }, []);

  const [theme, setTheme] = useState<Theme>(currentTheme);
  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
  }, []);

  // Editing/adding requires a signed-in identity only when a service is configured.
  const gated = useCallback(() => {
    if (service && !identity) {
      setSubmitState('Sign in with GitHub to suggest edits.');
      return false;
    }
    return true;
  }, [service, identity]);

  const openEditor = useCallback(
    (concept: Concept) => {
      if (!gated()) return;
      setCreating(false);
      setEditing(concept);
    },
    [gated],
  );

  // Open the modal on a blank concept — saved as a new row on "Done".
  const openCreate = useCallback(() => {
    if (!gated()) return;
    setCreating(true);
    setEditing({ slug: '', mathml: [], links: [], alias: [] });
  }, [gated]);

  const closeModal = useCallback(() => {
    setEditing(null);
    setCreating(false);
  }, []);

  // "Done" — apply the edit/addition to local state only (batched); the global Save submits later.
  const handleSave = useCallback(
    (updated: Concept) => {
      if (!source) return;
      if (creating) {
        source.add(updated);
        setRows((prev) => [...prev, updated].sort(byConcept)); // show it in canonical position
        setTotal((t) => t + 1);
        if (repo) recordEdit(localStorage, conceptId(updated), updated, null); // brand-new → no ancestor
      } else if (editing) {
        const id = conceptId(editing); // identity when opened — stable even if the edit renames it
        source.applyEdit(id, updated);
        setRows((prev) => prev.map((c) => (conceptId(c) === id ? updated : c)));
        if (repo) recordEdit(localStorage, id, updated, editing); // reload-safe
      }
      setDirty(true);
      setCreating(false);
      setEditing(null);
    },
    [editing, creating, source, repo],
  );

  // Apply a deletion to local state only (batched). Shared by the modal Delete and the row ✗.
  const deleteConcept = useCallback(
    (concept: Concept) => {
      if (!source) return;
      const id = conceptId(concept);
      source.remove(id);
      setRows((prev) => prev.filter((c) => conceptId(c) !== id));
      setTotal((t) => Math.max(0, t - 1));
      if (repo) recordEdit(localStorage, id, null, concept); // tombstone for reload/reconcile
      setDirty(true);
    },
    [source, repo],
  );

  const handleDelete = useCallback(() => {
    if (editing) deleteConcept(editing);
    setEditing(null);
  }, [editing, deleteConcept]);

  // Row ✗: flash the row red, then confirm before finalizing (deferred so the red paints first).
  const handleRowDelete = useCallback(
    (concept: Concept) => {
      if (!gated()) return;
      setPendingDeleteId(conceptId(concept));
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (confirm(`Remove concept "${concept.slug}"?`)) deleteConcept(concept);
          setPendingDeleteId(null);
        }),
      );
    },
    [gated, deleteConcept],
  );

  // Commit the whole batch to the service (bot → intent/<handle> branch + PR), when configured.
  const saveBatch = useCallback(() => {
    if (!source) return;
    if (!gated()) return;
    if (!service || !identity) return; // local-only: nothing to submit
    void (async () => {
      try {
        setSaving(true);
        setSubmitState('Submitting…');
        const { prNumber, prUrl } = await submitToService(service.serviceUrl, identity.jwt, {
          content: source.serialize(),
          message: `Update open.yml (proposed by @${identity.handle})`,
        });
        savePr(localStorage, { number: prNumber, url: prUrl }); // track it so we can detect closure
        setActivePr({ number: prNumber, url: prUrl });
        setSubmitState(`PR #${prNumber}`);
        setDirty(false);
        window.open(prUrl, '_blank', 'noopener');
      } catch (e) {
        setSubmitState(`Submit failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setSaving(false);
      }
    })();
  }, [source, gated, service, identity]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>MathML Intent Open Editor</h1>
        <div className="toolbar">
          <input
            type="search"
            placeholder="Filter concepts…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <span className="count" data-testid="concept-count" data-total={total}>
            {total.toLocaleString()} concepts
            {source && rows.length < total ? ` · ${rows.length.toLocaleString()} loaded` : ''}
          </span>
          <span className="session-status">
            {!service
              ? 'GitHub not configured — local only'
              : authPending
                ? 'Signing in…'
                : identity
                  ? (submitState ?? `signed in as @${identity.handle}`)
                  : 'Sign in to contribute'}
          </span>
          {service &&
            (authPending ? (
              <button type="button" className="auth-btn" disabled>
                <span className="spinner" aria-hidden="true" /> Signing in…
              </button>
            ) : identity ? (
              <button type="button" className="auth-btn" onClick={signOut}>
                Sign out (@{identity.handle})
              </button>
            ) : (
              <button type="button" className="auth-btn" onClick={signIn}>
                Sign in with GitHub
              </button>
            ))}
          <button
            type="button"
            className="theme-btn"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      {conflicts.length > 0 && (
        <p className="conflicts" role="status" data-testid="conflicts">
          {conflicts.length} concept{conflicts.length > 1 ? 's' : ''} changed upstream while you were
          editing — review: {conflicts.slice(0, 6).join(', ')}
          {conflicts.length > 6 ? '…' : ''}
        </p>
      )}

      <div className="body">
        {error && <p className="error">{error}</p>}
        {!source && !error && <p className="status">Loading dictionary…</p>}
        {source && (
          <>
            <div className="body-toolbar">
              <button type="button" className="add-entry" onClick={openCreate}>
                + Add entry
              </button>
              {service && (
                <button
                  type="button"
                  className="save-batch"
                  data-testid="save-batch"
                  disabled={!dirty || saving}
                  onClick={saveBatch}
                  title={dirty ? 'Submit all pending changes as one PR' : 'No pending changes'}
                >
                  {saving ? (
                    <>
                      <span className="spinner" aria-hidden="true" /> Saving…
                    </>
                  ) : (
                    'Save'
                  )}
                </button>
              )}
            </div>
            <ConceptTable
              data={rows}
              total={total}
              filter={filter}
              onSelect={openEditor}
              onLoadMore={loadMore}
              editingId={editing ? conceptId(editing) : null}
              onDelete={handleRowDelete}
              pendingDeleteId={pendingDeleteId}
            />
          </>
        )}
      </div>

      {/* Native <dialog>: focus trap, Esc to close, focus restore, inert background — for free. */}
      <dialog
        ref={dialogRef}
        className="modal"
        aria-label={editing ? (creating ? 'Add concept' : `Edit notation: ${editing.slug}`) : undefined}
        onClose={closeModal}
        onClick={(e) => {
          if (e.target === dialogRef.current) closeModal(); // backdrop click
        }}
      >
        {editing && (
          <Suspense fallback={<p className="status">Loading editor…</p>}>
            <NotationEditor
              concept={editing}
              onSave={handleSave}
              onDelete={creating ? undefined : handleDelete} // nothing to delete for a brand-new row
              onCancel={closeModal}
              knownSlugs={source?.slugSet()}
            />
          </Suspense>
        )}
      </dialog>
    </div>
  );
}
