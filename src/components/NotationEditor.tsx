import { useEffect, useMemo, useState } from 'react';
import { texToIntent } from '../render/intent';
import { loadTemml, type TemmlEngine } from '../render/temmlEngine';
import { MathML } from './MathML';
import type { Concept } from '../types';

const lines = (s: string): string[] =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

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

  const [engine, setEngine] = useState<TemmlEngine | null>(null);
  useEffect(() => {
    let live = true;
    loadTemml().then((e) => live && setEngine(e));
    return () => {
      live = false;
    };
  }, []);

  const hasTex = tex.trim() !== '';
  // Authoring TeX overwrites the primary notation; the intent name comes from the (editable) slug.
  const result = useMemo(
    () => (engine && hasTex ? texToIntent(engine, tex, slug) : null),
    [engine, hasTex, tex, slug],
  );
  const texBlocks = hasTex && (!engine || !result?.ok); // TeX present but not yet valid → can't save
  const canSave = slug.trim() !== '' && !texBlocks;

  const buildUpdated = (): Concept => {
    const mathml =
      hasTex && result?.ok
        ? [`<math>${result.mathml}</math>`, ...concept.mathml.slice(1)]
        : concept.mathml;
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
      tex: tex.trim() || undefined,
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
        <label className="field field-wide">
          <span>Speech (en)</span>
          <input value={en} onChange={(e) => setEn(e.target.value)} />
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

      <table className="legend">
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

      <label className="field">
        <span>Notation — TeX (leave blank to keep the current MathML)</span>
        <textarea
          data-testid="tex-input"
          value={tex}
          spellCheck={false}
          rows={2}
          placeholder={'-\\arg{x}{n}'}
          onChange={(e) => setTex(e.target.value)}
        />
      </label>

      <div className="preview-row">
        <span className="preview-label">Preview</span>
        {hasTex ? (
          !result ? (
            <span className="hint">Loading renderer…</span>
          ) : result.ok ? (
            <MathML className="preview" markup={result.mathml} data-testid="preview" />
          ) : (
            <span className="error" role="alert" data-testid="error">
              {result.error}
            </span>
          )
        ) : concept.mathml[0] ? (
          <MathML className="preview" markup={concept.mathml[0]} data-testid="preview" />
        ) : (
          <span className="hint">no notation</span>
        )}
      </div>

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
