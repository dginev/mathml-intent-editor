import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers } from './handlers.js';

// Fake dependencies — no network, no Fastify. We verify the route logic in isolation.
function deps(overrides = {}) {
  const calls = { submit: [], reset: [] };
  const base = {
    exchangeCode: async (code) => `user-token-for-${code}`,
    loginFor: async (token) =>
      token === 'user-token-for-CODE' ? { login: 'dginev', id: 1234 } : { login: 'someone', id: 7 },
    signSession: ({ handle, id }) => `jwt(${handle}:${id})`,
    verifySession: (jwt) => {
      const m = /^jwt\((.+):(\d+)\)$/.exec(jwt);
      if (!m) throw new Error('bad jwt');
      return { handle: m[1], id: Number(m[2]) };
    },
    submit: async (arg) => {
      calls.submit.push(arg);
      return { prNumber: 7, prUrl: 'https://github.com/dginev/mathml-intent-open/pull/7' };
    },
    reset: async (arg) => {
      calls.reset.push(arg);
      return { deleted: true };
    },
    ...overrides,
  };
  return { handlers: createHandlers(base), calls };
}

test('auth: exchanges code → handle + id → signed JWT', async () => {
  const { handlers } = deps();
  const out = await handlers.auth({ code: 'CODE' });
  assert.equal(out.jwt, 'jwt(dginev:1234)');
  assert.equal(out.handle, 'dginev');
});

test('auth: rejects a missing code with 400', async () => {
  const { handlers } = deps();
  await assert.rejects(() => handlers.auth({}), (e) => e.status === 400);
});

test('submit: verifies the JWT and runs the bot submit, authored as the contributor', async () => {
  const { handlers, calls } = deps();
  const out = await handlers.submit({
    authorization: 'Bearer jwt(dginev:1234)',
    body: {
      content: 'open: yaml',
      message: 'edit power',
      title: 'edit: power; by @dginev',
      description: '### changes',
      branch: 'dginev-20260531-power',
    },
  });
  assert.equal(out.prNumber, 7);
  assert.deepEqual(calls.submit[0], {
    handle: 'dginev',
    content: 'open: yaml',
    message: 'edit power',
    title: 'edit: power; by @dginev',
    description: '### changes',
    branch: 'dginev-20260531-power',
    authorEmail: '1234+dginev@users.noreply.github.com', // commit attributed to the contributor
  });
});

test('submit: rejects a missing/invalid JWT with 401', async () => {
  const { handlers } = deps();
  await assert.rejects(
    () => handlers.submit({ authorization: '', body: { content: 'x' } }),
    (e) => e.status === 401,
  );
});

test('submit: rejects missing content with 400', async () => {
  const { handlers } = deps();
  await assert.rejects(
    () => handlers.submit({ authorization: 'Bearer jwt(dginev:1234)', body: {} }),
    (e) => e.status === 400,
  );
});

test('submit: defaults a commit message mentioning the handle', async () => {
  const { handlers, calls } = deps();
  await handlers.submit({ authorization: 'Bearer jwt(dginev:1234)', body: { content: 'x' } });
  assert.match(calls.submit[0].message, /dginev/);
});

test('reset: verifies the JWT and deletes the caller’s branch', async () => {
  const { handlers, calls } = deps();
  const out = await handlers.reset({
    authorization: 'Bearer jwt(dginev:1234)',
    body: { branch: 'dginev-20260531-power' },
  });
  assert.deepEqual(out, { deleted: true });
  assert.deepEqual(calls.reset[0], { handle: 'dginev', branch: 'dginev-20260531-power' });
});

test('reset: rejects a missing/invalid JWT with 401', async () => {
  const { handlers, calls } = deps();
  await assert.rejects(() => handlers.reset({ authorization: '' }), (e) => e.status === 401);
  assert.equal(calls.reset.length, 0);
});

test('renew: re-issues a fresh JWT for the same handle on a valid session', async () => {
  const { handlers } = deps();
  const out = await handlers.renew({ authorization: 'Bearer jwt(dginev:1234)' });
  assert.deepEqual(out, { jwt: 'jwt(dginev:1234)', handle: 'dginev' });
});

test('renew: rejects a missing/invalid (e.g. expired) JWT with 401', async () => {
  const { handlers } = deps();
  await assert.rejects(() => handlers.renew({ authorization: 'Bearer nope' }), (e) => e.status === 401);
});
