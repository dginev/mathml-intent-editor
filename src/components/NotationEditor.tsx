import { useEffect, useMemo, useState } from 'react';
import ISO6391 from 'iso-639-1';
import { missingSpeechRefs, texToIntent, unusedArgRefs } from '../render/intent';
import { minifyMathml } from '../render/minifyMathml';
import { loadTemml, type TemmlEngine } from '../render/temmlEngine';
import { MathML } from './MathML';
import { MathMLSource } from './MathMLSource';
import { IconButton, InfoPopover, RowControls } from './ui';
import { aliasWarnings, relatedConcepts, type ConceptIndex } from '../data/conceptIndex';
import { uniq } from '../uniq';
import type { Concept } from '../types';

/** One editable speech template row: a stable id, an ISO 639-1 language code, the template, and edit state. */
type SpeechRow = { id: number; lang: string; text: string; editing: boolean };

/** One editable link/alias row: a stable id (edit state survives add/remove), its value, and edit state. */
type EditRow = { id: number; value: string; editing: boolean };

/** All ISO 639-1 codes, for the language autocomplete (`<datalist>`). */
const LANG_CODES = ISO6391.getAllCodes();

const NO_SLUGS: ReadonlySet<string> = new Set();

/** Next stable row id: one past the current max, so it stays unique as rows are added/removed. */
const nextId = (rows: { id: number }[]) => rows.reduce((m, r) => Math.max(m, r.id), -1) + 1;

/** A fresh link/alias/notation row (blank, open for editing). */
const blankEntry = () => ({ value: '' });

/** True if a string isn't well-formed XML (used to validate raw-MathML notations before saving). */
const xmlError = (s: string): boolean =>
  new DOMParser().parseFromString(s, 'application/xml').querySelector('parsererror') !== null;
/** A fresh speech row — the first one defaults to English, later ones start with an empty code. */
const blankSpeech = (rows: SpeechRow[]) => ({
  lang: rows.some((r) => r.lang.trim() === 'en') ? '' : 'en',
  text: '',
});

/**
 * State + operations for one of the editor's row lists (links, aliases, speech). `patch` updates any
 * subset of a row's fields, `add` appends a fresh row (from `blank`) open for editing, `remove` drops
 * one. New ids are computed inside the (deferred) updater, so no render-time ref is needed.
 */
function useRowList<T extends { id: number; editing: boolean }>(
  init: () => T[],
  blank: (rows: T[]) => Omit<T, 'id' | 'editing'>,
) {
  const [rows, setRows] = useState<T[]>(init);
  const ops = useMemo(
    () => ({
      patch: (id: number, p: Partial<T>) =>
        setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r))),
      add: () => setRows((rs) => [...rs, { id: nextId(rs), editing: true, ...blank(rs) } as T]),
      remove: (id: number) => setRows((rs) => rs.filter((r) => r.id !== id)),
    }),
    [blank],
  );
  return [rows, ops] as const;
}

/** Short guidance on how to name a concept, surfaced from the Concept field's ⓘ button. */
function NamingGuide() {
  return (
    <div className="legend-note naming-guide" data-testid="naming-help">
      <p>
        Name a concept by its common <strong>English name</strong>, lowercase, with words joined by
        hyphens — e.g. <code>additive-inverse</code>, <code>abelian-group</code>.
      </p>
      <ul>
        <li>
          Prefer the everyday name over the formal one: <code>power</code> not{' '}
          <code>exponentiation</code>, <code>gcd</code> not <code>greatest-common-divisor</code>.
        </li>
        <li>
          A name <em>and its arity together</em> identify a concept; the same name may recur at
          different arities (<code>disjoint-union</code> at 1 and 2). Set arity to the argument count.
        </li>
        <li>
          Speak each argument positionally with <code>$</code> (<code>$x</code>, <code>$1</code>); arg
          names must start with a letter.
        </li>
        <li>Scan “Related concepts” below first, so you don’t add a duplicate.</li>
      </ul>
      <p>
        See the{' '}
        <a href="https://w3c.github.io/mathml-docs/concept-lists/" target="_blank" rel="noreferrer">
          W3C concept lists
        </a>{' '}
        and the{' '}
        <a href="https://w3c.github.io/mathml-docs/intent/" target="_blank" rel="noreferrer">
          Intent spec
        </a>
        .
      </p>
    </div>
  );
}

