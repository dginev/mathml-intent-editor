import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSeedSource, createSource, type ConceptSource } from './data/source';
import { loadDictionary } from './data/loadDictionary';
import { loadEdits, recordEdit } from './data/editCache';
import { conceptId } from './data/conceptId';
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
import { submitToService } from './github/submitClient';
import type { Concept } from './types';
import './App.css';

// The editor pulls in Temml (~the bulk of the bundle); load it only when a user starts editing.
const NotationEditor = lazy(() =>
  import('./components/NotationEditor').then((m) => ({ default: m.NotationEditor })),
);

/** Clone the ~1k-concept seed up to this many times to exercise the table at the 10k+ row target. */
const DEV_MULTIPLIER = 10;
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
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [total, setTotal] = useState(0); // row count (set on load, decremented on delete)
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
  }, [repo, handle]);

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

  // Editing requires a signed-in identity only when a service is configured.
  const openEditor = useCallback(
    (concept: Concept) => {
      if (service && !identity) {
        setSubmitState('Sign in with GitHub to suggest edits.');
        return;
      }
      setEditing(concept);
    },
    [service, identity],
  );

  // Commit the current dataset to the service (bot → intent/<handle> branch + PR), when configured.
  const submitFile = useCallback(
    (message: string) => {
      if (!service || !identity || !source) return;
      void (async () => {
        try {
          setSubmitState('Submitting…');
          const { prNumber, prUrl } = await submitToService(service.serviceUrl, identity.jwt, {
            content: source.serialize(),
            message: `${message} (proposed by @${identity.handle})`,
          });
          setSubmitState(`PR #${prNumber}`);
          window.open(prUrl, '_blank', 'noopener');
        } catch (e) {
          setSubmitState(`Submit failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      })();
    },
    [service, identity, source],
  );

  const handleSave = useCallback(
    (updated: Concept) => {
      if (!editing || !source) return;
      const id = conceptId(editing); // identity when opened — stable even if the edit renames it
      source.applyEdit(id, updated); // canonical full dataset (used for the PR file)
      setRows((prev) => prev.map((c) => (conceptId(c) === id ? updated : c)));
      if (repo) recordEdit(localStorage, id, updated, editing); // reload-safe
      setEditing(null);
      submitFile(`Update ${updated.slug}`);
    },
    [editing, source, repo, submitFile],
  );

  const handleDelete = useCallback(() => {
    if (!editing || !source) return;
    const id = conceptId(editing);
    source.remove(id);
    setRows((prev) => prev.filter((c) => conceptId(c) !== id));
    setTotal((t) => Math.max(0, t - 1));
    if (repo) recordEdit(localStorage, id, null, editing); // tombstone for reload/reconcile
    setEditing(null);
    submitFile(`Remove ${editing.slug}`);
  }, [editing, source, repo, submitFile]);

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
          <ConceptTable
            data={rows}
            total={total}
            filter={filter}
            onSelect={openEditor}
            onLoadMore={loadMore}
            editingId={editing ? conceptId(editing) : null}
          />
        )}
      </div>

      {/* Native <dialog>: focus trap, Esc to close, focus restore, inert background — for free. */}
      <dialog
        ref={dialogRef}
        className="modal"
        aria-label={editing ? `Edit notation: ${editing.slug}` : undefined}
        onClose={() => setEditing(null)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setEditing(null); // backdrop click
        }}
      >
        {editing && (
          <Suspense fallback={<p className="status">Loading editor…</p>}>
            <NotationEditor
              concept={editing}
              onSave={handleSave}
              onDelete={handleDelete}
              onCancel={() => setEditing(null)}
              knownSlugs={source?.slugSet()}
            />
          </Suspense>
        )}
      </dialog>
    </div>
  );
}
