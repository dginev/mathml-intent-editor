import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSeedSource, createSource, type ConceptSource } from './data/source';
import { loadDictionary } from './data/loadDictionary';
import { loadEdits, recordEdit } from './data/editCache';
import { ConceptTable } from './components/ConceptTable';
import type { SavedNotation } from './components/NotationEditor';
import {
  buildAuthorizeUrl,
  clearToken,
  consumeState,
  exchangeCodeForToken,
  loadToken,
  parseCallback,
  randomState,
  rememberState,
  saveToken,
} from './github/auth';
import { oauthConfigFromEnv, repoConfigFromEnv, tokenFromEnv } from './github/config';
import { createOctokitBackend } from './github/octokitBackend';
import { branchName, loadSession, saveSession } from './github/session';
import { refreshSession, submitEdit } from './github/submit';
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

export default function App() {
  const [source, setSource] = useState<ConceptSource | null>(null);
  const [rows, setRows] = useState<Concept[]>([]); // loaded prefix of the full list
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Concept | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const loadingRef = useRef(false);

  // Branch-tracked session (persisted locally).
  const [session, setSession] = useState(() => loadSession(localStorage, () => crypto.randomUUID()));
  const [submitState, setSubmitState] = useState<string | null>(null);

  // Auth: a GitHub token comes from OAuth sign-in (stored) or VITE_GH_TOKEN (dev). The backend (and
  // thus PR submission) is built only when both a token and repo config are present.
  const oauth = useMemo(() => oauthConfigFromEnv(), []);
  const [token, setToken] = useState<string | null>(() => loadToken(localStorage) ?? tokenFromEnv());
  const backend = useMemo(() => {
    const config = repoConfigFromEnv();
    return config && token ? createOctokitBackend(token, config) : null;
  }, [token]);

  // Complete the OAuth redirect (?code=…&state=…) once on load: verify state, exchange via the proxy.
  useEffect(() => {
    if (!oauth) return;
    const cb = parseCallback(window.location.search);
    if (!cb) return;
    const cleanUrl = window.location.origin + window.location.pathname;
    const valid = cb.state === consumeState(localStorage);
    window.history.replaceState(null, '', cleanUrl);
    // State updates happen in the async continuations below (never synchronously in this effect).
    void (valid
      ? exchangeCodeForToken(oauth.proxyUrl, cb.code).then((t) => {
          saveToken(localStorage, t);
          setToken(t);
        })
      : Promise.reject(new Error('state mismatch'))
    ).catch((e) => setSubmitState(`Sign-in failed: ${e instanceof Error ? e.message : String(e)}`));
  }, [oauth]);

  const signIn = useCallback(() => {
    if (!oauth) return;
    const state = randomState();
    rememberState(localStorage, state);
    const redirectUri = window.location.origin + window.location.pathname;
    window.location.assign(buildAuthorizeUrl(oauth.clientId, redirectUri, state, oauth.scope));
  }, [oauth]);

  const signOut = useCallback(() => {
    clearToken(localStorage);
    setToken(tokenFromEnv());
  }, []);

  const total = source?.total ?? 0;

  useEffect(() => {
    const config = repoConfigFromEnv();
    if (config) {
      // Production: read open.yml from GitHub (raw CDN) and reconcile with local edits client-side.
      // (handle is null until the identity gate lands; for now this reads base + local edits.)
      loadDictionary({ ...config, handle: null, edits: loadEdits(localStorage) })
        .then(({ concepts, conflicts }) => {
          setSource(createSource(concepts));
          setConflicts(conflicts);
        })
        .catch((e) => setError(String(e)));
    } else {
      // Dev/e2e: the seed ×N, to exercise the table at the 10k-row target without a backing repo.
      createSeedSource(DEV_MULTIPLIER)
        .then(setSource)
        .catch((e) => setError(String(e)));
    }
  }, []);

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

  // Load the first page (a couple of viewports) once the source is ready.
  useEffect(() => {
    if (source) void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const handleSave = useCallback(
    (notation: SavedNotation) => {
      if (!editing || !source) return;
      const slug = editing.slug;
      const mathml = [notation.mathml, ...editing.mathml.slice(1)];
      source.applyEdit(slug, mathml, notation.tex); // canonical (full dataset, used for the PR file)
      setRows((prev) =>
        prev.map((c) => (c.slug === slug ? { ...c, mathml, tex: notation.tex } : c)),
      ); // displayed
      // Persist the edit locally so a reload restores it (reconciled on next load). `editing` is the
      // pre-edit value → captured as the fork ancestor on the first edit of this concept.
      if (repoConfigFromEnv()) recordEdit(localStorage, { ...editing, mathml, tex: notation.tex }, editing);
      setEditing(null);

      // Commit to the session branch and open/update the PR (when GitHub is configured).
      if (!backend) return;
      void (async () => {
        try {
          setSubmitState('Submitting…');
          const refreshed = await refreshSession(backend, session);
          const next = await submitEdit(
            backend,
            refreshed,
            source.serialize(),
            `Update notation for ${slug}`,
          );
          saveSession(localStorage, next);
          setSession(next);
          setSubmitState(`PR #${next.prNumber} · ${branchName(next)}`);
        } catch (e) {
          setSubmitState(`Submit failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      })();
    },
    [editing, source, backend, session],
  );

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
            {backend
              ? (submitState ?? `branch ${branchName(session)}`)
              : oauth
                ? 'Sign in to submit changes'
                : 'GitHub not configured — local only'}
          </span>
          {oauth &&
            (token ? (
              <button type="button" className="auth-btn" onClick={signOut}>
                Sign out
              </button>
            ) : (
              <button type="button" className="auth-btn" onClick={signIn}>
                Sign in with GitHub
              </button>
            ))}
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
            onSelect={setEditing}
            onLoadMore={loadMore}
          />
        )}

        {editing && (
          <aside className="editor-panel">
            <Suspense fallback={<p className="status">Loading editor…</p>}>
              <NotationEditor
                concept={editing.slug}
                initialTex={editing.tex ?? ''}
                onSave={handleSave}
                onCancel={() => setEditing(null)}
              />
            </Suspense>
          </aside>
        )}
      </div>
    </div>
  );
}
