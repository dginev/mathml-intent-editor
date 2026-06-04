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

/** A JWT-shaped token whose `exp` is `days` out (so the renew-on-visit threshold isn't tripped). */
const jwtExp = (days: number): string => {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const body = btoa(JSON.stringify({ handle: 'dginev', exp }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `h.${body}.s`;
};

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
const jsonRes = (obj: unknown) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });

const submitBodies: Array<Record<string, string>> = [];
const fetchStub = vi.fn(async (url: string, init?: RequestInit) => {
  const u = String(url);
  if (u.includes('raw.githubusercontent.com')) return u.includes('/main/') ? textRes(200, baseYaml) : textRes(404, '');
  if (u.includes('/submit')) {
    submitBodies.push(JSON.parse(String(init?.body)));
    return jsonRes({ prNumber: 1, prUrl: 'https://github.com/o/r/pull/1' });
  }
  if (u.includes('/renew')) return jsonRes({ handle: 'dginev', jwt: jwtExp(7) });
  return textRes(404, '');
});

describe('App (integration: save/branch flow)', () => {
  beforeAll(() => {
    // jsdom's <dialog> may lack showModal/close; no-op polyfills keep App's dialog effects from throwing.
    HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) { this.open = true; };
    HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) { this.open = false; };
    // jsdom does no layout: give elements a viewport-sized box so TanStack Virtual renders table rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/'); // isolate the ?filter= URL between tests
    submitBodies.length = 0;
    fetchStub.mockClear();
    vi.stubGlobal('fetch', fetchStub);
    vi.stubGlobal('open', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('submits the batch as a PR: builds the payload + a fresh unique branch, then tracks the PR', async () => {
    // Signed in, with one pending edit restored from the cache → the session loads dirty.
    localStorage.setItem('intent-editor.identity', JSON.stringify({ handle: 'dginev', jwt: jwtExp(7) }));
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

    await waitFor(() => expect(submitBodies).toHaveLength(1));
    const body = submitBodies[0];
    expect(body.branch).toMatch(/^dginev-\d{8}-power$/); // fresh unique branch (no open PR yet)
    expect(body.title).toBe('edit: power; by @dginev');
    expect(body.content).toContain('$1 raised to $2'); // the edited value, serialized

    await screen.findByText(/PR #1/); // PR tracked + status shown
    expect(JSON.parse(localStorage.getItem('intent-editor.pr')!).number).toBe(1);
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

  it('hydrates the speech language from ?lang= and shows that language column', async () => {
    // A dictionary carrying a Bulgarian template alongside English.
    const bgYaml = w3cYaml([
      { concept: 'power', arity: 2, en: base.en, bg: 'степен', mathml: base.mathml },
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('raw.githubusercontent.com')) return u.includes('/main/') ? textRes(200, bgYaml) : textRes(404, '');
        return textRes(404, '');
      }),
    );
    window.history.replaceState(null, '', '/?lang=bg');
    render(<App />);

    const select = (await screen.findByRole('combobox', { name: 'Speech language' })) as HTMLSelectElement;
    expect(select.value).toBe('bg'); // hydrated from the URL
    await screen.findByText('степен'); // the bg template is shown in the Speech column

    // Switching back to English drops the param from the URL (en is the default).
    fireEvent.change(select, { target: { value: 'en' } });
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
