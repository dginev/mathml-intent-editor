import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildAuthorizeUrl,
  clearIdentity,
  consumeState,
  exchangeCodeForIdentity,
  loadIdentity,
  parseCallback,
  parseCallbackError,
  randomState,
  rememberState,
  renewIdentity,
  saveIdentity,
  secondsUntilExpiry,
  type Identity,
} from '../github/auth';

type ServiceConfig = { serviceUrl: string; clientId: string };

/** Renew the session on a visit once it has dipped below this (6 of its 7 days) — keeps an active user
 *  signed in indefinitely without renewing a token that was just minted. */
const RENEW_BELOW_SECONDS = 6 * 24 * 60 * 60;

/**
 * The GitHub identity + session lifecycle: completing the OAuth redirect, the signed `@handle`+JWT (a
 * sliding-TTL token), proactive sign-out at expiry, and renew-on-visit. Side effects that belong to the
 * page (status line, expiry toast) are delivered via callbacks. Returns the identity + `signIn`/
 * `expireSession`; the caller composes its own sign-out (this hook only clears the identity).
 */
export function useIdentity({
  service,
  onSignInError,
  onSessionExpired,
}: {
  service: ServiceConfig | null;
  onSignInError?: (message: string) => void;
  onSessionExpired?: () => void;
}): { identity: Identity | null; authPending: boolean; signIn: () => void; expireSession: () => void } {
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity(localStorage));
  // True from the redirect back (?code=…) until /auth resolves — drives the "Signing in…" spinner.
  const [authPending, setAuthPending] = useState(() => !!(service && parseCallback(window.location.search)));

  // Latest callbacks, read from effects without making them dependencies (avoids needless re-runs).
  const cbs = useRef({ onSignInError, onSessionExpired });
  useEffect(() => {
    cbs.current = { onSignInError, onSessionExpired };
  });

  // Complete the OAuth redirect: a success (?code=…&state=…) is exchanged via /auth for an identity; a
  // failure (?error=…&error_description=…, e.g. the user cancelled) is surfaced via onSignInError. Both
  // clean the URL and clear the "Signing in…" pending state through the shared catch/finally.
  useEffect(() => {
    if (!service) return;
    const err = parseCallbackError(window.location.search);
    const cb = parseCallback(window.location.search);
    if (!err && !cb) return;
    window.history.replaceState(null, '', window.location.origin + window.location.pathname);
    void (err
      ? Promise.reject(new Error(err.description || err.error))
      : cb!.state === consumeState(localStorage)
        ? exchangeCodeForIdentity(service.serviceUrl, cb!.code).then((id) => {
            saveIdentity(localStorage, id);
            setIdentity(id);
          })
        : Promise.reject(new Error('state mismatch'))
    )
      .catch((e) => cbs.current.onSignInError?.(`Sign-in failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setAuthPending(false));
  }, [service]);

  const signIn = useCallback(() => {
    if (!service) return;
    const state = randomState();
    rememberState(localStorage, state);
    const redirectUri = window.location.origin + window.location.pathname;
    window.location.assign(buildAuthorizeUrl(service.clientId, redirectUri, state));
  }, [service]);

  /** Drop the identity (keeps the PR pointer + local edits) — UI returns to "signed out". */
  const expireSession = useCallback(() => {
    clearIdentity(localStorage);
    setIdentity(null);
  }, []);

  // Proactively sign out the instant the session JWT expires, even with no save attempt to surface a 401.
  useEffect(() => {
    if (!identity) return;
    const secs = secondsUntilExpiry(identity);
    if (secs == null) return; // no exp claim → nothing to schedule
    const t = setTimeout(
      () => {
        expireSession();
        cbs.current.onSessionExpired?.();
      },
      Math.max(0, secs) * 1000,
    );
    return () => clearTimeout(t);
  }, [identity, expireSession]);

  // Sliding session: on a visit, swap an aged-but-valid token for a fresh-TTL one so active users never
  // re-auth. Loop-safe (renewed token is fresh → above the threshold) and graceful before /renew is
  // deployed (a non-401 failure keeps the token; a 401 means the session is genuinely dead).
  useEffect(() => {
    if (!service || !identity) return;
    const secs = secondsUntilExpiry(identity);
    if (secs == null || secs >= RENEW_BELOW_SECONDS) return;
    let live = true;
    void renewIdentity(service.serviceUrl, identity.jwt)
      .then((id) => {
        if (!live) return;
        saveIdentity(localStorage, id);
        setIdentity(id);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (live && /\b401\b|invalid session|unauthor/i.test(msg)) expireSession();
      });
    return () => {
      live = false;
    };
  }, [service, identity, expireSession]);

  return { identity, authPending, signIn, expireSession };
}
