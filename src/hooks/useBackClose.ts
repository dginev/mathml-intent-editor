import { useEffect, useRef } from 'react';

/**
 * Make the browser **Back** button close an open dialog/overlay instead of leaving the page.
 *
 * While `open`, a throwaway history entry is pushed; pressing Back pops it and runs `attemptClose`.
 * `attemptClose` returns whether it actually closed — a dialog with an unsaved-changes guard may decline
 * (the user chose to keep editing), in which case the entry is re-armed so Back keeps working. Closing
 * through the UI (Esc / Cancel / backdrop) drops the pushed entry too, so the history stays balanced and
 * a later Back doesn't strand the user on a phantom entry.
 *
 * The effect depends only on `open` (the close callback is read through a ref), so it runs exactly on
 * open/close transitions. The app's dialogs never stack — native modals make the background inert — so
 * each call manages a single entry independently, without a shared depth counter.
 */
export function useBackClose(open: boolean, attemptClose: () => boolean): void {
  const closeRef = useRef(attemptClose);
  useEffect(() => {
    closeRef.current = attemptClose;
  });

  useEffect(() => {
    if (!open) return;
    window.history.pushState({ __modal: true }, '');
    let popped = false;
    const onPop = () => {
      if (closeRef.current()) popped = true;
      else window.history.pushState({ __modal: true }, ''); // declined → re-arm Back
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped) window.history.back(); // closed via the UI, not Back → remove our entry
    };
  }, [open]);
}
