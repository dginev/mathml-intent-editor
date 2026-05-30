import jwt from 'jsonwebtoken';

/**
 * Stateless identity sessions: `/auth` signs a JWT carrying the verified `@handle`; `/submit` verifies
 * it. No session store — the signature is the proof. `secret` is a long random string (env JWT_SECRET).
 */
export function makeSession(secret, ttl = '12h') {
  if (!secret) throw new Error('JWT_SECRET is required');
  return {
    signSession: (handle) => jwt.sign({ handle }, secret, { expiresIn: ttl }),
    verifySession: (token) => jwt.verify(token, secret), // -> { handle, iat, exp }; throws if invalid
  };
}
