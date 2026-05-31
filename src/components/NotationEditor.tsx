import { useEffect, useMemo, useState } from 'react';
import ISO6391 from 'iso-639-1';
import { missingSpeechRefs, texToIntent, unusedArgRefs } from '../render/intent';
import { loadTemml, type TemmlEngine } from '../render/temmlEngine';
import { MathML } from './MathML';
import { MathMLSource } from './MathMLSource';
import { IconButton, InfoPopover, RowControls } from './ui';
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

/** A fresh link/alias row (blank, open for editing). */
const blankEntry = () => ({ value: '' });
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
}: {
  concept: Concept;
  onSave: (updated: Concept) => void;
  onDelete?: () => void;
  onCancel?: () => void;
  /** All concept names in the dictionary — an alias highlights when it names a known concept. */
  knownSlugs?: ReadonlySet<string>;
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
  const rawError = useMemo(() => {
    if (mode !== 'mathml' || rawMathml.trim() === '') return null;
    const doc = new DOMParser().parseFromString(rawMathml, 'application/xml');
    return doc.querySelector('parsererror') ? 'Malformed XML / MathML' : null;
  }, [mode, rawMathml]);

  // Resolve the active notation per mode: the MathML it produces (null = keep the existing one), its
  // error, and whether that error blocks saving.
  const texMathml = mode === 'tex' && hasTex && texResult?.ok ? `<math>${texResult.mathml}</math>` : null;
  const rawMathmlOut = mode === 'mathml' && rawMathml.trim() !== '' && !rawError ? rawMathml.trim() : null;
  const newMathml: string | null = mode === 'tex' ? texMathml : rawMathmlOut;
  const notationError = mode === 'tex' ? (hasTex && texResult && !texResult.ok ? texResult.error : null) : rawError;
  const notationBlocks = mode === 'tex' ? hasTex && (!engine || !texResult?.ok) : !!rawError;
  const canSave = slug.trim() !== '' && !notationBlocks;

  // What the preview + validation use: the new notation, else the concept's existing first rendering.
  const effectiveMathml = newMathml ?? concept.mathml[0] ?? null;
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

  const buildUpdated = (): Concept => {
    const mathml = newMathml ? [newMathml, ...concept.mathml.slice(1)] : concept.mathml;
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
      links: linkRows.map((r) => r.value.trim()).filter(Boolean),
      alias: aliasRows.map((r) => r.value.trim()).filter(Boolean),
      // TeX kept only when it authored the notation; raw-MathML authoring clears it.
      tex: mode === 'tex' ? tex.trim() || undefined : undefined,
    };
  };

  return (
    <div className="notation-editor" data-testid="notation-editor">
      <h2>{isNew ? 'Add concept' : <>Edit concept: <code>{concept.slug}</code></>}</h2>

      <div className="fields">
        <label className="field">
          <span>Concept</span>
          <input data-testid="slug-input" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </label>
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
            <span className="preview-label">MathML source</span>
            {effectiveMathml ? <MathMLSource markup={effectiveMathml} /> : <span className="hint">—</span>}
          </div>
        </div>
      )}

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
