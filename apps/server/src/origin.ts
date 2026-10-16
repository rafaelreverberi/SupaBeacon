/** Canonical browser origin: never derive OAuth redirects from untrusted request headers. */
export function validOrigin(value: string) {
  const u = new URL(value);
  if (
    !['http:', 'https:'].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.pathname !== '/' ||
    u.search ||
    u.hash
  )
    throw new Error('APP_URL must be an HTTP(S) origin');
  return u.origin;
}
export function resolvePublicOrigin({
  appUrl = 'http://localhost:8080',
  dashboardPort,
  mode = 'auto',
}: {
  appUrl?: string;
  dashboardPort?: number;
  mode?: 'auto' | 'explicit';
}) {
  const url = new URL(validOrigin(appUrl));
  if (
    dashboardPort !== undefined &&
    (!Number.isInteger(dashboardPort) || dashboardPort < 1 || dashboardPort > 65535)
  ) {
    throw new Error('DASHBOARD_PORT must be an integer from 1 to 65535');
  }
  // HTTPS normally terminates at a reverse proxy: its public port must not follow Docker's host port.
  // Explicit mode also covers SSH forwarding and HTTP proxies with a different browser-facing port.
  if (mode === 'auto' && url.protocol === 'http:' && dashboardPort !== undefined)
    url.port = String(dashboardPort);
  return url.origin;
}
