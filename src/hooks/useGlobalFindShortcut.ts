import { useEffect, type RefObject } from 'react';

/**
 * Rebind Ctrl/⌘+F to focus the given input (the in-app Filter), since the table is virtualized and the
 * browser's native find only sees the rendered window. Left alone while a modal is open.
 */
export function useGlobalFindShortcut(ref: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F') && !e.shiftKey && !e.altKey) {
        if (document.querySelector('dialog[open]')) return; // don't hijack find while editing
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ref]);
}
