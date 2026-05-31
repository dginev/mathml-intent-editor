import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * Small, presentation-only building blocks shared by the editor's row lists and field headers.
 * Keeping them here removes the repeated icon-button / popover markup that was copied across the
 * Links, Aliases, and Speech editors.
 */

/** A borderless icon button (✎ / × / …) with an accessible label. */
export function IconButton({
  label,
  icon,
  onClick,
  className = 'icon-btn',
  title,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  className?: string;
  title?: string;
}) {
  return (
    <button type="button" className={className} aria-label={label} title={title ?? label} onClick={onClick}>
      {icon}
    </button>
  );
}

/** Trailing edit/remove controls shared by the link, alias, and speech rows. Omit `onEdit` to show
 *  only the remove (×) control (used while a row is already open for editing). */
export function RowControls({
  noun,
  onEdit,
  onRemove,
}: {
  noun: string;
  onEdit?: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      {onEdit && <IconButton label={`Edit ${noun}`} icon="✎" title="Edit" onClick={onEdit} />}
      <IconButton label={`Remove ${noun}`} icon="×" title="Remove" onClick={onRemove} />
    </>
  );
}

/**
 * An ⓘ help button that floats a dismissible legend above its field. The legend spans the field's
 * width (so it stays inside the modal — see `.legend-pop`), and closes when the user clicks anywhere
 * outside it, so only one legend is ever open at a time.
 */
export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    // Capture phase so it fires before any inner handler and also closes a sibling popover.
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);
  return (
    <span className="info-wrap" ref={wrap}>
      <button
        type="button"
        className="info-btn"
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        ⓘ
      </button>
      {open && <div className="legend-pop">{children}</div>}
    </span>
  );
}

/**
 * A floating, dismissible notification (used to surface a failed Save). Auto-dismisses after `duration`
 * ms (set `duration={0}` to keep it until manually closed); a new `message` restarts the timer.
 */
export function Toast({
  message,
  kind = 'error',
  onClose,
  duration = 12000,
}: {
  message: string;
  kind?: 'error' | 'info';
  onClose: () => void;
  duration?: number;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!duration) return;
    const t = setTimeout(() => closeRef.current(), duration);
    return () => clearTimeout(t);
  }, [message, duration]);
  return (
    <div className={`toast toast-${kind}`} role="alert" data-testid="toast">
      <span className="toast-msg">{message}</span>
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
