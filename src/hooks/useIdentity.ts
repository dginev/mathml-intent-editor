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
  saveIdentity,
  type Identity,
} from '../github/auth';

type ServiceConfig = { serviceUrl: string; clientId: string };

/**
 * The GitHub identity lifecycle: redirect to the OAuth App, complete the callback (exchange the code at
 * `/auth` for the user's `@handle` + access token), and persist it. The token is long-lived (classic
 * OAuth), so there's no expiry/renew/JWT handling — `signOut` (composed by the caller) or a rejected
 * `api.github.com` call (401 → the caller signs out) ends a session. Sign-in failures (incl. OAuth
 * `?error=`) are delivered via `onSignInError`.
 */
export function useIdentity({
  service,
  onSignInError,
}: {
  service: ServiceConfig | null;
  onSignInError?: (message: string) => void;
}): { identity: Identity | null; authPending: boolean; signIn: () => void; expireSession: () => void } {
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity(localStorage));
  // True from the redirect back (?code=…) until /auth resolves — drives the "Signing in…" spinner.
  const [authPending, setAuthPending] = useState(() => !!(service && parseCallback(window.location.search)));

  // Latest callback, read from the effect without making it a dependency (avoids needless re-runs).
  const cb = useRef({ onSignInError });
  useEffect(() => {
    cb.current = { onSignInError };
  });

  // Complete the OAuth redirect: a success (?code=…&state=…) is exchanged via /auth for the identity; a
  // failure (?error=…&error_description=…, e.g. the user cancelled) is surfaced via onSignInError. Both
  // clean the URL and clear the "Signing in…" pending state through the shared catch/finally.
  useEffect(() => {
    if (!service) return;
    const err = parseCallbackError(window.location.search);
    const ok = parseCallback(window.location.search);
    if (!err && !ok) return;
    window.history.replaceState(null, '', window.location.origin + window.location.pathname);
    void (err
      ? Promise.reject(new Error(err.description || err.error))
      : ok!.state === consumeState(localStorage)
        ? exchangeCodeForIdentity(service.serviceUrl, ok!.code).then((id) => {
            saveIdentity(localStorage, id);
            setIdentity(id);
          })
        : Promise.reject(new Error('state mismatch'))
    )
      .catch((e) => cb.current.onSignInError?.(`Sign-in failed: ${e instanceof Error ? e.message : String(e)}`))
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

  return { identity, authPending, signIn, expireSession };
}
