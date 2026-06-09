import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBackClose } from './useBackClose';

afterEach(() => vi.restoreAllMocks());

describe('useBackClose', () => {
  it('pushes a history entry on open and closes the dialog on Back (popstate)', () => {
    const push = vi.spyOn(window.history, 'pushState');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const attemptClose = vi.fn(() => true);

    const { rerender, unmount } = renderHook(({ open }) => useBackClose(open, attemptClose), {
      initialProps: { open: false },
    });
    expect(push).not.toHaveBeenCalled();

    rerender({ open: true });
    expect(push).toHaveBeenCalledTimes(1); // armed

    window.dispatchEvent(new PopStateEvent('popstate')); // user presses Back
    expect(attemptClose).toHaveBeenCalledTimes(1);

    rerender({ open: false }); // the dialog state then closes
    expect(back).not.toHaveBeenCalled(); // already popped by Back — don't pop again
    unmount();
  });

  it('removes its history entry when the dialog is closed through the UI (not Back)', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const { rerender } = renderHook(({ open }) => useBackClose(open, () => true), {
      initialProps: { open: true },
    });
    rerender({ open: false }); // closed via Esc/Cancel — no popstate happened
    expect(back).toHaveBeenCalledTimes(1); // balance the pushed entry
  });

  it('re-arms Back when the close is declined (e.g. unsaved-changes guard)', () => {
    const push = vi.spyOn(window.history, 'pushState');
    const declines = vi.fn(() => false);
    renderHook(() => useBackClose(true, declines));
    expect(push).toHaveBeenCalledTimes(1); // initial arm

    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(declines).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(2); // declined → re-armed, so Back keeps working
  });
});
