import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Faq } from './Faq';

beforeAll(() => {
  // jsdom's <dialog> may lack showModal/close; no-op polyfills keep the dialog effect from throwing.
  HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

describe('Faq', () => {
  it('renders the sign-in permission reassurances when open', () => {
    render(<Faq open onClose={vi.fn()} />);
    const dialog = screen.getByTestId('faq');
    expect(dialog).toHaveTextContent(/why sign in/i);
    expect(dialog).toHaveTextContent(/@handle/);
    expect(dialog).toHaveTextContent(/no repository access/i);
    expect(dialog).toHaveTextContent(/authored as you/i);
    expect(dialog).toHaveTextContent(/localStorage/);
    expect(dialog).toHaveTextContent(/pull request/i);
    expect(dialog).toHaveTextContent(/revoke/i);
  });

  it('closes via its Close button', () => {
    const onClose = vi.fn();
    render(<Faq open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close FAQ' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing visible while closed', () => {
    render(<Faq open={false} onClose={vi.fn()} />);
    expect((screen.getByTestId('faq') as HTMLDialogElement).open).toBe(false);
  });
});
