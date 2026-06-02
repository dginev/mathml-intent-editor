import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers } from './handlers.js';

// Fake dependencies — no network, no Fastify. We verify the route logic in isolation.
function handlers(overrides = {}) {
  return createHandlers({
    exchangeCode: async (code) => `user-token-for-${code}`,
    loginFor: async (token) => (token === 'user-token-for-CODE' ? 'dginev' : 'someone'),
    ...overrides,
  });
}

test('auth: exchanges code → user token + handle (both returned to the browser)', async () => {
  const out = await handlers().auth({ code: 'CODE' });
  assert.deepEqual(out, { handle: 'dginev', token: 'user-token-for-CODE' });
});

test('auth: rejects a missing code with 400', async () => {
  await assert.rejects(() => handlers().auth({}), (e) => e.status === 400);
});

test('auth: surfaces an exchange failure', async () => {
  const h = handlers({
    exchangeCode: async () => {
      throw new Error('OAuth exchange failed: bad_verification_code');
    },
  });
  await assert.rejects(() => h.auth({ code: 'X' }), /OAuth exchange failed/);
});
