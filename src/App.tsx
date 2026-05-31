import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSeedSource, createSource, type ConceptSource } from './data/source';
import { loadDictionary } from './data/loadDictionary';
import { loadEdits, saveEdits, clearEdits } from './data/editCache';
import { conceptId } from './data/conceptId';
import { conceptMatches } from './data/conceptMatch';
import { byConcept, serializeConcepts } from './data/serialize';
import {
  classifyChange,
  computeEdits,
  deletedIdsFromEdits,
  effectiveYaml,
  type BaseMap,
  type ChangeKind,
} from './data/pendingChanges';
import { buildSubmission } from './github/submission';
import { useTheme } from './hooks/useTheme';
import { useGlobalFindShortcut } from './hooks/useGlobalFindShortcut';
import { ConceptTable } from './components/ConceptTable';
import { Toast } from './components/ui';
import {
  buildAuthorizeUrl,
  clearIdentity,
  consumeState,
  exchangeCodeForIdentity,
  loadIdentity,
  parseCallback,
  randomState,
  rememberState,
  renewIdentity,
  saveIdentity,
  secondsUntilExpiry,
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
/** Renew the session on a visit once it has dipped below this many seconds (6 of its 7 days) — keeps an
 *  active user signed in indefinitely without renewing a token that was just minted. */
const RENEW_BELOW_SECONDS = 6 * 24 * 60 * 60;

export default function App() {
  const [source, setSource] = useState<ConceptSource | null>(null);
  const [rows, setRows] = useState<Concept[]>([]); // loaded prefix of the full list
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Concept | null>(null);
  const [creating, setCreating] = useState(false); // the open modal is for a brand-new concept
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [total, setTotal] = useState(0); // row count (set on load, decremented on delete)
  // Batch-edit session state. The working set is compared against `baseline` (the GitHub working point,
  // serialized): `dirty` — and so the Save button — is purely content-based. Pending deletions live in
  // `deletedIds` (the rows stay visible, rendered red) and are enacted only when the batch is saved.
  const [baseMap, setBaseMap] = useState<BaseMap | null>(null); // baseline concepts, by conceptId
  const [baseline, setBaseline] = useState<string | null>(null); // baseline serialized, for the dirty check
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null); // last Save failure → red button + toast
  const [savePrompt, setSavePrompt] = useState(false); // the "describe your changes" confirm modal
  const [saveTitle, setSaveTitle] = useState(''); // auto PR title (read-only preview)
  const [saveMessage, setSaveMessage] = useState(''); // the (editable) Markdown PR description
  // The PR the user's branch terminates in; when it closes/merges we reset the session and reload.
  const [activePr, setActivePr] = useState<ActivePr | null>(() => loadPr(localStorage));
  const [reloadKey, setReloadKey] = useState(0); // bump to force a fresh dictionary load
  const loadingRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const saveDialogRef = useRef<HTMLDialogElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  useGlobalFindShortcut(filterRef); // Ctrl/⌘+F focuses the (whole-dictionary) Filter

  // Drive the native modal dialog from `editing` (showModal centres + traps focus; close() on cancel).
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (editing && !d.open) d.showModal();
    else if (!editing && d.open) d.close();
  }, [editing]);

  // Drive the "describe your changes" confirm dialog the same way.
  useEffect(() => {
    const d = saveDialogRef.current;
    if (!d) return;
    if (savePrompt && !d.open) d.showModal();
    else if (!savePrompt && d.open) d.close();
  }, [savePrompt]);

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

  // Load the dictionary. `reloadKey` is bumped to force a fresh load (sign-out, PR-close reset).
  useEffect(() => {
    let live = true;
    const done = (s: ConceptSource, base: Concept[], deleted: Set<string>, c: string[] = []) => {
      if (!live) return;
      const baselineStr = serializeConcepts(base);
      setRows([]);
      setSource(s);
      setBaseMap(new Map(base.map((x) => [conceptId(x), x])));
      setBaseline(baselineStr);
      setDeletedIds(deleted);
      setTotal(s.total);
      setConflicts(c);
      setDirty(effectiveYaml(s.all(), deleted) !== baselineStr); // leftover unsaved edits → already dirty
    };
    if (repo) {
      loadDictionary({ ...repo, branch: loadPr(localStorage)?.branch ?? null, edits: loadEdits(localStorage) })
        .then(({ concepts, conflicts, base }) => {
          const bMap = new Map(base.map((x) => [conceptId(x), x]));
          const deleted = deletedIdsFromEdits(loadEdits(localStorage), bMap);
          // Re-insert the (held-for-display) deleted baseline rows so they stay visible until a Save.
          const display = [...concepts, ...[...deleted].map((id) => bMap.get(id)!)].sort(byConcept);
          done(createSource(display), base, deleted, conflicts);
        })
        .catch((e) => live && setError(String(e)));
    } else {
      createSeedSource(DEV_MULTIPLIER)
        .then((s) => done(s, s.all(), new Set()))
        .catch((e) => live && setError(String(e)));
    }
    return () => {
      live = false;
    };
  }, [repo, reloadKey]);

  // When the user's working PR is closed or merged, end the session: ask the service to delete the
  // (now stale) intent/<handle> branch, drop local edits, and reload clean from the base branch. Checked
  // on mount and whenever the tab regains focus (e.g. after closing the PR on GitHub in another tab).
  const resetIfPrClosed = useCallback(async () => {
    if (!service || !repo || !identity || !activePr) return;
    if ((await fetchPullState(repo.owner, repo.repo, activePr.number)) !== 'closed') return;
    try {
      await resetSession(service.serviceUrl, identity.jwt, activePr.branch); // delete the closed branch (best-effort)
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
    setReloadKey((k) => k + 1); // reload from base — drop the branch-reconciled view
  }, []);

  // Drop an expired/invalid session (keeping the PR pointer + local edits): the UI returns to
  // "signed out" so the editing affordances hide and a fresh sign-in mints a new token.
  const expireSession = useCallback(() => {
    clearIdentity(localStorage);
    setIdentity(null);
  }, []);

  // Proactively sign out the instant the session JWT expires (the service signs a sliding TTL), even
  // with no save attempt to surface a 401 first.
  useEffect(() => {
    if (!identity) return;
    const secs = secondsUntilExpiry(identity);
    if (secs == null) return; // no exp claim → nothing to schedule
    const t = setTimeout(() => {
      expireSession();
      setSaveError('Your session expired — you’ve been signed out. Sign in again to continue (your changes are kept).');
    }, Math.max(0, secs) * 1000);
    return () => clearTimeout(t);
  }, [identity, expireSession]);

  // Sliding session: on a visit, if a still-valid token has aged past its first day, swap it for a
  // fresh-TTL one so active users never have to re-auth. Loop-safe (the renewed token is fresh →
  // above the threshold) and graceful if /renew isn't deployed yet (a non-401 failure keeps the token).
  useEffect(() => {
    if (!service || !identity) return;
    const secs = secondsUntilExpiry(identity);
    if (secs == null || secs >= RENEW_BELOW_SECONDS) return; // fresh enough — no renew
    let live = true;
    void renewIdentity(service.serviceUrl, identity.jwt)
      .then((id) => {
        if (!live) return;
        saveIdentity(localStorage, id);
        setIdentity(id);
      })
      .catch((e) => {
        // Only a rejected session means sign out; a missing endpoint / offline keeps the current token.
        const msg = e instanceof Error ? e.message : String(e);
        if (live && /\b401\b|invalid session|unauthor/i.test(msg)) expireSession();
      });
    return () => {
      live = false;
    };
  }, [service, identity, expireSession]);

  const [theme, toggleTheme] = useTheme();

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

  // Recompute dirtiness and persist the cache after any local change. `nextDeleted` is the deletion set
  // to apply (passed explicitly because React state updates aren't yet visible synchronously).
  const persist = useCallback(
    (nextDeleted: Set<string>) => {
      if (!source || !baseMap || baseline == null) return;
      setDeletedIds(nextDeleted);
      setDirty(effectiveYaml(source.all(), nextDeleted) !== baseline);
      saveEdits(localStorage, computeEdits(source.all(), nextDeleted, baseMap));
    },
    [source, baseMap, baseline],
  );

  // "Done" — apply the edit/addition to the in-memory source (batched); the global Save submits later.
  const handleSave = useCallback(
    (updated: Concept) => {
      if (!source) return;
      if (creating) {
        source.add(updated);
        setRows((prev) => [...prev, updated].sort(byConcept)); // show it in canonical position
        setTotal(source.total);
      } else if (editing) {
        const id = conceptId(editing); // identity when opened — stable even if the edit renames it
        source.applyEdit(id, updated);
        setRows((prev) => prev.map((c) => (conceptId(c) === id ? updated : c)));
      }
      persist(deletedIds);
      setCreating(false);
      setEditing(null);
    },
    [editing, creating, source, deletedIds, persist],
  );

  // Mark/unmark a row for deletion (kept visible, red, until Save). A purely-local addition has nothing
  // on GitHub to delete, so it's dropped outright instead of being held.
  const setDeleted = useCallback(
    (concept: Concept, deleted: boolean) => {
      if (!source || !baseMap) return;
      const id = conceptId(concept);
      if (!baseMap.has(id)) {
        source.remove(id);
        setRows((prev) => prev.filter((c) => conceptId(c) !== id));
        setTotal(source.total);
        const next = new Set(deletedIds);
        next.delete(id);
        persist(next);
        return;
      }
      const next = new Set(deletedIds);
      if (deleted) next.add(id);
      else next.delete(id);
      persist(next);
    },
    [source, baseMap, deletedIds, persist],
  );

  // Row ✗: toggle the pending deletion (delete ⇄ restore).
  const toggleRowDelete = useCallback(
    (concept: Concept) => {
      if (!gated()) return;
      setDeleted(concept, !deletedIds.has(conceptId(concept)));
    },
    [gated, deletedIds, setDeleted],
  );

  const handleDelete = useCallback(() => {
    if (editing) setDeleted(editing, true);
    setEditing(null);
    setCreating(false);
  }, [editing, setDeleted]);

  // Classify each row for its background colour (added / changed / pending-deleted), vs the baseline.
  const changeKind = useCallback(
    (c: Concept): ChangeKind | null => (baseMap ? classifyChange(c, baseMap, deletedIds) : null),
    [baseMap, deletedIds],
  );

  const closeSavePrompt = useCallback(() => setSavePrompt(false), []);

  // "Save" → open the confirm modal: auto-generate the PR title + a Markdown description of the changes.
  const openSavePrompt = useCallback(() => {
    if (!source || !baseMap) return;
    if (!gated()) return;
    const preview = buildSubmission({
      concepts: source.all(),
      deletedIds,
      baseMap,
      handle: identity?.handle ?? 'me',
      activeBranch: activePr?.branch ?? null,
      description: '',
      now: new Date(),
    });
    setSaveTitle(preview.title);
    setSaveMessage(preview.description); // editable default; the user can refine it
    setSavePrompt(true);
  }, [source, baseMap, deletedIds, gated, identity, activePr]);

  // Submit the whole batch to the service (bot → intent/<handle> branch + PR), using the user's
  // description as the commit message. On success the pushed content becomes the new baseline, so the
  // session returns to a clean state.
  const submitBatch = useCallback(() => {
    if (!source || baseline == null || !baseMap) return;
    if (!gated()) return;
    if (!service || !identity) return; // local-only: nothing to submit
    // Reuse the open PR's branch (a new commit updates it); otherwise a fresh unique branch.
    const { content, branch, ...payload } = buildSubmission({
      concepts: source.all(),
      deletedIds,
      baseMap,
      handle: identity.handle,
      activeBranch: activePr?.branch ?? null,
      description: saveMessage,
      now: new Date(),
    });
    void (async () => {
      try {
        setSaving(true);
        setSaveError(null); // clear any prior failure on retry
        setSubmitState('Submitting…');
        const { prNumber, prUrl } = await submitToService(service.serviceUrl, identity.jwt, {
          content,
          branch,
          ...payload, // message, title, description
        });
        // Enact deletions, then adopt the pushed content as the new baseline (clean session).
        for (const id of deletedIds) source.remove(id);
        setRows((prev) => prev.filter((c) => !deletedIds.has(conceptId(c))));
        setTotal(source.total);
        setBaseMap(new Map(source.all().map((c) => [conceptId(c), c])));
        setBaseline(content);
        setDeletedIds(new Set());
        setDirty(false);
        saveEdits(localStorage, {});
        const isNewPr = !activePr || activePr.number !== prNumber;
        savePr(localStorage, { number: prNumber, url: prUrl, branch }); // track it so we can detect closure
        setActivePr({ number: prNumber, url: prUrl, branch });
        setSubmitState(isNewPr ? `PR #${prNumber}` : `PR #${prNumber} updated`);
        if (isNewPr) window.open(prUrl, '_blank', 'noopener'); // updates land on the same PR — no new tab
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // 401 = the service rejected our session token (expired/invalid) — sign out so the UI reflects
        // it, then tell the user to sign in again. Other failures keep the session and just report.
        if (/\b401\b|invalid session|token|unauthor/i.test(msg)) {
          expireSession();
          setSaveError('Your session expired — you’ve been signed out. Sign in again to save (your changes are kept).');
        } else {
          setSaveError(`Save failed: ${msg}`);
        }
        setSubmitState(null); // drop the "Submitting…" status; the toast carries the error
      } finally {
        setSaving(false);
        setSavePrompt(false); // close the confirm modal so the toast / red Save button are visible
      }
    })();
  }, [source, baseline, baseMap, deletedIds, gated, service, identity, activePr, saveMessage, expireSession]);

  const dismissSaveError = useCallback(() => setSaveError(null), []);

  // Editing affordances (Add entry / Save / row ✗) are shown only when the user can actually edit:
  // ungated in local-only mode (no service), otherwise only while signed in.
  const canEdit = !service || !!identity;

  // Filtering searches the WHOLE dictionary (source.all()) and shows every match unpaged; clearing the
  // filter resumes the paged prefix (`rows`).
  const filtering = filter.trim() !== '';
  const visible = filtering && source ? source.all().filter((c) => conceptMatches(c, filter)) : rows;

  return (
    <div className="app">
      <header className="app-header">
        <h1>MathML Intent Open Editor</h1>
        <div className="toolbar">
          <input
            ref={filterRef}
            type="search"
            placeholder="Filter concepts…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <span className="count" data-testid="concept-count" data-total={total}>
            {filtering
              ? `${visible.length.toLocaleString()} match${visible.length === 1 ? '' : 'es'}`
              : `${total.toLocaleString()} concepts${
                  source && rows.length < total ? ` · ${rows.length.toLocaleString()} loaded` : ''
                }`}
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
            data={visible}
            total={filtering ? visible.length : total}
            onEdit={canEdit ? openEditor : undefined}
            onLoadMore={filtering ? undefined : loadMore}
            editingId={editing ? conceptId(editing) : null}
            onDelete={canEdit ? toggleRowDelete : undefined}
            changeKind={changeKind}
            headerActions={
              canEdit ? (
                <>
                  <button type="button" className="add-entry" onClick={openCreate}>
                    + Add entry
                  </button>
                  {service && (
                    <button
                      type="button"
                      className={`save-batch${saveError ? ' error' : ''}`}
                      data-testid="save-batch"
                      disabled={!dirty || saving}
                      onClick={openSavePrompt}
                      title={
                        saveError ?? (dirty ? 'Submit all pending changes as one PR' : 'No pending changes')
                      }
                    >
                      {saving ? (
                        <>
                          <span className="spinner" aria-hidden="true" /> Saving…
                        </>
                      ) : saveError ? (
                        'Save failed'
                      ) : (
                        'Save'
                      )}
                    </button>
                  )}
                </>
              ) : null
            }
          />
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

      {/* "Describe your changes" confirm modal — its text becomes the PR commit message. */}
      <dialog
        ref={saveDialogRef}
        className="modal save-modal"
        aria-label="Describe your changes"
        onClose={closeSavePrompt}
        onClick={(e) => {
          if (e.target === saveDialogRef.current) closeSavePrompt();
        }}
      >
        <div className="save-prompt">
          <h2>Describe your changes</h2>
          <p className="save-prompt-hint">
            Opens/updates the GitHub pull request against the W3C Intent dictionary. The description is
            rendered as Markdown.
          </p>
          <div className="save-field">
            <span className="save-field-label">Pull request title</span>
            <div className="save-title" data-testid="save-title">
              {saveTitle}
            </div>
          </div>
          <label className="save-field">
            <span className="save-field-label">Description (Markdown)</span>
            <textarea
              data-testid="save-message"
              aria-label="Change description"
              rows={7}
              value={saveMessage}
              onChange={(e) => setSaveMessage(e.target.value)}
            />
          </label>
          <div className="actions">
            <button
              type="button"
              className="primary"
              data-testid="save-confirm"
              disabled={saving || saveMessage.trim() === ''}
              onClick={submitBatch}
            >
              {saving ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Submitting…
                </>
              ) : (
                'Submit pull request'
              )}
            </button>
            <button type="button" onClick={closeSavePrompt} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      </dialog>

      {saveError && <Toast message={saveError} onClose={dismissSaveError} />}
    </div>
  );
}
