import { useEffect, useMemo, useState } from 'react';
import { missingSpeechRefs, texToIntent } from '../render/intent';
import { loadTemml, type TemmlEngine } from '../render/temmlEngine';
import { MathML } from './MathML';
import { MathMLSource } from './MathMLSource';
import type { Concept } from '../types';

const lines = (s: string): string[] =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

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
            <code>{'\\arg{name}{…}'}</code>
          </td>
          <td>mark an argument</td>
          <td>
            <code>{'\\arg{argname}{value}'}</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>{'\\intent{expr}{…}'}</code>
          </td>
          <td>mark an intent expression</td>
          <td>
            <code>{'\\intent{biconditional($lhs,$rhs)}{\\arg{lhs}{A}\\iff\\arg{rhs}{B}}'}</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>\MathML…</code> / <code>\MML…</code>
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
}: {
  concept: Concept;
  onSave: (updated: Concept) => void;
  onDelete?: () => void;
  onCancel?: () => void;
}) {
  const [slug, setSlug] = useState(concept.slug);
  const [en, setEn] = useState(concept.en ?? '');
  const [area, setArea] = useState(concept.area ?? '');
  const [arity, setArity] = useState(concept.arity != null ? String(concept.arity) : '');
  const [property, setProperty] = useState(concept.property ?? '');
  const [tex, setTex] = useState(concept.tex ?? '');
  const [linksText, setLinksText] = useState(concept.links.join('\n'));
  const [aliasText, setAliasText] = useState(concept.alias.join('\n'));
  const [showLegend, setShowLegend] = useState(false);
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
  const missingRefs = useMemo(
    () => (effectiveMathml ? missingSpeechRefs(en, effectiveMathml) : []),
    [en, effectiveMathml],
  );

  const buildUpdated = (): Concept => {
    const mathml = newMathml ? [newMathml, ...concept.mathml.slice(1)] : concept.mathml;
    const n = Number(arity);
    return {
      ...concept, // carries `raw` for lossless serialization
      slug: slug.trim(),
      en: en.trim() || undefined,
      area: area.trim() || undefined,
      arity: arity.trim() === '' || Number.isNaN(n) ? undefined : n,
      property: property.trim() || undefined,
      mathml,
      links: lines(linksText),
      alias: lines(aliasText),
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
        <label className="field">
          <span>Property</span>
          <input value={property} onChange={(e) => setProperty(e.target.value)} />
        </label>
      </div>

      {/* Speech + Notation are full-width (contents can be long); speech $refs must be marked in the notation. */}
      <label className="field">
        <span>Speech (en)</span>
        <textarea value={en} spellCheck={false} rows={2} onChange={(e) => setEn(e.target.value)} />
      </label>

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
        <label className="field">
          <span>Links — one URL per line</span>
          <textarea
            value={linksText}
            spellCheck={false}
            rows={2}
            onChange={(e) => setLinksText(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Aliases — one per line</span>
          <textarea
            value={aliasText}
            spellCheck={false}
            rows={2}
            onChange={(e) => setAliasText(e.target.value)}
          />
        </label>
      </div>

      <div className="actions">
        <button type="button" data-testid="save" disabled={!canSave} onClick={() => canSave && onSave(buildUpdated())}>
          Save
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
