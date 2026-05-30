/**
 * Send an edit to the service's `/submit`: the bot commits the new `open.yml` to `intent/<handle>` and
 * ensures the PR is open. The identity JWT (from `/auth`) authenticates the call.
 */
export async function submitToService(
  serviceUrl: string,
  jwt: string,
  edit: { content: string; message: string },
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
