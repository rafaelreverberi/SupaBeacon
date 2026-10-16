import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowDownToLine, ExternalLink, ShieldCheck, Zap } from 'lucide-react';
import { defaults, budget, Project, Settings } from '../../../../packages/shared/config';
import { api } from '../api';
import type { Connection, Action } from '../lib/types';
import { time, duration } from '../lib/date';
import { Badge, Button, Field } from '../components/ui';
export function SettingsPage({
  settings,
  connection,
  action,
  busy,
}: {
  settings: Settings & {
    port: string;
    origin: string;
    version: string;
    uptime: number;
    databaseHealth: string;
  };
  connection: Connection;
  action: Action;
  busy: boolean;
}) {
  const [tab, setTab] = useState('General');
  const [draft, setDraft] = useState<Settings>(
    () =>
      Object.fromEntries(
        Object.keys(defaults).map((k) => [k, settings[k as keyof Settings]]),
      ) as Settings,
  );
  const [dataEnabled, setDataEnabled] = useState(connection.dataEnabled);
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () =>
      api<{ items: { id: string; created: number; expires: number; current: boolean }[] }>(
        '/auth/sessions',
      ),
    enabled: tab === 'Security',
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<{ items: Project[] }>('/projects'),
  });
  const change = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const number = (key: keyof Settings, label: string, min: number, max: number, hint?: string) => (
    <Field label={label} hint={hint}>
      <input
        type="number"
        min={min}
        max={max}
        required
        value={String(draft[key])}
        onChange={(e) => change(key, Number(e.target.value) as never)}
      />
    </Field>
  );
  const toggle = (key: keyof Settings, label: string, hint: string) => (
    <label className="setting-switch">
      <span>
        {label}
        <small>{hint}</small>
      </span>
      <input
        type="checkbox"
        checked={!!draft[key]}
        onChange={(e) => change(key, e.target.checked as never)}
      />
      <span className="switch" />
    </label>
  );
  return (
    <>
      <div className="tabs" role="tablist">
        {['General', 'Monitoring', 'Supabase integration', 'Security', 'System'].map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {['General', 'Monitoring'].includes(tab) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(() => api('/settings', 'PATCH', draft), 'Settings saved');
          }}
        >
          <section className="settings-section">
            <h2>{tab === 'General' ? 'Instance preferences' : 'Monitoring defaults'}</h2>
            <p>
              {tab === 'General'
                ? 'Local preferences and automatic project discovery.'
                : 'New projects inherit these settings. Overrides remain specific to each project.'}
            </p>
            <div className="form-grid">
              {tab === 'General' ? (
                <>
                  <Field label="Timezone" hint="IANA timezone, with daylight-saving support.">
                    <input
                      required
                      value={draft.timezone}
                      onChange={(e) => change('timezone', e.target.value)}
                      list="timezones"
                    />
                    <datalist id="timezones">
                      {[
                        'Europe/Zurich',
                        'Europe/Berlin',
                        'Europe/London',
                        'America/New_York',
                        'America/Los_Angeles',
                        'Asia/Tokyo',
                        'UTC',
                      ].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </datalist>
                  </Field>
                  <Field label="Theme">
                    <select
                      value={draft.theme}
                      onChange={(e) => change('theme', e.target.value as Settings['theme'])}
                    >
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                      <option value="system">System</option>
                    </select>
                  </Field>
                  <Field label="Time format">
                    <select
                      value={draft.dateFormat}
                      onChange={(e) =>
                        change('dateFormat', e.target.value as Settings['dateFormat'])
                      }
                    >
                      <option value="24h">24 hour</option>
                      <option value="12h">12 hour</option>
                    </select>
                  </Field>
                  {number('discoveryHours', 'Project discovery interval (hours)', 1, 24)}
                  {number('retentionDays', 'History and log retention (days)', 7, 365)}
                  <Field
                    label="Dashboard port"
                    hint="Edit DASHBOARD_PORT and APP_URL in .env; container recreation required."
                  >
                    <input value={settings.port} readOnly />
                  </Field>
                </>
              ) : (
                <>
                  {number('frequency', 'Heartbeats per day', 1, 6)}
                  {number('requests', 'Requests per heartbeat', 1, 3)}
                  {number('timeout', 'Request timeout (seconds)', 3, 60)}
                  {number('concurrency', 'Maximum concurrent projects', 1, 5)}
                  {number('maxRetries', 'Maximum retries', 0, 3)}
                  {!draft.randomized && (
                    <Field
                      label="Fixed local times"
                      hint="One HH:mm value per heartbeat, separated by commas."
                    >
                      <input
                        value={draft.fixedTimes.join(',')}
                        onChange={(e) =>
                          change(
                            'fixedTimes',
                            e.target.value.split(',').map((v) => v.trim()),
                          )
                        }
                      />
                    </Field>
                  )}
                </>
              )}
            </div>
            {tab === 'Monitoring' ? (
              <>
                {toggle(
                  'enabled',
                  'Global monitoring',
                  'Pause or resume all scheduled and manual database heartbeats.',
                )}
                {toggle(
                  'autoEnable',
                  'Monitor newly discovered projects',
                  'New authorized projects automatically inherit the global defaults.',
                )}
                {toggle(
                  'randomized',
                  'Randomized execution times',
                  'Distribute heartbeats across evenly divided local-day windows.',
                )}
                {toggle(
                  'retry',
                  'Retry transient failures',
                  'Bounded backoff with jitter; respect provider rate limits.',
                )}
                <div className="info-line">
                  <Activity size={17} />
                  <p>
                    Base budget:{' '}
                    <b>
                      {budget(
                        draft,
                        (projects.data?.items ?? []).filter((p) => p.enabled && p.present).length,
                      )}{' '}
                      database requests/day
                    </b>{' '}
                    with inherited defaults. Project overrides, manual runs, retries, status checks,
                    key lookups, and discovery can add requests. More traffic does not guarantee
                    prevention of pausing.
                  </p>
                </div>
              </>
            ) : (
              toggle(
                'autoEnable',
                'Automatically monitor new projects',
                'Projects are discovered at the configured interval. Paused projects are skipped.',
              )
            )}
            <button className="button" disabled={busy}>
              Save settings
            </button>
          </section>
        </form>
      )}
      {tab === 'Supabase integration' && (
        <section className="settings-section">
          <div className="section-title">
            <h2>Supabase Management API OAuth</h2>
            <Badge tone={connection.connected ? 'emerald' : 'neutral'}>
              {connection.connected
                ? 'Connected'
                : connection.reauthorize
                  ? 'Reauthorization required'
                  : 'Not connected'}
            </Badge>
          </div>
          <p>
            Register your own OAuth application. Credentials are encrypted on this server and never
            returned to the browser.
          </p>
          <ol className="setup-steps">
            <li>Open your Supabase organization’s settings → OAuth Apps → Add application.</li>
            <li>
              Register the exact callback below. Enable <code>projects:read</code> and{' '}
              <code>database:read</code> in the application’s permissions.
            </li>
            <li>Enter the client ID and client secret, save, then connect your account.</li>
          </ol>
          <Field label="Callback URL">
            <input value={connection.callback} readOnly onFocus={(e) => e.currentTarget.select()} />
          </Field>
          {!connection.callbackAllowed && (
            <p className="error">
              HTTP LAN callbacks are disabled. Configure a trusted HTTPS reverse proxy and update
              APP_URL, or access through a localhost SSH tunnel.
            </p>
          )}
          <div className="info-line">
            <ShieldCheck size={17} />
            <p>
              Localhost refers to the computer running your browser. A NUC accessed from another
              device needs a reachable HTTPS callback, or an SSH tunnel with a registered localhost
              callback.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action(
                () =>
                  api('/oauth/config', 'PUT', {
                    clientId: f.get('clientId'),
                    clientSecret: f.get('clientSecret'),
                    dataEnabled,
                  }),
                'OAuth integration saved',
              );
            }}
          >
            <fieldset disabled={connection.connected || busy}>
              <div className="form-grid">
                <Field label="OAuth client ID">
                  <input
                    name="clientId"
                    required
                    autoComplete="off"
                    placeholder="00000000-0000-0000-0000-000000000000"
                  />
                </Field>
                <Field label="OAuth client secret">
                  <input
                    name="clientSecret"
                    type="password"
                    minLength={8}
                    required
                    autoComplete="new-password"
                    placeholder={
                      connection.configured
                        ? 'Stored securely · enter to replace'
                        : 'Enter your OAuth client secret'
                    }
                  />
                </Field>
              </div>
              <label className="setting-switch">
                <span>
                  Enable optional Data API strategy
                  <small>
                    Requires secrets:read in your registered OAuth app and reauthorization. This
                    scope is broad: it permits access to project secrets. SupaBeacon reveals only an
                    existing publishable key, never secret or service-role keys. Select an existing
                    safe table per project.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={dataEnabled}
                  onChange={(e) => setDataEnabled(e.target.checked)}
                />
                <span className="switch" />
              </label>
              <button className="button secondary" disabled={busy || !connection.callbackAllowed}>
                Save OAuth configuration
              </button>
            </fieldset>
          </form>
          <div className="inline-actions">
            <Button
              disabled={busy || !connection.configured || !connection.callbackAllowed}
              onClick={() =>
                void action(async () => {
                  const r = await api<{ url: string }>('/oauth/connect', 'POST');
                  location.assign(r.url);
                })
              }
            >
              <Zap size={16} />
              {connection.connected || connection.reauthorize
                ? 'Reconnect Supabase'
                : 'Connect Supabase'}
            </Button>
            {(connection.connected || connection.reauthorize) && (
              <Button
                secondary
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const result = await api<{ providerRevoked: boolean }>(
                      '/oauth/disconnect',
                      'POST',
                    );
                    if (!result.providerRevoked)
                      throw new Error(
                        'Disconnected locally. Provider revocation was not confirmed; remove the integration authorization in Supabase.',
                      );
                  }, 'Supabase disconnected and authorization revoked')
                }
              >
                Disconnect
              </Button>
            )}
            <a
              href="https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration"
              target="_blank"
              rel="noreferrer"
              className="text-link"
            >
              Official registration guide
              <ExternalLink size={13} />
            </a>
          </div>
          <div className="detail-facts">
            <div>
              <small>Expected app permissions</small>
              <code>{connection.expectedScopes.join(', ')}</code>
            </div>
            <div>
              <small>Granted permissions reported by provider</small>
              <code>
                {connection.scopes.length ? connection.scopes.join(', ') : 'Not reported'}
              </code>
            </div>
            <div>
              <small>Last successful sync</small>
              <span>{time(connection.lastSync)}</span>
            </div>
          </div>
          {connection.syncError && <p className="error">Discovery: {connection.syncError}</p>}
          <p className="muted">
            Disconnect before changing registration credentials. Account identity is not inferred
            from token contents.
          </p>
        </section>
      )}
      {tab === 'Security' && (
        <>
          <section className="settings-section">
            <h2>Administrator password</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                void action(async () => {
                  await api('/auth/password', 'POST', Object.fromEntries(new FormData(form)));
                  form.reset();
                }, 'Password changed. Other sessions revoked.');
              }}
            >
              <div className="form-grid">
                <Field label="Current password">
                  <input
                    name="current"
                    type="password"
                    required
                    maxLength={128}
                    autoComplete="current-password"
                  />
                </Field>
                <Field label="New password" hint="At least 12 characters.">
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </Field>
              </div>
              <button className="button" disabled={busy}>
                Change password
              </button>
            </form>
          </section>
          <section className="settings-section">
            <h2>Active sessions</h2>
            {sessions.data?.items.map((v) => (
              <div className="session-row" key={v.id}>
                <ShieldCheck size={18} />
                <span>
                  {v.current ? 'This session' : 'Administrator session'}
                  <small>
                    Created {time(v.created)} · expires {time(v.expires)}
                  </small>
                </span>
                <Button
                  secondary
                  disabled={busy}
                  onClick={() =>
                    void action(() => api(`/auth/sessions/${v.id}`, 'DELETE'), 'Session revoked')
                  }
                >
                  Revoke
                </Button>
              </div>
            ))}
          </section>
          <div className="info-line">
            <ShieldCheck size={18} />
            <p>
              {settings.origin.startsWith('https:')
                ? 'HTTPS configured. Secure cookies are enabled. Trust only the explicit reverse-proxy addresses configured in TRUST_PROXY.'
                : 'This instance uses HTTP. LAN traffic, including passwords and sessions, is not encrypted. Use trusted HTTPS for remote access; keep the default loopback binding when possible.'}
            </p>
          </div>
        </>
      )}
      {tab === 'System' && (
        <section className="settings-section">
          <h2>Instance information</h2>
          <div className="detail-facts">
            {[
              ['Version', settings.version],
              ['Uptime', duration(settings.uptime)],
              ['Database integrity', settings.databaseHealth],
              ['Access URL', settings.origin],
            ].map(([k, v]) => (
              <div key={k}>
                <small>{k}</small>
                <span>{v}</span>
              </div>
            ))}
          </div>
          <a
            href="/api/diagnostics"
            download="supabeacon-diagnostics.json"
            className="button secondary"
          >
            <ArrowDownToLine size={15} />
            Download sanitized diagnostics
          </a>
          <h3>Container operations</h3>
          <p>Run from the repository directory on your server.</p>
          <pre>
            docker compose up -d --build{'\n'}docker compose logs -f --tail=100{'\n'}docker compose
            stop
          </pre>
          <h3>Backups & updates</h3>
          <p>
            Back up before an update. Backups include encrypted credentials and the encryption key;
            store them securely.
          </p>
          <pre>
            ./scripts/backup.sh{'\n'}./scripts/update.sh{'\n'}./scripts/restore.sh
            backups/YOUR-BACKUP.tar.gz
          </pre>
          <p className="muted">
            Data is retained when the container is stopped or removed. Uninstall with{' '}
            <code>docker compose down</code>. Delete persistent data only as an explicit separate
            action.
          </p>
        </section>
      )}
    </>
  );
}
