import { useEffect, useRef } from 'react';

/** Outside the dialog's box — `target === dialog` alone also matches its own padding/scrollbar. */
const outsideBox = (e: { clientX: number; clientY: number }, d: HTMLElement) => {
  const r = d.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
};

/**
 * The sign-in / permissions FAQ — a native <dialog> (same pattern as the editor modals) opened from
 * the header's "FAQ" link. Spells out exactly what the GitHub sign-in grants (identity only) and how
 * an edit becomes a pull request, to dispel the "an app wants my GitHub" fear (W3C round-2 feedback).
 */
export function Faq({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressOutside = useRef(false); // backdrop dismissal needs press AND release outside the box

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="modal faq-modal"
      data-testid="faq"
      aria-label="Frequently asked questions"
      onClose={onClose}
      onMouseDown={(e) => {
        pressOutside.current = !!ref.current && e.target === ref.current && outsideBox(e, ref.current);
      }}
      onClick={(e) => {
        const pressed = pressOutside.current;
        pressOutside.current = false;
        if (pressed && ref.current && e.target === ref.current && outsideBox(e, ref.current)) onClose();
      }}
    >
      <div className="faq">
        <h2>FAQ</h2>

        <h3>Why sign in at all?</h3>
        <p>
          Only to know <em>who</em> proposed a change: your GitHub <code>@handle</code> appears on the
          pull request and on the commits, so the W3C curators can follow up with you. Browsing the
          dictionary needs no account.
        </p>

        <h3>What does the sign-in grant?</h3>
        <p>
          <strong>Identity only.</strong> The OAuth consent shares your public <code>@handle</code> —{' '}
          <strong>no repository access, no email address, no write scope</strong>. The editor&rsquo;s
          GitHub App cannot touch your repositories, and your browser never holds a token that could.
        </p>

        <h3>Who actually writes to GitHub?</h3>
        <p>
          The project&rsquo;s bot. It commits your edits to a working branch in the dictionary
          repository and opens the pull request there — with each commit <strong>authored as you</strong>,
          so your name and avatar appear on the change. The write permission is the maintainer&rsquo;s
          installation, never yours.
        </p>

        <h3>What is stored on my machine?</h3>
        <p>
          Your in-progress edits and the signed-in session live in your browser&rsquo;s{' '}
          <code>localStorage</code> — nothing else, nowhere else. Reloading the page restores them;
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
          Any time, on GitHub: <em>Settings → Applications → Authorized GitHub Apps</em> — revoke the
          editor&rsquo;s app there. Since the grant is identity-only, revoking simply stops future
          sign-ins.
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
