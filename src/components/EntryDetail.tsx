import { useEffect, useRef, useState, type ReactNode } from 'react';
import ISO6391 from 'iso-639-1';
import type { Concept, Notation } from '../types';
import type { ChangeKind } from '../data/pendingChanges';
import { MathML } from './MathML';
import { texToIntent } from '../render/intent';
import { loadTemml, type TemmlEngine } from '../render/temmlEngine';

/**
 * A read-only **full-entry** preview for the review workflow — the whole `open.yml` entry, including the
 * secondary fields the table hides (every notation, every speech language, aliases, links, and any
 * unmodeled raw keys such as `comments`/legacy `notation*` sketches). For a *changed* entry it shows the
 * current `main` version and the PR's proposed version side by side, with the differing fields flagged,
 * so a reviewer can see exactly what a PR does to an entry without opening the raw diff.
 */

const KIND_LABEL: Record<ChangeKind, string> = { added: 'Added', changed: 'Edited', deleted: 'Deleted' };

/** Raw keys we surface through dedicated fields; the rest land in "Other fields" so nothing is hidden. */
const MODELED_RAW_KEYS = new Set(['concept', 'arity', 'en', 'area', 'property', 'notations', 'mathml', 'tex', 'urls', 'alias']);

/** Rich MathML for a single notation: re-rendered from `tex` when possible, else the stored `mathml`. */
function notationMarkupFor(n: Notation, slug: string, engine: TemmlEngine | null): string {
  const tex = n.tex?.trim();
  if (tex && engine) {
    const r = texToIntent(engine, tex, slug);
    if (r.ok) return r.mathml;
  }
  return n.mathml;
}

/** Modeled fields that differ between the current and proposed entry — used to flag changed rows. */
function changedFields(base: Concept, c: Concept): Set<string> {
  const s = new Set<string>();
  const cmp = (k: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) s.add(k);
  };
  cmp('en', base.en, c.en);
  cmp('area', base.area, c.area);
  cmp('property', base.property, c.property);
  cmp('notations', base.notations, c.notations);
  cmp('links', base.links, c.links);
  cmp('alias', base.alias, c.alias);
  const langs = new Set([...(base.speech ?? []), ...(c.speech ?? [])].map((x) => x.lang));
  for (const lang of langs) {
    cmp(`speech:${lang}`, base.speech?.find((x) => x.lang === lang)?.text, c.speech?.find((x) => x.lang === lang)?.text);
  }
  return s;
}

const langName = (l: string) => ISO6391.getName(l) || l;

