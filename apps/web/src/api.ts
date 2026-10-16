export let csrf = '';
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T = Record<string, unknown>>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && data.error?.code === 'AUTH_REQUIRED')
      window.dispatchEvent(new Event('session-expired'));
    throw new Error(
      data.error?.fields
        ?.map((f: { path: string; message: string }) => `${f.path}: ${f.message}`)
        .join('; ') ||
        data.error?.message ||
        'Request failed',
    );
  }
  return data as T;
}
