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

/**
 * The literal MathML source, lightly syntax-highlighted, with the `intent=`/`arg=` annotations
 * emphasized — complements the rendered preview by showing exactly what will be written.
 */
export function MathMLSource({ markup }: { markup: string }) {
  const toks = useMemo(() => tokenize(markup), [markup]);
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
