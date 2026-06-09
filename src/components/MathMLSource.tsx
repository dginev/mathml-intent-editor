import { Fragment, useMemo } from 'react';

type Tok = { cls: string; text: string };

const ANNOTATION = new Set(['intent', 'arg']);

/** Tokenize the attribute body of a tag (everything after the tag name, including the closing `>`). */
function tokenizeAttrs(body: string): Tok[] {
  const toks: Tok[] = [];
  const re = /([a-zA-Z][\w:-]*)\s*=\s*("[^"]*"|'[^']*')|(\/?>)|(\s+)|([^])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    if (m[1] != null) {
      // intent=/arg= annotations get a single highlighted span; other attributes are split by colour.
      if (ANNOTATION.has(m[1])) toks.push({ cls: 'tok-annot', text: `${m[1]}=${m[2]}` });
      else {
        toks.push({ cls: 'tok-attr', text: m[1] });
        toks.push({ cls: 'tok-punct', text: '=' });
        toks.push({ cls: 'tok-string', text: m[2] });
      }
    } else if (m[3] != null) toks.push({ cls: 'tok-punct', text: m[3] });
    else toks.push({ cls: '', text: m[4] ?? m[5] }); // whitespace / stray char → plain
  }
  return toks;
}

/**
 * Pretty-print serialized (single-line) MathML: one element per line, indented by depth. Leaf
 * elements (an opening tag whose only child is text) stay inline as `<mi>n</mi>`. Tag text is
 * preserved verbatim — quote style and content are untouched — so this is purely cosmetic.
 */
function formatMathml(src: string): string {
  const parts = src.match(/<\/?[a-zA-Z][^>]*>|[^<]+/g) ?? [src];
  const lines: string[] = [];
  let depth = 0;
  const pad = (d: number) => '  '.repeat(Math.max(0, d));
  for (let i = 0; i < parts.length; i++) {
    const tok = parts[i].trim();
    if (tok === '') continue;
    if (tok.startsWith('</')) {
      depth -= 1;
      lines.push(pad(depth) + tok);
    } else if (tok.endsWith('/>')) {
      lines.push(pad(depth) + tok); // self-closing
    } else if (tok.startsWith('<')) {
      const next = parts[i + 1];
      const after = parts[i + 2];
      const isLeaf = next != null && next[0] !== '<' && (after?.trim().startsWith('</') ?? false);
      if (isLeaf) {
        lines.push(pad(depth) + tok + next + after!.trim()); // open + text + close on one line
        i += 2;
      } else {
        lines.push(pad(depth) + tok);
        depth += 1;
      }
    } else {
      lines.push(pad(depth) + tok); // stray text between elements
    }
  }
  return lines.join('\n');
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  for (const seg of src.match(/<\/?[a-zA-Z][^>]*>|[^<]+/g) ?? []) {
    if (seg[0] !== '<') {
      toks.push({ cls: 'tok-text', text: seg });
      continue;
    }
    const open = /^<\/?/.exec(seg)![0];
    toks.push({ cls: 'tok-punct', text: open });
    let i = open.length;
    const name = /^[a-zA-Z][\w:-]*/.exec(seg.slice(i));
    if (name) {
      toks.push({ cls: 'tok-tag', text: name[0] });
      i += name[0].length;
    }
    toks.push(...tokenizeAttrs(seg.slice(i)));
  }
  return toks;
}

/** Render one already-formatted source line's tokens (syntax-highlighted). */
function renderLine(text: string) {
  return tokenize(text).map((t, i) =>
    t.cls ? (
      <span key={i} className={t.cls}>
        {t.text}
      </span>
    ) : (
      <Fragment key={i}>{t.text}</Fragment>
    ),
  );
}

/**
 * The literal MathML source, lightly syntax-highlighted, with the `intent=`/`arg=` annotations
 * emphasized — complements the rendered preview by showing exactly what will be written.
 */
export function MathMLSource({ markup }: { markup: string }) {
  const toks = useMemo(() => tokenize(formatMathml(markup)), [markup]);
  return (
    <pre className="mathml-source" data-testid="mathml-source">
      <code>
        {toks.map((t, i) =>
          t.cls ? (
            <span key={i} className={t.cls}>
              {t.text}
            </span>
          ) : (
            <Fragment key={i}>{t.text}</Fragment>
          ),
        )}
      </code>
    </pre>
  );
}

type DiffLine = { type: 'same' | 'del' | 'add'; text: string };

/** A minimal LCS line diff (inputs are a few formatted lines, so O(n·m) is fine). */
function lineDiff(before: string[], after: string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ type: 'same', text: before[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: before[i++] });
    } else {
      out.push({ type: 'add', text: after[j++] });
    }
  }
  while (i < n) out.push({ type: 'del', text: before[i++] });
  while (j < m) out.push({ type: 'add', text: after[j++] });
  return out;
}

const GUTTER: Record<DiffLine['type'], string> = { same: ' ', del: '−', add: '+' };

/**
 * A unified line-by-line diff of two MathML sources — both pretty-printed, then LCS-diffed by line.
 * Removed lines read red, added lines green, unchanged lines provide context; each line keeps its
 * syntax highlighting. Compact enough to sit in the read-only view's notation column.
 */
export function MathMLSourceDiff({ before, after }: { before: string; after: string }) {
  const lines = useMemo(
    () => lineDiff(formatMathml(before).split('\n'), formatMathml(after).split('\n')),
    [before, after],
  );
  return (
    <pre className="mathml-source mathml-source-diff" data-testid="mathml-source-diff">
      <code>
        {lines.map((ln, i) => (
          <div key={i} className={`diff-line diff-line-${ln.type}`}>
            <span className="diff-gutter" aria-hidden="true">
              {GUTTER[ln.type]}
            </span>
            {renderLine(ln.text)}
          </div>
        ))}
      </code>
    </pre>
  );
}
