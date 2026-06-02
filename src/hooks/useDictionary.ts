import { useEffect, useReducer, type Dispatch } from 'react';
import { loadDictionary } from '../data/loadDictionary';
import { loadSeed } from '../data/loadSeed';
import { loadEdits, saveEdits } from '../data/editCache';
import { conceptId } from '../data/conceptId';
import { byConcept, serializeConcepts } from '../data/serialize';
import { computeEdits, deletedIdsFromEdits, effectiveYaml, type BaseMap } from '../data/pendingChanges';
import { loadPr } from '../github/prSession';
import type { Concept } from '../types';

/** Clone the small synthetic seed fixture this many times to exercise the table at the 10k+ row target. */
const DEV_MULTIPLIER = 1200;
/** Rows revealed per page — the initial load and each page-down increment (~a couple of viewports). */
const PAGE = 50;

type RepoConfig = { owner: string; repo: string; baseBranch: string; filePath: string };

/**
 * The working set as one immutable value: the full `concepts` list (canonical order, including
 * held-for-display deletions), how many are paged into view, the GitHub baseline to diff against, the
 * pending deletions, and whether a Save would change the file. All edits are reducer transitions, so
 * there's no mutable source mirrored into parallel React state — and the edit cache is persisted as a
 * derived effect, not inline in every handler.
 */
export type DictState = {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  concepts: Concept[];
  loadedCount: number;
  baseMap: BaseMap;
  baseline: string;
  deletedIds: Set<string>;
  dirty: boolean;
  conflicts: string[];
};

export type DictAction =
  | { type: 'loading' }
  | { type: 'error'; error: string }
  | { type: 'loaded'; concepts: Concept[]; base: Concept[]; deletedIds: Set<string>; conflicts: string[] }
  | { type: 'loadMore' }
  | { type: 'edit'; id: string; updated: Concept }
  | { type: 'add'; concept: Concept }
  | { type: 'setDeleted'; concept: Concept; deleted: boolean }
  | { type: 'committed'; content: string };

const initial: DictState = {
  status: 'loading',
  error: null,
  concepts: [],
  loadedCount: 0,
  baseMap: new Map(),
  baseline: '',
  deletedIds: new Set(),
  dirty: false,
  conflicts: [],
};

/** "Dirty" = the content we'd submit (deletions excluded) differs from the baseline. */
const isDirty = (concepts: readonly Concept[], deletedIds: ReadonlySet<string>, baseline: string) =>
  effectiveYaml(concepts, deletedIds) !== baseline;

function reduce(s: DictState, a: DictAction): DictState {
  switch (a.type) {
    case 'loading':
      return { ...s, status: 'loading', error: null };
    case 'error':
      return { ...s, status: 'error', error: a.error };
    case 'loaded': {
      const baseMap = new Map(a.base.map((c) => [conceptId(c), c]));
      const baseline = serializeConcepts(a.base);
      return {
        status: 'ready',
        error: null,
        concepts: a.concepts,
        loadedCount: Math.min(PAGE, a.concepts.length),
        baseMap,
        baseline,
        deletedIds: a.deletedIds,
        conflicts: a.conflicts,
        dirty: isDirty(a.concepts, a.deletedIds, baseline),
      };
    }
    case 'loadMore':
      return { ...s, loadedCount: Math.min(s.loadedCount + PAGE, s.concepts.length) };
    case 'edit': {
      const concepts = s.concepts.map((c) => (conceptId(c) === a.id ? a.updated : c));
      return { ...s, concepts, dirty: isDirty(concepts, s.deletedIds, s.baseline) };
    }
    case 'add': {
      const concepts = [...s.concepts, a.concept].sort(byConcept);
      const idx = concepts.findIndex((c) => conceptId(c) === conceptId(a.concept));
      return {
        ...s,
        concepts,
        loadedCount: Math.min(Math.max(s.loadedCount + 1, idx + 1), concepts.length), // keep it visible
        dirty: isDirty(concepts, s.deletedIds, s.baseline),
      };
    }
    case 'setDeleted': {
      const id = conceptId(a.concept);
      if (!s.baseMap.has(id)) {
        // a purely-local addition has nothing on GitHub to delete → drop it outright
        const concepts = s.concepts.filter((c) => conceptId(c) !== id);
        const deletedIds = new Set(s.deletedIds);
        deletedIds.delete(id);
        return {
          ...s,
          concepts,
          loadedCount: Math.min(s.loadedCount, concepts.length),
          deletedIds,
          dirty: isDirty(concepts, deletedIds, s.baseline),
        };
      }
      const deletedIds = new Set(s.deletedIds);
      if (a.deleted) deletedIds.add(id);
      else deletedIds.delete(id);
      return { ...s, deletedIds, dirty: isDirty(s.concepts, deletedIds, s.baseline) };
    }
    case 'committed': {
      // The pushed content is the new baseline: drop the deleted rows, re-key the baseline, go clean.
      const concepts = s.concepts.filter((c) => !s.deletedIds.has(conceptId(c)));
      const baseMap = new Map(concepts.map((c) => [conceptId(c), c]));
      return {
        ...s,
        concepts,
        loadedCount: Math.min(s.loadedCount, concepts.length),
        baseMap,
        baseline: a.content,
        deletedIds: new Set(),
        dirty: false,
      };
    }
  }
}

/**
 * Load + maintain the working set. Reads the base from GitHub (the active PR branch when one is tracked,
 * else `main`) reconciled with the local edit cache, or the seed fixture when no repo is configured.
 * `reloadKey` forces a fresh load (sign-out, PR-close reset). Returns `[state, dispatch]`.
 */
export function useDictionary(
  repo: RepoConfig | null,
  reloadKey: number,
): readonly [DictState, Dispatch<DictAction>] {
  const [state, dispatch] = useReducer(reduce, initial);

  useEffect(() => {
    let live = true;
    dispatch({ type: 'loading' });
    void (async () => {
      try {
        if (repo) {
          const edits = loadEdits(localStorage);
          const pr = loadPr(localStorage);
          const { concepts, conflicts, base } = await loadDictionary({
            ...repo,
            branch: pr?.branch ?? null,
            branchOwner: pr?.headOwner ?? null, // the branch lives in the user's fork
            edits,
          });
          const bMap = new Map(base.map((c) => [conceptId(c), c]));
          const deleted = deletedIdsFromEdits(edits, bMap);
          // Re-insert held-for-display deleted baseline rows so they stay visible (red) until a Save.
          const display = [...concepts, ...[...deleted].map((id) => bMap.get(id)!)].sort(byConcept);
          if (live) dispatch({ type: 'loaded', concepts: display, base, deletedIds: deleted, conflicts });
        } else {
          const seed = await loadSeed(DEV_MULTIPLIER);
          if (live) dispatch({ type: 'loaded', concepts: seed, base: seed, deletedIds: new Set(), conflicts: [] });
        }
      } catch (e) {
        if (live) dispatch({ type: 'error', error: String(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [repo, reloadKey]);

  // Persist the edit cache as a pure derivation of the working set (covers reload + raw-CDN lag).
  useEffect(() => {
    if (state.status === 'ready') {
      saveEdits(localStorage, computeEdits(state.concepts, state.deletedIds, state.baseMap));
    }
  }, [state.status, state.concepts, state.deletedIds, state.baseMap]);

  return [state, dispatch];
}
