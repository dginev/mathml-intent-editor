/**
 * Route logic for the single endpoint, decoupled from Fastify and GitHub so it can be unit-tested with
 * fake `deps`. `server.js` wires this to the real `github.js`.
 *
 * The service exists only to hold the OAuth client secret: `github.com/login/oauth/access_token` has no
 * CORS and needs the secret, so the browser can't do the code→token exchange itself. Everything else
 * (fork, commit, open PR) the browser does directly against api.github.com with the returned token.
 *
 * deps: {
 *   exchangeCode(code) -> userToken     // GitHub OAuth App client_id + secret (server-side)
 *   loginFor(userToken) -> handle       // GET /user
 * }
 */
export function createHandlers(deps) {
  const fail = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
  };

  return {
    /** POST /auth — finish OAuth: exchange the code for the user's GitHub token + handle (both returned). */
    async auth(body) {
      if (!body || !body.code) throw fail(400, 'missing code');
      const token = await deps.exchangeCode(body.code);
      const handle = await deps.loginFor(token);
      return { handle, token };
    },
  };
}
