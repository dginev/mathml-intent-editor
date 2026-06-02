import jwt from 'jsonwebtoken';

/**
 * Stateless identity sessions: `/auth` signs a JWT carrying the verified `@handle`; `/submit` verifies
 * it. No session store — the signature is the proof. `secret` is a long random string (env JWT_SECRET).
 * The TTL is a sliding window: `/renew` re-issues a fresh-TTL token for any still-valid session, so a
 * user who returns within the window stays signed in; a longer absence expires and must re-auth.
 */
export function makeSession(secret, ttl = '7d') {
  if (!secret) throw new Error('JWT_SECRET is required');
  return {
    // Carry the numeric `id` too, so `/submit` can build the contributor's no-reply commit-author email.
    signSession: ({ handle, id }) => jwt.sign({ handle, id }, secret, { expiresIn: ttl }),
    verifySession: (token) => jwt.verify(token, secret), // -> { handle, id, iat, exp }; throws if invalid
  };
}
