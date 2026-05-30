import { useEffect, useMemo, useState } from 'react';
import { texToIntent } from '../render/intent';
import { loadTemml, type TemmlEngine } from '../render/temmlEngine';
import { MathML } from './MathML';

export type SavedNotation = { tex: string; mathml: string; arity: number };

/**
 * Authoring panel: a curator types TeX (marking arguments with `\arg{name}{…}`) and sees the annotated
 * MathML preview live. Save emits the generated dictionary fragment; persisting it (PR flow) is the
 * caller's concern.
 */
export function NotationEditor({
  concept,
  initialTex = '',
  onSave,
  onCancel,
}: {
  concept: string;
  initialTex?: string;
  onSave: (notation: SavedNotation) => void;
  onCancel?: () => void;
}) {
  const [tex, setTex] = useState(initialTex);
  const [engine, setEngine] = useState<TemmlEngine | null>(null);
  useEffect(() => {
    let live = true;
    loadTemml().then((e) => live && setEngine(e));
    return () => {
      live = false;
    };
  }, []);

  const result = useMemo(
    () => (engine ? texToIntent(engine, tex, concept) : null),
    [engine, tex, concept],
  );
  const empty = tex.trim() === '';

  return (
    <div className="notation-editor" data-testid="notation-editor">
      <h2>
        Edit notation: <code>{concept}</code>
      </h2>

      <label className="field">
        <span>
          TeX — mark arguments as <code>{'\\arg{name}{…}'}</code>, intent as{' '}
          <code>{'\\intent{concept($name)}{…}'}</code>
        </span>
        <textarea
          data-testid="tex-input"
          value={tex}
          spellCheck={false}
          rows={3}
          placeholder={'-\\arg{x}{n}'}
          onChange={(e) => setTex(e.target.value)}
        />
      </label>

      <div className="preview-row">
        <span className="preview-label">Preview</span>
        {!result ? (
          <span className="hint">Loading renderer…</span>
        ) : empty ? (
          <span className="hint">Type TeX to preview…</span>
        ) : result.ok ? (
          <MathML className="preview" markup={result.mathml} data-testid="preview" />
        ) : (
          <span className="error" role="alert" data-testid="error">
            {result.error}
          </span>
        )}
      </div>

      {result?.ok && !empty && <code className="fragment-src">{result.mathml}</code>}

      <div className="actions">
        <button
          type="button"
          data-testid="save"
          disabled={empty || !result?.ok}
          onClick={() => {
            if (!empty && result?.ok) onSave({ tex, mathml: result.mathml, arity: result.arity });
          }}
        >
          Save
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