function Field({ id, label, changed, children }: { id: string; label: string; changed: ReadonlySet<string>; children: ReactNode }) {
  const isChanged = changed.has(id);
  return (
    <div className={`entry-field${isChanged ? ' field-changed' : ''}`}>
      <dt>
        {label}
        {isChanged && (
          <span className="field-changed-dot" title="differs from main" aria-label="changed field">
            ●
          </span>
        )}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/** One full entry rendered as a labelled field list. `changed` flags fields that differ from the other side. */
function EntryCard({
  concept,
  engine,
  changed,
  label,
  tone,
}: {
  concept: Concept;
  engine: TemmlEngine | null;
  changed: ReadonlySet<string>;
  label: string;
  tone: 'current' | 'proposed' | 'add' | 'del';
}) {
  const otherRaw = Object.entries(concept.raw ?? {}).filter(
    ([k, v]) => !MODELED_RAW_KEYS.has(k) && !ISO6391.validate(k) && v != null && v !== '',
  );
  return (
    <section className={`entry-card tone-${tone}`}>
      <h3 className="entry-card-label">{label}</h3>
      <dl className="entry-fields">
        <Field id="concept" label="Concept" changed={changed}>
          <code>{concept.slug}</code>
        </Field>
        {concept.arity != null && (
          <Field id="arity" label="Arity" changed={changed}>
            {concept.arity}
          </Field>
        )}
        {concept.property && (
          <Field id="property" label="Property" changed={changed}>
            {concept.property}
          </Field>
        )}
        {concept.area && (
          <Field id="area" label="Area" changed={changed}>
            {concept.area}
          </Field>
        )}
        {concept.en != null && concept.en !== '' && (
          <Field id="en" label="Speech (en — English)" changed={changed}>
            <span lang="en">{concept.en}</span>
          </Field>
        )}
        {concept.speech?.map((s) => (
          <Field key={s.lang} id={`speech:${s.lang}`} label={`Speech (${s.lang} — ${langName(s.lang)})`} changed={changed}>
            <span lang={s.lang}>{s.text}</span>
          </Field>
        ))}
        <Field id="notations" label={`Notations (${concept.notations.length})`} changed={changed}>
          {concept.notations.length === 0 ? (
            <span className="muted">none</span>
          ) : (
            <ul className="notation-list">
              {concept.notations.map((n, i) => (
                <li key={i}>
                  <MathML markup={notationMarkupFor(n, concept.slug, engine)} className="mathml-detail" />
                  {i === 0 && <span className="primary-badge">primary</span>}
                  <code className="notation-src">{n.tex ?? n.mathml}</code>
                </li>
              ))}
            </ul>
          )}
        </Field>
        {concept.alias.length > 0 && (
          <Field id="alias" label={`Aliases (${concept.alias.length})`} changed={changed}>
            <ul className="chip-list">
              {concept.alias.map((a, i) => (
                <li key={i}>
                  <code>{a}</code>
                </li>
              ))}
            </ul>
          </Field>
        )}
        {concept.links.length > 0 && (
          <Field id="links" label={`Links (${concept.links.length})`} changed={changed}>
            <ul className="chip-list">
              {concept.links.map((url, i) => (
                <li key={i}>
                  <a href={url} target="_blank" rel="noreferrer">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </Field>
        )}
        {otherRaw.map(([k, v]) => (
          <Field key={k} id={`raw:${k}`} label={k} changed={changed}>
            <span className="raw-value">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
          </Field>
        ))}
      </dl>
    </section>
  );
}

const EMPTY: ReadonlySet<string> = new Set();

export function EntryDetail({
  concept,
  base,
  kind,
  onClose,
}: {
  /** The row being previewed (the PR's proposed entry; the base row itself for a deletion). Null = closed. */
  concept: Concept | null;
  /** The current `main` entry, when one exists — present for a changed/deleted row. */
  base: Concept | undefined;
  /** How this row differs from main (added / changed / deleted), or null for an unchanged row. */
  kind: ChangeKind | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [engine, setEngine] = useState<TemmlEngine | null>(null);

  // Drive the modal from `concept` (showModal centres + traps focus; close() restores focus).
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (concept && !d.open) d.showModal();
    else if (!concept && d.open) d.close();
  }, [concept]);

  // Load Temml only when a previewed notation has `tex` to re-render richly (else stored mathml suffices).
  useEffect(() => {
    if (!concept || engine) return;
    const needs = [concept, base].some((c) => c?.notations.some((n) => n.tex?.trim()));
    if (!needs) return;
    let live = true;
    loadTemml().then((e) => live && setEngine(e));
    return () => {
      live = false;
    };
  }, [concept, base, engine]);

  const changed = concept && base && kind === 'changed' ? changedFields(base, concept) : EMPTY;

  return (
    <dialog
      ref={ref}
      className="modal entry-detail"
      aria-label={concept ? `Full entry: ${concept.slug}` : undefined}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(); // backdrop click
      }}
    >
      {concept && (
        <div className="entry-detail-body">
          <div className="entry-detail-head">
            <h2>
              <code>{concept.slug}</code>
              {concept.arity != null && <span className="entry-arity"> · arity {concept.arity}</span>}
            </h2>
            {kind && <span className={`kind-badge kind-${kind}`}>{KIND_LABEL[kind]}</span>}
          </div>

          <div className={`entry-cards ${kind === 'changed' ? 'two' : 'one'}`}>
            {kind === 'changed' && base ? (
              <>
                <EntryCard concept={base} engine={engine} changed={changed} label="Current — on main" tone="current" />
                <EntryCard concept={concept} engine={engine} changed={changed} label="Proposed — in this PR" tone="proposed" />
              </>
            ) : kind === 'deleted' ? (
              <EntryCard concept={base ?? concept} engine={engine} changed={EMPTY} label="Being removed by this PR" tone="del" />
            ) : kind === 'added' ? (
              <EntryCard concept={concept} engine={engine} changed={EMPTY} label="Added by this PR" tone="add" />
            ) : (
              <EntryCard concept={concept} engine={engine} changed={EMPTY} label="Entry" tone="current" />
            )}
          </div>

          <div className="actions">
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
