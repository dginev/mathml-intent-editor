/**
 * Send an edit to the service's `/submit`: the bot commits the new `open.yml` to `intent/<handle>` and
 * ensures the PR is open. The identity JWT (from `/auth`) authenticates the call.
 */
export async function submitToService(
  serviceUrl: string,
  jwt: string,
  edit: { content: string; message: string; title?: string; description?: string; branch?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ prNumber: number; prUrl: string }> {
  const res = await fetchImpl(`${serviceUrl}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
    body: JSON.stringify(edit),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Submit failed: ${res.status}`);
  }
  return (await res.json()) as { prNumber: number; prUrl: string };
}

/**
 * Tell the service to delete the caller's `intent/<handle>` branch (called when the client detects the
 * branch's PR was closed/merged) so the next edit starts a fresh branch off the base. JWT-authenticated.
 */
export async function resetSession(
  serviceUrl: string,
  jwt: string,
  branch?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ deleted: boolean }> {
  const res = await fetchImpl(`${serviceUrl}/reset`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ branch }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Reset failed: ${res.status}`);
  }
  return (await res.json()) as { deleted: boolean };
}
