import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from 'react';
import ISO6391 from 'iso-639-1';
import { missingSpeechRefs, texToIntent, unusedArgRefs } from '../render/intent';
import { loadTemml, type TemmlEngine } from '../render/temmlEngine';
import { MathML } from './MathML';
import { MathMLSource } from './MathMLSource';
import type { Concept } from '../types';

/** One editable speech template row: a stable id, an ISO 639-1 language code, the template, and edit state. */
type SpeechRow = { id: number; lang: string; text: string; editing: boolean };

/** All ISO 639-1 codes, for the language autocomplete (`<datalist>`). */
const LANG_CODES = ISO6391.getAllCodes();

/** One editable entry (a link or an alias): a stable id (edit state survives add/remove), its value,
 *  and whether it's currently open for editing. */
type EditRow = { id: number; value: string; editing: boolean };

const NO_SLUGS: ReadonlySet<string> = new Set();

/** Row-list state helpers shared by the Links and Aliases editors. New rows get `max(id)+1` — stable
 *  and unique among current rows, computed inside the (deferred) updater so no render-time ref is needed. */
function rowOps(setRows: Dispatch<SetStateAction<EditRow[]>>) {
  return {
    setValue: (id: number, value: string) =>
      setRows((rows) => rows.map((r) => (r.id === id ? { ...r, value } : r))),
    setEditing: (id: number, editing: boolean) =>
      setRows((rows) => rows.map((r) => (r.id === id ? { ...r, editing } : r))),
    add: () =>
      setRows((rows) => [
        ...rows,
        { id: rows.reduce((m, r) => Math.max(m, r.id), -1) + 1, value: '', editing: true },
      ]),
    remove: (id: number) => setRows((rows) => rows.filter((r) => r.id !== id)),
  };
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
  const [slug, setSlug] = useState(concept.slug);
  const [area, setArea] = useState(concept.area ?? '');
  const [arity, setArity] = useState(concept.arity != null ? String(concept.arity) : '');
  const [property, setProperty] = useState(concept.property ?? '');
  const [tex, setTex] = useState(concept.tex ?? '');
  // Links & aliases are row lists keyed by a stable id (initialized to the index).
  const [linkRows, setLinkRows] = useState<EditRow[]>(() =>
    concept.links.map((value, i) => ({ id: i, value, editing: false })),
  );
  const linkOps = rowOps(setLinkRows);

  const [aliasRows, setAliasRows] = useState<EditRow[]>(() =>
    concept.alias.map((value, i) => ({ id: i, value, editing: false })),
  );
  const aliasOps = rowOps(setAliasRows);

  // Speech is a list of language-keyed templates; `en` is just the first entry, the rest are extra languages.
  const [speechRows, setSpeechRows] = useState<SpeechRow[]>(() => {
    const rows: SpeechRow[] = [];
    if (concept.en != null) rows.push({ id: 0, lang: 'en', text: concept.en, editing: false });
    for (const s of concept.speech ?? []) rows.push({ id: rows.length, lang: s.lang, text: s.text, editing: false });
    return rows;
  });
  const setSpeech = (id: number, patch: Partial<SpeechRow>) =>
    setSpeechRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addSpeech = () =>
    setSpeechRows((rows) => [
      ...rows,
      {
        id: rows.reduce((m, r) => Math.max(m, r.id), -1) + 1,
        lang: rows.some((r) => r.lang.trim() === 'en') ? '' : 'en', // first entry defaults to English
        text: '',
        editing: true,
      },
    ]);
  const removeSpeech = (id: number) => setSpeechRows((rows) => rows.filter((r) => r.id !== id));

  const [showLegend, setShowLegend] = useState(false);
  const [showProperties, setShowProperties] = useState(false);
  const [showLangs, setShowLangs] = useState(false);
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

  // Resolve the active notation: its error (if any), the MathML it produces, and whether it blocks save.
  const newMathml: string | null =
    mode === 'tex'
      ? hasTex
        ? texResult?.ok
          ? `<math>${texResult.mathml}</math>`
          : null
        : null // TeX blank → keep existing (handled in buildUpdated)
      : rawMathml.trim() && !rawError
        ? rawMathml.trim()
        : null;
  const notationError = mode === 'tex' ? (hasTex && texResult && !texResult.ok ? texResult.error : null) : rawError;
  const notationBlocks =
    mode === 'tex' ? hasTex && (!engine || !texResult?.ok) : !!rawError;
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
      <h2>
        Edit concept: <code>{concept.slug}</code>
      </h2>

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
            <span className="info-wrap">
              <button
                type="button"
                className="info-btn"
                aria-label="Properties help"
                aria-expanded={showProperties}
                title="Properties help"
                onClick={() => setShowProperties((v) => !v)}
              >
                ⓘ
              </button>
              {showProperties && (
                <div className="legend-pop">
                  <p className="legend-note" data-testid="properties-help">
                    Space-separated list of notation forms — e.g.{' '}
                    <code>symbol</code> <code>indexed</code> <code>prefix</code> <code>function</code>.
                  </p>
                </div>
              )}
            </span>
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
          <span className="info-wrap">
            <button
              type="button"
              className="info-btn"
              aria-label="Language help"
              aria-expanded={showLangs}
              title="Language help"
              onClick={() => setShowLangs((v) => !v)}
            >
              ⓘ
            </button>
            {showLangs && (
              <div className="legend-pop">
                <p className="legend-note" data-testid="language-help">
                  Each template is keyed by an ISO 639-1 language code — <code>en</code> (English),{' '}
                  <code>de</code> (German), <code>fr</code> (French)… Start typing a code to autocomplete.
                  Speak each argument with a <code>$ref</code> (e.g. <code>$x</code>, <code>$1</code>).
                </p>
              </div>
            )}
          </span>
        </span>
        <div className="speech-list" data-testid="speech-list">
          {speechRows.map((row) =>
            row.editing || row.text.trim() === '' ? (
              <div
                className="speech-row editing"
                key={row.id}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setSpeech(row.id, { editing: false });
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
                  onChange={(e) => setSpeech(row.id, { lang: e.target.value })}
                />
                <textarea
                  className="speech-input"
                  aria-label="Speech template"
                  rows={2}
                  value={row.text}
                  spellCheck={false}
                  placeholder="additive inverse of $x"
                  onChange={(e) => setSpeech(row.id, { text: e.target.value })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove speech"
                  title="Remove"
                  onClick={() => removeSpeech(row.id)}
                >
                  ×
                </button>
              </div>
            ) : (
              <div className="speech-row" key={row.id}>
                <span className="lang-badge" data-testid="lang-badge" title={ISO6391.getName(row.lang) || row.lang}>
                  {row.lang || '—'}
                </span>
                <span className="speech-text">{row.text}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Edit speech"
                  title="Edit"
                  onClick={() => setSpeech(row.id, { editing: true })}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove speech"
                  title="Remove"
                  onClick={() => removeSpeech(row.id)}
                >
                  ×
                </button>
              </div>
            ),
          )}
          <button type="button" className="add-link" onClick={addSpeech}>
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
            <span className="info-wrap">
              <button
                type="button"
                className="info-btn"
                aria-label="Macro help"
                aria-expanded={showLegend}
                title="Macro help"
                onClick={() => setShowLegend((v) => !v)}
              >
                ⓘ
              </button>
              {showLegend && (
                <div className="legend-pop">
                  <MacroLegend />
                </div>
              )}
            </span>
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
            {effectiveMathml ? (
              <MathMLSource markup={effectiveMathml} />
            ) : (
              <span className="hint">—</span>
            )}
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
                    onChange={(e) => linkOps.setValue(row.id, e.target.value)}
                    onBlur={() => linkOps.setEditing(row.id, false)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        linkOps.setEditing(row.id, false);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Remove link"
                    title="Remove"
                    onClick={() => linkOps.remove(row.id)}
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div className="link-row" key={row.id}>
                  {/* not active → clickable */}
                  <a className="link-display" href={row.value} target="_blank" rel="noreferrer">
                    {row.value}
                  </a>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Edit link"
                    title="Edit"
                    onClick={() => linkOps.setEditing(row.id, true)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Remove link"
                    title="Remove"
                    onClick={() => linkOps.remove(row.id)}
                  >
                    ×
                  </button>
                </div>
              ),
            )}
            <button type="button" className="add-link" onClick={() => linkOps.add()}>
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
                    onChange={(e) => aliasOps.setValue(row.id, e.target.value)}
                    onBlur={() => aliasOps.setEditing(row.id, false)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        aliasOps.setEditing(row.id, false);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Remove alias"
                    title="Remove"
                    onClick={() => aliasOps.remove(row.id)}
                  >
                    ×
                  </button>
                </span>
              ) : (
                // A completed alias is a chip: highlighted when it names a known concept, muted when not.
                <span
                  className={`alias-chip ${knownSlugs.has(row.value.trim()) ? 'known' : 'unknown'}`}
                  key={row.id}
                  data-testid="alias-chip"
                >
                  <span className="alias-text">{row.value}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Edit alias"
                    title="Edit"
                    onClick={() => aliasOps.setEditing(row.id, true)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Remove alias"
                    title="Remove"
                    onClick={() => aliasOps.remove(row.id)}
                  >
                    ×
                  </button>
                </span>
              ),
            )}
            <button type="button" className="add-alias" aria-label="Add alias" onClick={() => aliasOps.add()}>
              +
            </button>
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
          <button
            type="button"
            className="danger"
            data-testid="delete"
            onClick={() => {
              if (confirm(`Remove concept "${concept.slug}"?`)) onDelete();
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
