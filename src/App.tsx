import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSeedSource, createSource, type ConceptSource } from './data/source';
import { loadDictionary } from './data/loadDictionary';
import { loadEdits, recordEdit } from './data/editCache';
import { ConceptTable } from './components/ConceptTable';
import type { SavedNotation } from './components/NotationEditor';
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

export default function App() {
  const [source, setSource] = useState<ConceptSource | null>(null);
  const [rows, setRows] = useState<Concept[]>([]); // loaded prefix of the full list
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Concept | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const loadingRef = useRef(false);

  // Config: backing repo (raw reads) and the auth+PR service. Either may be absent → graceful fallback.
  const repo = useMemo(() => repoConfigFromEnv(), []);
  const service = useMemo(() => serviceConfigFromEnv(), []);

  // Identity: a verified @handle + JWT from the service's /auth. Required to edit when a service is
  // configured; without a service the app is local-only (no gate, no PRs).
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity(localStorage));
  const [submitState, setSubmitState] = useState<string | null>(null);
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
    ).catch((e) => setSubmitState(`Sign-in failed: ${e instanceof Error ? e.message : String(e)}`));
  }, [service]);

  // Load the dictionary. Reloads when the signed-in handle changes (to read the user's branch).
  useEffect(() => {
    let live = true;
    const done = (s: ConceptSource, c: string[] = []) => {
      if (!live) return;
      setRows([]);
      setSource(s);
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

  const total = source?.total ?? 0;

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

  const handleSave = useCallback(
    (notation: SavedNotation) => {
      if (!editing || !source) return;
      const slug = editing.slug;
      // Store the W3C shape: a full <math>…</math> string (texToIntent returns the inner fragment).
      const rendered = `<math>${notation.mathml}</math>`;
      const mathml = [rendered, ...editing.mathml.slice(1)];
      source.applyEdit(slug, mathml, notation.tex); // canonical full dataset (used for the PR file)
      setRows((prev) => prev.map((c) => (c.slug === slug ? { ...c, mathml, tex: notation.tex } : c)));
      if (repo) recordEdit(localStorage, { ...editing, mathml, tex: notation.tex }, editing); // reload-safe
      setEditing(null);

      // Submit to the service: the bot commits to intent/<handle> and opens/updates the PR.
      if (!service || !identity) return;
      void (async () => {
        try {
          setSubmitState('Submitting…');
          const { prNumber, prUrl } = await submitToService(service.serviceUrl, identity.jwt, {
            content: source.serialize(),
            message: `Update notation for ${slug} (proposed by @${identity.handle})`,
          });
          setSubmitState(`PR #${prNumber}`);
          window.open(prUrl, '_blank', 'noopener');
        } catch (e) {
          setSubmitState(`Submit failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      })();
    },
    [editing, source, service, identity, repo],
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
            {!service
              ? 'GitHub not configured — local only'
              : identity
                ? (submitState ?? `signed in as @${identity.handle}`)
                : 'Sign in to contribute'}
          </span>
          {service &&
            (identity ? (
              <button type="button" className="auth-btn" onClick={signOut}>
                Sign out (@{identity.handle})
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
            onSelect={openEditor}
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
