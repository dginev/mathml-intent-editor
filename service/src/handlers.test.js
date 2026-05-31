import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers } from './handlers.js';

// Fake dependencies — no network, no Fastify. We verify the route logic in isolation.
function deps(overrides = {}) {
  const calls = { submit: [], reset: [] };
  const base = {
    exchangeCode: async (code) => `user-token-for-${code}`,
    loginFor: async (token) => (token === 'user-token-for-CODE' ? 'dginev' : 'someone'),
    signSession: (handle) => `jwt(${handle})`,
    verifySession: (jwt) => {
      const m = /^jwt\((.+)\)$/.exec(jwt);
      if (!m) throw new Error('bad jwt');
      return { handle: m[1] };
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

test('auth: exchanges code → handle → signed JWT', async () => {
  const { handlers } = deps();
  const out = await handlers.auth({ code: 'CODE' });
  assert.equal(out.jwt, 'jwt(dginev)');
  assert.equal(out.handle, 'dginev');
});

test('auth: rejects a missing code with 400', async () => {
  const { handlers } = deps();
  await assert.rejects(() => handlers.auth({}), (e) => e.status === 400);
});

test('submit: verifies the JWT and runs the bot submit', async () => {
  const { handlers, calls } = deps();
  const out = await handlers.submit({
    authorization: 'Bearer jwt(dginev)',
    body: { content: 'open: yaml', message: 'edit power' },
  });
  assert.equal(out.prNumber, 7);
  assert.deepEqual(calls.submit[0], { handle: 'dginev', content: 'open: yaml', message: 'edit power' });
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
    () => handlers.submit({ authorization: 'Bearer jwt(dginev)', body: {} }),
    (e) => e.status === 400,
  );
});

test('submit: defaults a commit message mentioning the handle', async () => {
  const { handlers, calls } = deps();
  await handlers.submit({ authorization: 'Bearer jwt(dginev)', body: { content: 'x' } });
  assert.match(calls.submit[0].message, /dginev/);
});

test('reset: verifies the JWT and deletes the caller’s branch', async () => {
  const { handlers, calls } = deps();
  const out = await handlers.reset({ authorization: 'Bearer jwt(dginev)' });
  assert.deepEqual(out, { deleted: true });
  assert.deepEqual(calls.reset[0], { handle: 'dginev' });
});

test('reset: rejects a missing/invalid JWT with 401', async () => {
  const { handlers, calls } = deps();
  await assert.rejects(() => handlers.reset({ authorization: '' }), (e) => e.status === 401);
  assert.equal(calls.reset.length, 0);
});
