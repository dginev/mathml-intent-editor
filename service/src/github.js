const UA = 'mathml-intent-editor-service';

/** Exchange a user OAuth `code` for the user's access token (OAuth App client_id + secret). */
export async function exchangeCode(code, { clientId, clientSecret }) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`OAuth exchange failed: ${data.error_description || data.error || res.status}`);
  }
  return data.access_token;
}

/** Resolve the authenticated user's `@handle` from a user token. */
export async function loginFor(userToken) {
  const res = await fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${userToken}`, accept: 'application/vnd.github+json', 'user-agent': UA },
  });
  if (!res.ok) throw new Error(`User lookup failed: ${res.status}`);
  const data = await res.json();
  if (!data.login) throw new Error('No login on user response');
  return data.login;
}
