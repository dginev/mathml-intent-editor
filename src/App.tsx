import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearEdits } from './data/editCache';
import { conceptId } from './data/conceptId';
import { conceptMatches } from './data/conceptMatch';
import { classifyChange, type ChangeKind } from './data/pendingChanges';
import { buildSubmission } from './github/submission';
import { useDictionary } from './hooks/useDictionary';
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

/** Renew the session on a visit once it has dipped below this many seconds (6 of its 7 days) — keeps an
 *  active user signed in indefinitely without renewing a token that was just minted. */
const RENEW_BELOW_SECONDS = 6 * 24 * 60 * 60;

export default function App() {
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Concept | null>(null);
  const [creating, setCreating] = useState(false); // the open modal is for a brand-new concept
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null); // last Save failure → red button + toast
  const [savePrompt, setSavePrompt] = useState(false); // the "describe your changes" confirm modal
  const [saveTitle, setSaveTitle] = useState(''); // auto PR title (read-only preview)
  const [saveMessage, setSaveMessage] = useState(''); // the (editable) Markdown PR description
  // The PR the user's branch terminates in; when it closes/merges we reset the session and reload.
  const [activePr, setActivePr] = useState<ActivePr | null>(() => loadPr(localStorage));
  const [reloadKey, setReloadKey] = useState(0); // bump to force a fresh dictionary load
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

  // The working set (load + paging + edits) lives in one reducer — no mutable source / parallel state.
  const [dict, dispatch] = useDictionary(repo, reloadKey);
  const { concepts, loadedCount, baseMap, deletedIds, dirty, conflicts } = dict;
  const ready = dict.status === 'ready';
  const total = concepts.length;

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

  // Reveal the next page (the reducer caps it at the row count; the first page shows on load).
  const loadMore = useCallback(() => dispatch({ type: 'loadMore' }), [dispatch]);

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

  // "Done" — apply the edit/addition to the working set (batched); the global Save submits later.
  const handleSave = useCallback(
    (updated: Concept) => {
      if (creating) dispatch({ type: 'add', concept: updated });
      else if (editing) dispatch({ type: 'edit', id: conceptId(editing), updated }); // id when opened (rename-safe)
      setCreating(false);
      setEditing(null);
    },
    [editing, creating, dispatch],
  );

  // Row ✗: toggle the pending deletion (delete ⇄ restore). Held visible (red) until Save.
  const toggleRowDelete = useCallback(
    (concept: Concept) => {
      if (!gated()) return;
      dispatch({ type: 'setDeleted', concept, deleted: !deletedIds.has(conceptId(concept)) });
    },
    [gated, deletedIds, dispatch],
  );

  const handleDelete = useCallback(() => {
    if (editing) dispatch({ type: 'setDeleted', concept: editing, deleted: true });
    setEditing(null);
    setCreating(false);
  }, [editing, dispatch]);

  // Classify each row for its background colour (added / changed / pending-deleted), vs the baseline.
  const changeKind = useCallback(
    (c: Concept): ChangeKind | null => classifyChange(c, baseMap, deletedIds),
    [baseMap, deletedIds],
  );

  const closeSavePrompt = useCallback(() => setSavePrompt(false), []);

  // "Save" → open the confirm modal: auto-generate the PR title + a Markdown description of the changes.
  const openSavePrompt = useCallback(() => {
    if (!ready) return;
    if (!gated()) return;
    const preview = buildSubmission({
      concepts,
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
  }, [ready, concepts, baseMap, deletedIds, gated, identity, activePr]);

  // Submit the whole batch to the service (bot → intent/<handle> branch + PR), using the user's
  // description as the commit message. On success the pushed content becomes the new baseline, so the
  // session returns to a clean state.
  const submitBatch = useCallback(() => {
    if (!ready) return;
    if (!gated()) return;
    if (!service || !identity) return; // local-only: nothing to submit
    // Reuse the open PR's branch (a new commit updates it); otherwise a fresh unique branch.
    const { content, branch, ...payload } = buildSubmission({
      concepts,
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
        // Enact deletions + adopt the pushed content as the new baseline (clean session); cache cleared
        // by the persist effect.
        dispatch({ type: 'committed', content });
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
  }, [ready, concepts, baseMap, deletedIds, gated, service, identity, activePr, saveMessage, dispatch, expireSession]);

  const dismissSaveError = useCallback(() => setSaveError(null), []);

  // Editing affordances (Add entry / Save / row ✗) are shown only when the user can actually edit:
  // ungated in local-only mode (no service), otherwise only while signed in.
  const canEdit = !service || !!identity;

  // Filtering searches the WHOLE dictionary and shows every match unpaged; clearing the filter resumes
  // the paged prefix.
  const filtering = filter.trim() !== '';
  const visible = filtering ? concepts.filter((c) => conceptMatches(c, filter)) : concepts.slice(0, loadedCount);
  // All concept names — the editor highlights an alias that names a known concept.
  const knownSlugs = useMemo(() => new Set(concepts.map((c) => c.slug)), [concepts]);

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
                  ready && loadedCount < total ? ` · ${loadedCount.toLocaleString()} loaded` : ''
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
        {dict.error && <p className="error">{dict.error}</p>}
        {!ready && !dict.error && <p className="status">Loading dictionary…</p>}
        {ready && (
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
              knownSlugs={knownSlugs}
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
