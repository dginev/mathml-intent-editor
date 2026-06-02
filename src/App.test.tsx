import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { w3cYaml } from './test/dictFixture';
import type { Concept } from './types';

// Configure a backing repo + service so App takes the live (GitHub) path, not the seed fallback.
vi.mock('./github/config', () => ({
  repoConfigFromEnv: () => ({ owner: 'o', repo: 'r', baseBranch: 'main', filePath: 'open.yml' }),
  serviceConfigFromEnv: () => ({ serviceUrl: 'https://svc.example', clientId: 'cid' }),
}));

import App from './App';

const base: Concept = {
  slug: 'power',
  arity: 2,
  en: '$1 to the $2',
  mathml: ['<math><msup><mi>x</mi><mn>2</mn></msup></math>'],
  links: [],
  alias: [],
};
const edited: Concept = { ...base, en: '$1 raised to $2' };
const baseYaml = w3cYaml([{ concept: 'power', arity: 2, en: base.en, mathml: base.mathml }]);

const textRes = (status: number, text: string) => ({ ok: status < 400, status, text: async () => text });
const json = (status: number, obj: unknown) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });

type Call = { method: string; url: string; body?: Record<string, string> };
const ghCalls: Call[] = [];

// Routes the client-side fork → branch → commit → PR sequence (api.github.com) + the raw reads.
const fetchStub = vi.fn(async (url: string, init?: RequestInit) => {
  const u = String(url);
  const method = init?.method ?? 'GET';
  if (u.includes('raw.githubusercontent.com')) return u.includes('/main/') ? textRes(200, baseYaml) : textRes(404, '');
  if (u.includes('api.github.com')) {
    ghCalls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'POST' && u.endsWith('/repos/o/r/forks')) return json(202, {});
    if (method === 'GET' && u.endsWith('/repos/dginev/r')) return json(200, {}); // fork ready
    if (method === 'GET' && u.includes('/pulls?head=')) return json(200, []); // no open PR
    if (method === 'DELETE' && u.includes('/git/refs/heads/')) return json(404, {});
    if (method === 'GET' && u.endsWith('/repos/o/r/git/ref/heads/main')) return json(200, { object: { sha: 'S' } });
    if (method === 'GET' && u.includes('/git/ref/heads/')) return json(404, {});
    if (method === 'POST' && u.endsWith('/git/refs')) return json(201, {});
    if (method === 'GET' && u.includes('/contents/open.yml')) return json(404, {});
    if (method === 'PUT' && u.includes('/contents/open.yml')) return json(200, {});
    if (method === 'POST' && u.endsWith('/repos/o/r/pulls')) return json(201, { number: 1, html_url: 'https://github.com/o/r/pull/1' });
    if (method === 'GET' && u.includes('/repos/o/r/pulls/1')) return json(200, { state: 'open' }); // PR-state poll
    throw new Error(`unrouted ${method} ${u}`);
  }
  return textRes(404, '');
});

describe('App (integration: save/branch flow)', () => {
  beforeAll(() => {
    // jsdom's <dialog> may lack showModal/close; no-op polyfills keep App's dialog effects from throwing.
    HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) { this.open = true; };
    HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) { this.open = false; };
  });
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/'); // isolate the ?filter= URL between tests
    ghCalls.length = 0;
    fetchStub.mockClear();
    vi.stubGlobal('fetch', fetchStub);
    vi.stubGlobal('open', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens the user’s own PR: forks, commits the edit, and tracks the PR', async () => {
    // Signed in (handle != repo owner → fork path), with one pending edit restored from the cache.
    localStorage.setItem('intent-editor.identity', JSON.stringify({ handle: 'dginev', token: 'gho_x' }));
    localStorage.setItem(
      'intent-editor.edits',
      JSON.stringify({ 'power#2': { value: edited, baseAtEdit: base } }),
    );

    render(<App />);

    const save = await screen.findByTestId('save-batch');
    await waitFor(() => expect(save).toBeEnabled()); // dirty from the cached edit

    fireEvent.click(save); // open the "Describe your changes" confirm modal
    const confirm = await screen.findByTestId('save-confirm');
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    await screen.findByText(/PR #1/); // PR tracked + status shown

    // The PR is opened on upstream with the fork as head; the commit carries the edited content.
    const pr = ghCalls.find((c) => c.method === 'POST' && c.url.endsWith('/repos/o/r/pulls'));
    expect(pr?.body?.title).toBe('edit: power; by @dginev');
    expect(pr?.body?.head).toMatch(/^dginev:dginev-\d{8}-power$/);
    const put = ghCalls.find((c) => c.method === 'PUT' && c.url.includes('/contents/open.yml'));
    expect(put?.body?.branch).toMatch(/^dginev-\d{8}-power$/);
    expect(atob(put?.body?.content ?? '')).toContain('$1 raised to $2'); // the edited value, serialized
    expect(ghCalls.some((c) => c.url.endsWith('/repos/o/r/forks'))).toBe(true); // forked (handle != owner)

    const storedPr = JSON.parse(localStorage.getItem('intent-editor.pr')!);
    expect(storedPr.number).toBe(1);
    expect(storedPr.headOwner).toBe('dginev'); // branch lives in the fork
  });

  it('hydrates the filter from ?filter= and syncs edits back into the URL', async () => {
    window.history.replaceState(null, '', '/?filter=power');
    render(<App />);

    const input = (await screen.findByPlaceholderText('Filter concepts…')) as HTMLInputElement;
    expect(input.value).toBe('power'); // hydrated from the URL
    await screen.findByText(/match/); // count reflects a filtered view

    fireEvent.change(input, { target: { value: '' } }); // clearing drops the param
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('gates editing behind sign-in when a service is configured', async () => {
    render(<App />); // no identity in storage
    await screen.findByTestId('concept-count');
    // The login-gated affordances are absent until signed in.
    expect(screen.queryByTestId('save-batch')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add entry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeInTheDocument();
  });
});
