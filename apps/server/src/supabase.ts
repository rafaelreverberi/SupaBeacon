import { z } from 'zod';
import { Store } from './storage.js';
import { vault } from './crypto.js';
import { retryDelay } from './schedule.js';
export class ServiceError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public retryAfter: string | null = null,
  ) {
    super(code);
  }
}
export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  dataEnabled: boolean;
}
interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope?: string;
}
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});
export type Transport = typeof fetch;
export class Supabase {
  private refreshing?: Promise<string>;
  private disconnecting = false;
  private epoch = 0;
  constructor(
    public store: Store,
    public box: ReturnType<typeof vault>,
    public transport: Transport = fetch,
  ) {}
  config() {
    const c = this.store.get<string>('oauth_config');
    return c ? this.box.open<OAuthConfig>(c) : null;
  }
  tokens() {
    const t = this.store.get<string>('oauth_tokens');
    return t ? this.box.open<Tokens>(t) : null;
  }
  status() {
    const c = this.config(),
      t = this.tokens();
    return {
      configured: !!c,
      connected: !!t && !this.store.get('reauthorize'),
      reauthorize: !!this.store.get('reauthorize'),
      dataEnabled: c?.dataEnabled ?? false,
      scopes: t?.scope?.split(/[ ,]+/) ?? [],
      expectedScopes: [
        'projects:read',
        'database:read',
        ...(c?.dataEnabled ? ['secrets:read'] : []),
      ],
      lastSync: this.store.get<number>('last_sync'),
      syncError: this.store.get<string>('sync_error'),
    };
  }
  async request(url: string, init: RequestInit = {}): Promise<Response> {
    const wait = this.store.get<number>('rate_until');
    if (wait && wait > Date.now())
      throw new ServiceError('RATE_LIMITED', 429, String(Math.ceil((wait - Date.now()) / 1000)));
    let response: Response;
    try {
      response = await this.transport(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(this.store.settings().timeout * 1000),
      });
    } catch {
      throw new ServiceError('UPSTREAM_UNREACHABLE', 503);
    }
    if (response.status === 429) {
      const delay = retryDelay(0, response.headers.get('retry-after'));
      this.store.set('rate_until', Date.now() + delay);
      this.store.log('warning', 'rate_limit_encountered');
    }
    return response;
  }
  async exchange(params: URLSearchParams) {
    if (this.disconnecting) throw new ServiceError('OAUTH_DISCONNECTING', 409);
    const epoch = this.epoch;
    if (params.get('grant_type') === 'authorization_code' && this.refreshing)
      await this.refreshing.catch(() => {});
    const c = this.config();
    if (!c) throw new ServiceError('OAUTH_NOT_CONFIGURED');
    const r = await this.request('https://api.supabase.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`,
      },
      body: params,
    });
    if (!r.ok) {
      if ([400, 401, 403].includes(r.status) && params.get('grant_type') === 'refresh_token') {
        this.store.set('reauthorize', true);
        this.store.log('warning', 'oauth_authorization_expired');
      }
      await r.body?.cancel();
      throw new ServiceError(
        [400, 401, 403].includes(r.status) ? 'OAUTH_REAUTHORIZE' : 'OAUTH_EXCHANGE_FAILED',
        r.status >= 500 ? 503 : r.status,
        r.headers.get('retry-after'),
      );
    }
    const t = tokenSchema.parse(await r.json());
    if (epoch !== this.epoch) throw new ServiceError('OAUTH_AUTHORIZATION_CHANGED', 409);
    this.store.set(
      'oauth_tokens',
      this.box.seal({ ...t, expires_at: Date.now() + t.expires_in * 1000 }),
    );
    this.store.set('reauthorize', false);
    return t.access_token;
  }
  async token(force = false): Promise<string> {
    if (this.disconnecting) throw new ServiceError('OAUTH_DISCONNECTING', 409);
    if (this.store.get('reauthorize')) throw new ServiceError('OAUTH_REAUTHORIZE', 401);
    const t = this.tokens();
    if (!t) throw new ServiceError('SUPABASE_NOT_CONNECTED', 409);
    if (!force && t.expires_at > Date.now() + 60_000) return t.access_token;
    if (!this.refreshing)
      this.refreshing = this.exchange(
        new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token }),
      )
        .then((access) => {
          this.store.log('info', 'oauth_token_refreshed');
          return access;
        })
        .finally(() => {
          this.refreshing = undefined;
        });
    return this.refreshing;
  }
  async api(path: string, init: RequestInit = {}, refreshed = false): Promise<Response> {
    const r = await this.request(`https://api.supabase.com/v1${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
        Authorization: `Bearer ${await this.token()}`,
      },
    });
    if (r.status === 401) {
      await r.body?.cancel();
      if (!refreshed) {
        await this.token(true);
        return this.api(path, init, true);
      }
      this.store.set('reauthorize', true);
      this.store.log('warning', 'oauth_authorization_expired');
      throw new ServiceError('OAUTH_REAUTHORIZE', 401);
    }
    if (!r.ok) {
      await r.body?.cancel();
      throw new ServiceError(
        r.status === 403
          ? 'PROJECT_PERMISSION_DENIED'
          : r.status === 429
            ? 'RATE_LIMITED'
            : 'SUPABASE_REQUEST_FAILED',
        r.status,
        r.headers.get('retry-after'),
      );
    }
    return r;
  }
  async publicKey(ref: string) {
    if (!this.config()?.dataEnabled) throw new ServiceError('DATA_STRATEGY_NOT_AUTHORIZED');
    // List WITHOUT revealing secret keys; reveal only an explicitly typed publishable key by ID.
    const metadata = z
      .array(
        z.object({ id: z.string().nullable().optional(), type: z.string().nullable().optional() }),
      )
      .parse(await (await this.api(`/projects/${ref}/api-keys?reveal=false`)).json());
    const key = metadata.find((k) => k.type === 'publishable' && k.id);
    if (!key?.id) throw new ServiceError('NO_PUBLISHABLE_KEY');
    const response = z
      .object({ type: z.literal('publishable'), api_key: z.string().startsWith('sb_publishable_') })
      .parse(
        await (
          await this.api(`/projects/${ref}/api-keys/${encodeURIComponent(key.id)}?reveal=true`)
        ).json(),
      );
    return response.api_key;
  }
  async disconnect() {
    if (this.disconnecting) throw new ServiceError('OAUTH_DISCONNECTING', 409);
    this.disconnecting = true;
    try {
      await this.refreshing?.catch(() => {});
      this.epoch++;
      const c = this.config(),
        t = this.tokens();
      let providerRevoked = false;
      if (c && t) {
        const r = await this.request('https://api.supabase.com/v1/oauth/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: c.clientId,
            client_secret: c.clientSecret,
            refresh_token: t.refresh_token,
          }),
        });
        if (!r.ok && ![400, 401, 403].includes(r.status)) {
          await r.body?.cancel();
          throw new ServiceError('OAUTH_REVOCATION_FAILED', 502);
        }
        providerRevoked = r.ok;
        await r.body?.cancel();
      }
      this.store.set('oauth_tokens', null);
      this.store.set('reauthorize', false);
      this.store.db.prepare('DELETE FROM oauth_flow').run();
      this.store.log(
        providerRevoked ? 'info' : 'warning',
        providerRevoked ? 'oauth_disconnected' : 'oauth_disconnected_local_only',
      );
      return { ok: true, providerRevoked };
    } finally {
      this.disconnecting = false;
    }
  }
}
const remoteProjects = z.array(
  z.object({
    id: z.string().regex(/^[a-z]{20}$/),
    name: z.string().max(200),
    organization_id: z.string(),
    region: z.string(),
    status: z.string(),
  }),
);
export class Discovery {
  private running?: Promise<void>;
  constructor(public api: Supabase) {}
  sync(): Promise<void> {
    if (!this.running)
      this.running = this.perform().finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async perform() {
    const s = this.api.store;
    try {
      const projects = remoteProjects.parse(await (await this.api.api('/projects')).json());
      const now = Date.now();
      s.db.transaction(() => {
        s.db.prepare('UPDATE projects SET present=0').run();
        for (const p of projects) {
          const old = s.project(p.id);
          s.db
            .prepare(
              `INSERT INTO projects(id,name,organization,region,status,enabled,first_seen,last_seen) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,organization=excluded.organization,region=excluded.region,status=excluded.status,present=1,last_seen=excluded.last_seen`,
            )
            .run(
              p.id,
              p.name,
              p.organization_id,
              p.region,
              p.status,
              Number(s.settings().autoEnable),
              now,
              now,
            );
          if (!old) s.log('info', 'new_project_detected', p.id);
          else if (old.status !== p.status)
            s.log('info', 'project_status_changed', p.id, { before: old.status, after: p.status });
        }
        // Absence may mean revoked visibility rather than deletion. Never label it deleted.
        s.set('last_sync', now);
        s.set('sync_error', null);
        s.log('info', 'projects_discovered', null, { count: projects.length });
      })();
    } catch (e) {
      s.set('sync_error', e instanceof ServiceError ? e.code : 'DISCOVERY_RESPONSE_INVALID');
      s.log('error', 'project_discovery_failed');
      throw e;
    }
  }
}
