import { useEffect, useRef } from 'react';

/** Outside the dialog's box — `target === dialog` alone also matches its own padding/scrollbar. */
const outsideBox = (e: { clientX: number; clientY: number }, d: HTMLElement) => {
  const r = d.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
};

/**
 * The About / FAQ dialog — a native <dialog> (same pattern as the editor modals) opened from the
 * header's "About / FAQ" link or the `#faq` URL fragment (a shareable documentation link). Leads
 * with what the editor is and how it works (round-3 "is there any documentation?" ask), then spells
 * out exactly what the GitHub sign-in grants (identity only) and how an edit becomes a pull request,
 * to dispel the "an app wants my GitHub" fear (W3C round-2 feedback).
 */
export function Faq({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pressOutside = useRef(false); // backdrop dismissal needs press AND release outside the box

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Start reading at the title. Without this, showModal focuses the dialog's only focusable
      // element — the bottom Close button — and the scrolled (.modal is overflow:auto) dialog
      // opens at its end.
      titleRef.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="modal faq-modal"
      data-testid="faq"
      aria-labelledby="faq-title"
      onClose={onClose}
      onMouseDown={(e) => {
        pressOutside.current = e.target === e.currentTarget && outsideBox(e, e.currentTarget);
      }}
      onClick={(e) => {
        const pressed = pressOutside.current;
        pressOutside.current = false;
        if (pressed && e.target === e.currentTarget && outsideBox(e, e.currentTarget)) onClose();
      }}
    >
      <div className="faq">
        {/* tabIndex -1: programmatically focusable so reading starts here when the dialog opens. */}
        <h2 id="faq-title" tabIndex={-1} ref={titleRef}>
          About this editor
        </h2>

        <h3>What is this editor?</h3>
        <p>
          A community editor for the Open concept list of{' '}
          <a href="https://w3c.github.io/mathml/#mixing_intent" target="_blank" rel="noreferrer">
            MathML Intent
          </a>
          , the W3C effort to give mathematical formulas high-quality{' '}
          <strong>accessible readouts</strong>, to be used by screen readers and other assistive
          technologies (AT). Each row of the table is one math concept: its name, an
          example notation it is written with, and a speech template saying how it could be spoken.
        </p>

        <h3>How does it work?</h3>
        <p>
          The table <em>is</em> the official list, read directly from its GitHub repository: browse or
          filter it freely. Signing in lets you <strong>add, edit, or remove</strong> entries:
          notations are authored in TeX (or raw MathML) with a live preview. When done, clicking the{' '}
          <em>Save</em> button at the top-right of the page turns your batch of changes into a GitHub
          pull request against the dictionary file, which its curators review and merge.
        </p>
        <h3>How do I edit a concept?</h3>
        <p>
          Sign in, then click the pencil button (<span aria-hidden="true">✎</span>) at the right end
          of a row, or <em>+ Add entry</em> in the header for a new concept. A dialog opens with one
          block per field: name, properties, speech templates, notations, reference links, and
          aliases. Each block carries an <span aria-hidden="true">ⓘ</span> info button explaining its
          conventions and advanced features, such as notation authoring; notations preview live as
          you type. <em>Done</em> stages your change in the table, <em>Cancel</em> discards it:
          nothing reaches GitHub until you click <em>Save</em>.
        </p>

        <p>Until merged or refused, your pending changes stay highlighted in the table:</p>
        {/* Swatches mirror the real row styling (the --diff-* theme variables + accent stripe), so
            this legend repaints with any palette change; the hue words in the accessible names
            describe the palette (green/purple/red in both themes) — revisit them if a hue changes. */}
        <ul className="faq-legend">
          <li>
            <span className="swatch swatch-added" role="img" aria-label="green row highlight" />{' '}
            <strong>
              <span role="img" aria-label="plus icon">
                +
              </span>{' '}
              Added
            </strong>
            : a brand-new entry
          </li>
          <li>
            <span className="swatch swatch-edited" role="img" aria-label="purple row highlight" />{' '}
            <strong>
              <span role="img" aria-label="pencil icon">
                ✎
              </span>{' '}
              Edited
            </strong>
            : an existing entry with unsaved changes
          </li>
          <li>
            <span className="swatch swatch-deleted" role="img" aria-label="red row highlight" />{' '}
            <strong>
              <span role="img" aria-label="minus icon">
                −
              </span>{' '}
              Deleted
            </strong>
            : marked for removal, kept visible until saved
          </li>
        </ul>

        <h3>Why sign in at all?</h3>
        <p>
          Only to know <em>who</em> proposed a change: your GitHub <code>@handle</code> appears on the
          pull request and on the commits, so the W3C curators can follow up with you. Browsing the
          dictionary needs no account.
        </p>

        <h3>What does the sign-in grant?</h3>
        <p>
          <strong>Identity only.</strong> The OAuth consent shares your public <code>@handle</code>:{' '}
          <strong>no repository access, no email address, no write scope</strong>. The editor&rsquo;s
          GitHub App cannot touch your repositories, and your browser never holds a token that could.
        </p>

        <h3>Who actually writes to GitHub?</h3>
        <p>
          The project&rsquo;s bot. It commits your edits to a working branch in the dictionary
          repository and opens the pull request there, with each commit <strong>authored as you</strong>,
          so your name and avatar appear on the change. The write permission is the maintainer&rsquo;s
          installation, never yours.
        </p>

        <h3>What is stored on my machine?</h3>
        <p>
          Your in-progress edits and the signed-in session live in your browser&rsquo;s{' '}
          <code>localStorage</code>: nothing else, nowhere else. Reloading the page restores them;
          signing out clears the session.
        </p>

        <h3>How do my edits become a pull request?</h3>
        <p>
          Each editing session works on one branch. The first Save opens a pull request; every later
          Save adds a commit to the <em>same</em> pull request. Once it is merged or closed, your next
          edit starts a fresh branch (and a fresh PR).
        </p>

        <h3>How do I revoke access?</h3>
        <p>
          Any time, on GitHub, under <em>Settings → Applications → Authorized GitHub Apps</em>: revoke
          the editor&rsquo;s app there. Since the grant is identity-only, revoking simply stops future
          sign-ins.
        </p>

        <h3>How did this project start?</h3>
        <p>
          This editor was proposed and developed as part of the W3C Math charter for MathML&nbsp;4. It
          has undergone several rounds of group design and remains open to community feedback. Its
          primary maintainer is Deyan Ginev, reachable at{' '}
          <a href="mailto:deyan@arxiv.org">deyan@arxiv.org</a>. This is an AI-friendly project,
          developed with extensive use of Claude Opus&nbsp;4.8.
        </p>

        <div className="actions">
          <button type="button" aria-label="Close FAQ" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
