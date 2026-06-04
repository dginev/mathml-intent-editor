import { fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './ui';

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the message and dismisses on the close button', () => {
    const onClose = vi.fn();
    render(<Toast message="Save failed: 401" onClose={onClose} />);
    expect(screen.getByTestId('toast')).toHaveTextContent('Save failed: 401');
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses after the duration', () => {
    const onClose = vi.fn();
    render(<Toast message="boom" onClose={onClose} duration={5000} />);
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays until closed when duration is 0', () => {
    const onClose = vi.fn();
    render(<Toast message="sticky" onClose={onClose} duration={0} />);
    act(() => vi.advanceTimersByTime(60000));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('error toasts persist until dismissed (no default auto-close)', () => {
    const onClose = vi.fn();
    render(<Toast message="Save failed: 500" kind="error" onClose={onClose} />);
    act(() => vi.advanceTimersByTime(600000));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('info toasts keep the 12s default auto-dismiss', () => {
    const onClose = vi.fn();
    render(<Toast message="PR updated" kind="info" onClose={onClose} />);
    act(() => vi.advanceTimersByTime(12000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
