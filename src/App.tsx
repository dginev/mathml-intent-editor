import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearEdits } from './data/editCache';
import { conceptId } from './data/conceptId';
import { buildConceptIndex } from './data/conceptIndex';
import { conceptMatches, matchRank } from './data/conceptMatch';
import { classifyChange, type ChangeKind } from './data/pendingChanges';
import { buildSubmission } from './github/submission';
import { useDictionary } from './hooks/useDictionary';
import { useIdentity } from './hooks/useIdentity';
import { useTheme } from './hooks/useTheme';
import { useGlobalFindShortcut } from './hooks/useGlobalFindShortcut';
import { ConceptTable } from './components/ConceptTable';
import { Toast } from './components/ui';
import { repoConfigFromEnv, serviceConfigFromEnv } from './github/config';
import { resetSession, submitToService } from './github/submitClient';
import { clearPr, fetchPullState, loadPr, savePr, type ActivePr } from './github/prSession';
import type { Concept } from './types';
import './App.css';

// The editor pulls in Temml (~the bulk of the bundle); load it only when a user starts editing.
const NotationEditor = lazy(() =>
  import('./components/NotationEditor').then((m) => ({ default: m.NotationEditor })),
);

const SESSION_EXPIRED =
  'Your session expired — you’ve been signed out. Sign in again to continue (your changes are kept).';

/** Read the deep-link filter from the current URL (`?filter=…`). */
const filterFromUrl = () => new URLSearchParams(window.location.search).get('filter') ?? '';

/** Read the deep-link speech language from the current URL (`?lang=…`, default English). */
const langFromUrl = () => new URLSearchParams(window.location.search).get('lang') ?? 'en';

export default function App() {
  const [filter, setFilter] = useState(filterFromUrl); // hydrate from ?filter= so the view is shareable
  const [speechLang, setSpeechLang] = useState(langFromUrl); // hydrate from ?lang= (Speech column)
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
  // Whether the open editor holds unsaved changes (reported by NotationEditor) — dismissing the modal
  // via backdrop/Esc then asks before discarding. A ref: it must not re-render App on every keystroke.
  const editorDirty = useRef(false);
  useGlobalFindShortcut(filterRef); // Ctrl/⌘+F focuses the (whole-dictionary) Filter

  // Reflect the filter into the URL (`?filter=…`) so it's shareable/deep-linkable, preserving any other
  // query params. replaceState (not push) so each keystroke doesn't pile up history entries.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if ((params.get('filter') ?? '') === filter) return; // already in sync (incl. the hydrated load)
    if (filter) params.set('filter', filter);
    else params.delete('filter');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  }, [filter]);

  // Reflect the Speech-column language into `?lang=` the same way (English is the default → no param).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if ((params.get('lang') ?? 'en') === speechLang) return;
    if (speechLang !== 'en') params.set('lang', speechLang);
    else params.delete('lang');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  }, [speechLang]);

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

  // Identity + session lifecycle (OAuth completion, sliding-TTL token, proactive sign-out, renew). The
  // status-line message + the expiry toast are page concerns, delivered via callbacks.
  const [submitState, setSubmitState] = useState<string | null>(null);
  const { identity, authPending, signIn, expireSession } = useIdentity({
    service,
    // Sign-in failures (incl. OAuth `?error=` returns) reach the user via the Toast — the status line is
    // hidden while signed out, which is exactly when these occur. Same channel as a session expiry.
    onSignInError: setSaveError,
    onSessionExpired: () => setSaveError(SESSION_EXPIRED),
  });

  // Sign out: drop the identity AND the PR pointer, then reload from base (no branch-reconciled view).
  const signOut = useCallback(() => {
    expireSession();
    clearPr(localStorage);
    setActivePr(null);
    setSubmitState(null);
    setReloadKey((k) => k + 1);
  }, [expireSession]);

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
    setEditing({ slug: '', notations: [], links: [], alias: [] });
  }, [gated]);

  const closeModal = useCallback(() => {
    editorDirty.current = false;
    setEditing(null);
    setCreating(false);
  }, []);

  /** Backdrop/Esc dismissal: silently fine when clean, but unsaved edits ask before being discarded. */
  const confirmDiscard = useCallback(
    () => !editorDirty.current || window.confirm('Discard your unsaved changes to this concept?'),
    [],
  );

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

  // Filtering searches the WHOLE dictionary and shows every match unpaged, ranked by which cell matched
  // (concept → speech → area → alias); a stable sort keeps canonical order within each rank. Clearing
  // the filter resumes the paged prefix.
  const filtering = filter.trim() !== '';
  const visible = filtering
    ? concepts
        .filter((c) => conceptMatches(c, filter))
        .map((c) => ({ c, rank: matchRank(c, filter) }))
        .sort((a, b) => a.rank - b.rank)
        .map((x) => x.c)
    : concepts.slice(0, loadedCount);
  // Languages present in the dictionary (en first, rest sorted) — the Speech column's dropdown options.
  const languages = useMemo(() => {
    const rest = new Set<string>();
    for (const c of concepts) for (const s of c.speech ?? []) if (s.lang && s.lang !== 'en') rest.add(s.lang);
    return ['en', ...[...rest].sort()];
  }, [concepts]);
  // All concept names — the editor highlights an alias that names a known concept.
  const knownSlugs = useMemo(() => new Set(concepts.map((c) => c.slug)), [concepts]);
  // Dictionary-wide indexes for the editor's authoring helpers (related concepts + alias warnings).
  const conceptIndex = useMemo(() => buildConceptIndex(concepts), [concepts]);

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
            languages={languages}
            speechLang={speechLang}
            onSpeechLangChange={setSpeechLang}
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
        onCancel={(e) => {
          if (!confirmDiscard()) e.preventDefault(); // Esc with unsaved edits → keep the modal open
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current && confirmDiscard()) closeModal(); // backdrop click
        }}
      >
        {editing && (
          <Suspense fallback={<p className="status">Loading editor…</p>}>
            <NotationEditor
              concept={editing}
              onSave={handleSave}
              onDelete={creating ? undefined : handleDelete} // nothing to delete for a brand-new row
              onCancel={closeModal}
              onDirtyChange={(d) => (editorDirty.current = d)}
              knownSlugs={knownSlugs}
              index={conceptIndex}
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
