/**
 * Route logic for the two endpoints, decoupled from Fastify and GitHub so it can be unit-tested with
 * fake `deps`. `server.js` wires these to real dependencies (`github.js`, `session.js`).
 *
 * deps: {
 *   exchangeCode(code) -> userToken          // GitHub App client_id + secret (server-side)
 *   loginFor(userToken) -> handle            // GET /user
 *   signSession(handle) -> jwt               // our identity JWT
 *   verifySession(jwt) -> { handle }         // throws if invalid
 *   submit({ handle, content, message }) -> { prNumber, prUrl }   // bot commit + PR
 *   reset({ handle }) -> { deleted }         // bot deletes the stale intent/<handle> branch
 * }
 */
export function createHandlers(deps) {
  const fail = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
  };

  return {
    /** POST /auth — finish OAuth, return an identity JWT (the user token is discarded). */
    async auth(body) {
      if (!body || !body.code) throw fail(400, 'missing code');
      const userToken = await deps.exchangeCode(body.code);
      const handle = await deps.loginFor(userToken);
      return { jwt: deps.signSession(handle), handle };
    },

    /** POST /submit — verify identity, then the bot commits + opens/updates the PR. */
    async submit({ authorization, body }) {
      const jwt = (authorization || '').replace(/^Bearer\s+/i, '');
      let handle;
      try {
        handle = deps.verifySession(jwt).handle;
      } catch {
        throw fail(401, 'invalid session');
      }
      if (!body || typeof body.content !== 'string') throw fail(400, 'missing content');
      const message = body.message || `Update open.yml (proposed by @${handle})`;
      return deps.submit({ handle, content: body.content, message });
    },

    /** POST /reset — verify identity, then the bot deletes the caller's stale `intent/<handle>` branch. */
    async reset({ authorization }) {
      const jwt = (authorization || '').replace(/^Bearer\s+/i, '');
      let handle;
      try {
        handle = deps.verifySession(jwt).handle;
      } catch {
        throw fail(401, 'invalid session');
      }
      return deps.reset({ handle });
    },

    /**
     * POST /renew — sliding session: verify the *current* (still-valid) JWT and re-issue a fresh-TTL
     * one for the same handle. No GitHub round-trip; an expired token can't renew (verify throws → 401),
     * so absences longer than the TTL still force a re-auth.
     */
    async renew({ authorization }) {
      const jwt = (authorization || '').replace(/^Bearer\s+/i, '');
      let handle;
      try {
        handle = deps.verifySession(jwt).handle;
      } catch {
        throw fail(401, 'invalid session');
      }
      return { jwt: deps.signSession(handle), handle };
    },
  };
}