function MacroLegend() {
  return (
    <table className="legend" data-testid="legend">
      <thead>
        <tr>
          <th>Macro</th>
          <th>Use</th>
          <th>Example</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>{'\\arg{name}'}</code>
          </td>
          <td>mark an argument</td>
          <td>
            <code>{'\\arg{argname}{value}'}</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>{'\\intent{expr}{notation}'}</code>
          </td>
          <td>mark an intent expression</td>
          <td>
            <code>{'\\intent{biconditional($lhs,$rhs)}{\\arg{lhs}{A}\\iff\\arg{rhs}{B}}'}</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>{'\\MathMLarg'}</code>,<br />
            <code>{'\\MathMLintent'}</code>
          </td>
          <td>official aliases of the above</td>
          <td>
            <code>{'\\MathMLarg{x}{n}'}</code>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * Full row editor (shown in the modal): every field of a concept is editable, the notation is authored
 * in TeX with a live MathML preview, and the row can be deleted. `onSave` receives the updated Concept;
 * `onDelete` removes it. The original `concept.raw` rides along (via the spread) for lossless writes.
 */
export function NotationEditor({
  concept,
  onSave,
  onDelete,
  onCancel,
  knownSlugs = NO_SLUGS,
  index,
}: {
  concept: Concept;
  onSave: (updated: Concept) => void;
  onDelete?: () => void;
  onCancel?: () => void;
  /** All concept names in the dictionary — an alias highlights when it names a known concept. */
  knownSlugs?: ReadonlySet<string>;
  /** Dictionary-wide index powering the "related concepts" overview + alias-collision warnings. */
  index?: ConceptIndex;
}) {
  const isNew = concept.slug === ''; // a brand-new row (opened via "Add entry") starts slug-less
  const [slug, setSlug] = useState(concept.slug);
  const [area, setArea] = useState(concept.area ?? '');
  const [arity, setArity] = useState(concept.arity != null ? String(concept.arity) : '');
  const [property, setProperty] = useState(concept.property ?? '');
  const [tex, setTex] = useState(concept.tex ?? '');

  const [linkRows, linkOps] = useRowList<EditRow>(
    () => concept.links.map((value, i) => ({ id: i, value, editing: false })),
    blankEntry,
  );
  const [aliasRows, aliasOps] = useRowList<EditRow>(
    () => concept.alias.map((value, i) => ({ id: i, value, editing: false })),
    blankEntry,
  );
  // Speech is a list of language-keyed templates; `en` is just the first entry, the rest are extra languages.
  const [speechRows, speechOps] = useRowList<SpeechRow>(() => {
    const rows: SpeechRow[] = [];
    if (concept.en != null) rows.push({ id: 0, lang: 'en', text: concept.en, editing: false });
    for (const s of concept.speech ?? [])
      rows.push({ id: rows.length, lang: s.lang, text: s.text, editing: false });
    return rows;
  }, blankSpeech);

  // Notation is authored EITHER as TeX (rendered to MathML) OR as raw MathML, seeded with the current.
  const [mode, setMode] = useState<'tex' | 'mathml'>('tex');
  const [rawMathml, setRawMathml] = useState(concept.mathml[0] ?? '');
  // Additional renderings (mathml[1..]) — edited as raw MathML so stale arg/intent names can be fixed.
  const [extraRows, extraOps] = useRowList<EditRow>(
    () => concept.mathml.slice(1).map((value, i) => ({ id: i, value, editing: false })),
    blankEntry,
  );

  const [engine, setEngine] = useState<TemmlEngine | null>(null);
  useEffect(() => {
    let live = true;
    loadTemml().then((e) => live && setEngine(e));
    return () => {
      live = false;
    };
  }, []);

  const hasTex = tex.trim() !== '';
  // TeX mode: render to MathML (intent name comes from the editable slug).
  const texResult = useMemo(
    () => (engine && hasTex ? texToIntent(engine, tex, slug) : null),
    [engine, hasTex, tex, slug],
  );
  // Raw mode: check the typed MathML is well-formed XML.
  const rawError = useMemo(
    () => (mode === 'mathml' && rawMathml.trim() !== '' && xmlError(rawMathml) ? 'Malformed XML / MathML' : null),
    [mode, rawMathml],
  );
  // Any non-empty additional notation that's malformed blocks saving.
  const extraBlocks = useMemo(
    () => extraRows.some((r) => r.value.trim() !== '' && xmlError(r.value)),
    [extraRows],
  );

  // Resolve the active notation per mode: the MathML it produces (null = keep the existing one), its
  // error, and whether that error blocks saving.
  const texMathml = mode === 'tex' && hasTex && texResult?.ok ? `<math>${texResult.mathml}</math>` : null;
  const rawMathmlOut = mode === 'mathml' && rawMathml.trim() !== '' && !rawError ? rawMathml.trim() : null;
  const newMathml: string | null = mode === 'tex' ? texMathml : rawMathmlOut;
  const notationError = mode === 'tex' ? (hasTex && texResult && !texResult.ok ? texResult.error : null) : rawError;
  const notationBlocks = mode === 'tex' ? hasTex && (!engine || !texResult?.ok) : !!rawError;
  const canSave = slug.trim() !== '' && !notationBlocks && !extraBlocks;

  // What the preview + validation use: the new notation, else the concept's existing first rendering.
  // This is the RICH form (full Temml markup) — the web preview should look polished.
  const effectiveMathml = newMathml ?? concept.mathml[0] ?? null;
  // What actually gets written to open.yml: the lean, minified form. Only the TeX-derived notation is
  // minified; raw-MathML authoring is stored exactly as typed. Shown in the "MathML source" panel.
  const storedMathml = useMemo(
    () => (mode === 'tex' && newMathml ? minifyMathml(newMathml) : effectiveMathml),
    [mode, newMathml, effectiveMathml],
  );
  // Validation spans all languages: a `$ref` in any template, an `arg` referenced by none of them.
  const allSpeech = useMemo(() => speechRows.map((r) => r.text).join('\n'), [speechRows]);
  const missingRefs = useMemo(
    () => (effectiveMathml ? missingSpeechRefs(allSpeech, effectiveMathml) : []),
    [allSpeech, effectiveMathml],
  );
  const unusedArgs = useMemo(
    () => (effectiveMathml && allSpeech.trim() !== '' ? unusedArgRefs(allSpeech, effectiveMathml) : []),
    [allSpeech, effectiveMathml],
  );
  const invalidLangs = useMemo(
    () => speechRows.map((r) => r.lang.trim()).filter((l) => l !== '' && !ISO6391.validate(l)),
    [speechRows],
  );

  // Authoring helpers (only when the dictionary index is supplied): concepts related to what's being
  // authored (dedup aid) and warnings about aliases that collide with other concepts. `concept.slug`
  // (the row's original identity) is excluded so a concept never flags itself or its own aliases.
  const typedAliases = useMemo(() => aliasRows.map((r) => r.value), [aliasRows]);
  const related = useMemo(
    () =>
      index ? relatedConcepts(index, { slug, aliases: typedAliases, area }, concept.slug) : { items: [], total: 0 },
    [index, slug, typedAliases, area, concept.slug],
  );
  const aliasWarns = useMemo(
    () => (index ? aliasWarnings(index, concept.slug, typedAliases) : []),
    [index, typedAliases, concept.slug],
  );

  const buildUpdated = (): Concept => {
    // Primary rendering (TeX/raw editor) + the edited additional renderings. The TeX-derived notation is
    // stored in its minified form (the web re-renders the rich version from `tex`); raw MathML is kept
    // verbatim, and an unchanged notation keeps the concept's existing (already-stored) first rendering.
    const primary = newMathml != null ? (mode === 'tex' ? minifyMathml(newMathml) : newMathml) : concept.mathml[0] ?? null;
    const extras = extraRows.map((r) => r.value.trim()).filter(Boolean);
    const mathml = primary != null ? [primary, ...extras] : extras;
    const n = Number(arity);
    // Speech rows split back into `en` (English) + `speech` (other valid, non-empty ISO 639-1 languages).
    const en = speechRows.find((r) => r.lang.trim() === 'en')?.text.trim() || undefined;
    const speech = speechRows
      .filter((r) => {
        const lang = r.lang.trim();
        return lang !== '' && lang !== 'en' && r.text.trim() !== '' && ISO6391.validate(lang);
      })
      .map((r) => ({ lang: r.lang.trim(), text: r.text.trim() }));
    return {
      ...concept, // carries `raw` for lossless serialization
      slug: slug.trim(),
      en,
      speech,
      area: area.trim() || undefined,
      arity: arity.trim() === '' || Number.isNaN(n) ? undefined : n,
      property: property.trim() || undefined,
      mathml,
      // Links/aliases are sets — drop blanks and de-duplicate (first occurrence wins).
      links: uniq(linkRows.map((r) => r.value.trim()).filter(Boolean)),
      alias: uniq(aliasRows.map((r) => r.value.trim()).filter(Boolean)),
      // TeX kept only when it authored the notation; raw-MathML authoring clears it.
      tex: mode === 'tex' ? tex.trim() || undefined : undefined,
    };
  };

  return (
    <div className="notation-editor" data-testid="notation-editor">
      <h2>{isNew ? 'Add concept' : <>Edit concept: <code>{concept.slug}</code></>}</h2>

      <div className="fields">
        <div className="field">
          <span className="field-head">
            Concept
            <InfoPopover label="Naming help">
              <NamingGuide />
            </InfoPopover>
          </span>
          <input
            data-testid="slug-input"
            aria-label="Concept"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
        </div>
        <label className="field">
          <span>Arity</span>
          <input type="number" min={0} value={arity} onChange={(e) => setArity(e.target.value)} />
        </label>
        <label className="field">
          <span>Area</span>
          <input value={area} onChange={(e) => setArea(e.target.value)} />
        </label>
        <div className="field">
          <span className="field-head">
            Properties
            <InfoPopover label="Properties help">
              <p className="legend-note" data-testid="properties-help">
                Space-separated list of notation forms — e.g. <code>symbol</code> <code>indexed</code>{' '}
                <code>prefix</code> <code>function</code>.
              </p>
            </InfoPopover>
          </span>
          <input
            data-testid="property-input"
            value={property}
            onChange={(e) => setProperty(e.target.value)}
          />
        </div>
      </div>

      {related.items.length > 0 && (
        <div className="related" data-testid="related-concepts">
          <span className="related-head">Related concepts already in the list</span>
          <ul className="related-list">
            {related.items.map((r) => (
              <li key={r.slug} className={`related-item ${r.kind}`}>
                <code className="related-slug">{r.slug}</code>
                {r.arities.length > 0 && (
                  <span className="related-arity">arity {r.arities.join(', ')}</span>
                )}
                {r.area && <span className="related-area">{r.area}</span>}
                {r.kind === 'collision' && (
                  <span className="related-flag" title="A concept with this name or alias already exists">
                    possible duplicate
                  </span>
                )}
              </li>
            ))}
          </ul>
          {related.total > related.items.length && (
            <span className="related-more">+{related.total - related.items.length} more</span>
          )}
        </div>
      )}

      {/* Speech is full-width and multilingual: one template per language (ISO 639-1 key). */}
      <div className="field">
        <span className="field-head">
          Speech
          <InfoPopover label="Language help">
            <p className="legend-note" data-testid="language-help">
              Each template is keyed by an ISO 639-1 language code — <code>en</code> (English),{' '}
              <code>de</code> (German), <code>fr</code> (French)… Start typing a code to autocomplete.
              Speak each argument with a <code>$ref</code> (e.g. <code>$x</code>, <code>$1</code>).
            </p>
          </InfoPopover>
        </span>
        <div className="speech-list" data-testid="speech-list">
          {speechRows.map((row) =>
            row.editing || row.text.trim() === '' ? (
              <div
                className="speech-row editing"
                key={row.id}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) speechOps.patch(row.id, { editing: false });
                }}
              >
                <input
                  className="lang-input"
                  list="iso-639-langs"
                  aria-label="Language"
                  placeholder="en"
                  value={row.lang}
                  spellCheck={false}
                  size={4}
                  onChange={(e) => speechOps.patch(row.id, { lang: e.target.value })}
                />
                <textarea
                  className="speech-input"
                  aria-label="Speech template"
                  rows={2}
                  value={row.text}
                  spellCheck={false}
                  placeholder="additive inverse of $x"
                  onChange={(e) => speechOps.patch(row.id, { text: e.target.value })}
                />
                <RowControls noun="speech" onRemove={() => speechOps.remove(row.id)} />
              </div>
            ) : (
              <div className="speech-row" key={row.id}>
                <span className="lang-badge" data-testid="lang-badge" title={ISO6391.getName(row.lang) || row.lang}>
                  {row.lang || '—'}
                </span>
                <span className="speech-text">{row.text}</span>
                <RowControls
                  noun="speech"
                  onEdit={() => speechOps.patch(row.id, { editing: true })}
                  onRemove={() => speechOps.remove(row.id)}
                />
              </div>
            ),
          )}
          <button type="button" className="add-link" onClick={speechOps.add}>
            + Add language
          </button>
        </div>
        <datalist id="iso-639-langs">
          {LANG_CODES.map((code) => (
            <option key={code} value={code}>
              {ISO6391.getName(code)}
            </option>
          ))}
        </datalist>
      </div>

      <div className="field">
        <span className="notation-head">
          Notation
          <span className="mode-toggle" role="tablist" aria-label="Notation input mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'tex'}
              className={mode === 'tex' ? 'active' : ''}
              onClick={() => setMode('tex')}
            >
              TeX
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'mathml'}
              className={mode === 'mathml' ? 'active' : ''}
              onClick={() => setMode('mathml')}
            >
              Raw MathML
            </button>
          </span>
          {mode === 'tex' && (
            <InfoPopover label="Macro help">
              <MacroLegend />
            </InfoPopover>
          )}
        </span>
        {mode === 'tex' ? (
          <textarea
            data-testid="tex-input"
            aria-label="Notation TeX"
            value={tex}
            spellCheck={false}
            rows={2}
            placeholder={'-\\arg{x}{n}'}
            onChange={(e) => setTex(e.target.value)}
          />
        ) : (
          <textarea
            data-testid="mathml-input"
            aria-label="Raw MathML"
            value={rawMathml}
            spellCheck={false}
            rows={15}
            onChange={(e) => setRawMathml(e.target.value)}
          />
        )}
      </div>

      {missingRefs.length > 0 && (
        <p className="warn" role="status" data-testid="ref-warning">
          Speech references not marked in the notation: {missingRefs.join(', ')}
        </p>
      )}
      {unusedArgs.length > 0 && (
        <p className="warn" role="status" data-testid="unused-warning">
          Notation arguments never used in the speech: {unusedArgs.map((a) => `arg="${a}"`).join(', ')}
        </p>
      )}
      {invalidLangs.length > 0 && (
        <p className="warn" role="status" data-testid="lang-warning">
          Not valid ISO 639-1 language codes (won’t be saved): {invalidLangs.join(', ')}
        </p>
      )}

      {notationError ? (
        <span className="error" role="alert" data-testid="error">
          {notationError}
        </span>
      ) : (
        <div className="previews">
          <div className="preview-cell">
            <span className="preview-label">Rendered</span>
            {effectiveMathml ? (
              <MathML className="preview" markup={effectiveMathml} data-testid="preview" />
            ) : (
              <span className="hint">{mode === 'tex' && hasTex ? 'Loading renderer…' : 'no notation'}</span>
            )}
          </div>
          <div className="preview-cell">
            <span className="preview-label">MathML source (stored)</span>
            {storedMathml ? <MathMLSource markup={storedMathml} /> : <span className="hint">—</span>}
          </div>
        </div>
      )}

      {/* Additional renderings (mathml[1..]). Raw MathML so stale arg/intent names can be fixed. */}
      <div className="field">
        <span className="field-head">
          Additional notations
          <InfoPopover label="Additional notations help">
            <p className="legend-note">
              Extra renderings of this concept, each a full <code>{'<math>…</math>'}</code>. Edit the raw
              MathML and keep its <code>arg</code>/<code>intent</code> names in sync with the concept.
            </p>
          </InfoPopover>
        </span>
        <div className="notation-list" data-testid="notation-list">
          {extraRows.map((row) => {
            const malformed = row.value.trim() !== '' && xmlError(row.value);
            return (
              <div className="notation-row" key={row.id}>
                <textarea
                  className="extra-notation"
                  aria-label="Additional MathML"
                  rows={3}
                  spellCheck={false}
                  placeholder="<math>…</math>"
                  value={row.value}
                  onChange={(e) => extraOps.patch(row.id, { value: e.target.value })}
                />
                <div className="extra-preview">
                  {row.value.trim() === '' ? (
                    <span className="hint">empty</span>
                  ) : malformed ? (
                    <span className="error">Malformed MathML</span>
                  ) : (
                    <MathML className="preview" markup={row.value} />
                  )}
                </div>
                <IconButton
                  label="Remove notation"
                  icon="×"
                  title="Remove"
                  onClick={() => extraOps.remove(row.id)}
                />
              </div>
            );
          })}
          <button type="button" className="add-link" onClick={extraOps.add}>
            + Add notation
          </button>
        </div>
      </div>

      <div className="pair">
        <div className="field">
          <span>Links</span>
          <div className="link-list" data-testid="link-list">
            {linkRows.map((row) =>
              row.editing || row.value.trim() === '' ? (
                <div className="link-row" key={row.id}>
                  <input
                    className="link-input"
                    type="url"
                    aria-label="Link URL"
                    placeholder="https://…"
                    value={row.value}
                    spellCheck={false}
                    autoFocus
                    onChange={(e) => linkOps.patch(row.id, { value: e.target.value })}
                    onBlur={() => linkOps.patch(row.id, { editing: false })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        linkOps.patch(row.id, { editing: false });
                      }
                    }}
                  />
                  <RowControls noun="link" onRemove={() => linkOps.remove(row.id)} />
                </div>
              ) : (
                <div className="link-row" key={row.id}>
                  {/* not active → clickable */}
                  <a className="link-display" href={row.value} target="_blank" rel="noreferrer">
                    {row.value}
                  </a>
                  <RowControls
                    noun="link"
                    onEdit={() => linkOps.patch(row.id, { editing: true })}
                    onRemove={() => linkOps.remove(row.id)}
                  />
                </div>
              ),
            )}
            <button type="button" className="add-link" onClick={linkOps.add}>
              + Add link
            </button>
          </div>
        </div>
        <div className="field">
          <span>Aliases</span>
          <div className="alias-list" data-testid="alias-list">
            {aliasRows.map((row) =>
              row.editing || row.value.trim() === '' ? (
                <span className="alias-edit" key={row.id}>
                  <input
                    className="alias-input"
                    aria-label="Alias"
                    placeholder="snake_case"
                    value={row.value}
                    spellCheck={false}
                    autoFocus
                    size={Math.max(row.value.length + 1, 8)}
                    onChange={(e) => aliasOps.patch(row.id, { value: e.target.value })}
                    onBlur={() => aliasOps.patch(row.id, { editing: false })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        aliasOps.patch(row.id, { editing: false });
                      }
                    }}
                  />
                  <RowControls noun="alias" onRemove={() => aliasOps.remove(row.id)} />
                </span>
              ) : (
                // A completed alias is a chip: highlighted when it names a known concept, muted when not.
                <span
                  className={`alias-chip ${knownSlugs.has(row.value.trim()) ? 'known' : 'unknown'}`}
                  key={row.id}
                  data-testid="alias-chip"
                >
                  <span className="alias-text">{row.value}</span>
                  <RowControls
                    noun="alias"
                    onEdit={() => aliasOps.patch(row.id, { editing: true })}
                    onRemove={() => aliasOps.remove(row.id)}
                  />
                </span>
              ),
            )}
            <IconButton className="add-alias" label="Add alias" icon="+" onClick={aliasOps.add} />
          </div>
          {aliasWarns.length > 0 && (
            <p className="warn" role="status" data-testid="alias-warning">
              {aliasWarns.join('; ')}
            </p>
          )}
        </div>
      </div>

      <div className="actions">
        <button type="button" data-testid="save" disabled={!canSave} onClick={() => canSave && onSave(buildUpdated())}>
          Done
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        {onDelete && (
          <button type="button" className="danger" data-testid="delete" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
