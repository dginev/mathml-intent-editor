import { describe, expect, it, vi } from 'vitest';
import { submitToService } from './submitClient';

describe('submitToService', () => {
  it('POSTs content + JWT and returns the PR info', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ prNumber: 12, prUrl: 'https://github.com/dginev/mathml-intent-open/pull/12' }),
    })) as unknown as typeof fetch;

    const out = await submitToService('https://svc.example', 'jwt123', {
      content: 'power: {}',
      message: 'edit power',
    }, fetchImpl);

    expect(out).toEqual({ prNumber: 12, prUrl: 'https://github.com/dginev/mathml-intent-open/pull/12' });
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe('https://svc.example/submit');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer jwt123');
  });

  it('surfaces the service error message', async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid session' }),
    })) as unknown as typeof fetch;
    await expect(
      submitToService('s', 'bad', { content: 'x', message: 'm' }, fetchImpl),
    ).rejects.toThrow('invalid session');
  });
});
