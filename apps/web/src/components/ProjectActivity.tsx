import { useState, type FormEvent } from 'react';
import { ShieldCheck, Activity, ChevronDown, Plus, Trash2 } from 'lucide-react';
import type {
  Project,
  Settings,
  ProjectActivity as ActivityConfig,
  ActivitySchema,
  SavedActivity,
} from '../../../../packages/shared/config';
import type { Action } from '../lib/types';
import { api } from '../api';
import { Badge, Field, Button } from './ui';
function ActivityEditor({
  activity,
  project,
  settings,
  dataEnabled,
  busy,
  action,
}: {
  activity: SavedActivity;
  project: Project;
  settings: Settings;
  dataEnabled: boolean;
  busy: boolean;
  action: Action;
}) {
  const [enabled, setEnabled] = useState(activity.enabled);
  const [mode, setMode] = useState<ActivityConfig['mode']>(activity.mode);
  const [reads, setReads] = useState(activity.reads);
  const [table, setTable] = useState(activity.table ?? '');
  const [column, setColumn] = useState(activity.column ?? '');
  const [schema, setSchema] = useState<ActivitySchema | null>(null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [schemaError, setSchemaError] = useState('');
  const [manual, setManual] = useState(false);
  const columns = schema?.tables.find((t) => t.name === table)?.columns ?? [];
  async function loadSchema() {
    setLoadingSchema(true);
    setSchemaError('');
    try {
      setSchema(await api<ActivitySchema>(`/projects/${project.id}/activity-schema`, 'POST', {}));
    } catch (e) {
      setSchemaError(e instanceof Error ? e.message : 'Could not load tables');
    } finally {
      setLoadingSchema(false);
    }
  }
  const update = ({ activity: value }: { activity: unknown }) =>
    api(`/projects/${project.id}/activities/${activity.id}`, 'PATCH', value);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    const email = String(f.get('email') || ''),
      password = String(f.get('password') || '');
    await action(async () => {
      await update({
        activity: {
          name: String(f.get('name') || ''),
          enabled,
          mode,
          reads,
          table: table || null,
          column: column || null,
          ...(email || password
            ? { testAccount: { email, password, dedicated: f.get('dedicated') === 'on' } }
            : {}),
          ...(f.get('review') === 'on' ? { acknowledgeSessionReview: true } : {}),
        },
      });
      // Password inputs are deliberately uncontrolled and emptied after a confirmed save.
      for (const name of ['email', 'password']) {
        const input = form.elements.namedItem(name);
        if (input instanceof HTMLInputElement) input.value = '';
      }
    }, 'Optional project activity saved');
  }
  const disable = () =>
    void action(
      () =>
        update({
          activity: {
            enabled: false,
            mode: activity.mode,
            table: activity.table,
            column: activity.column,
            reads: activity.reads,
          },
        }),
      'Optional activity disabled',
    );
  return (
    <div className="activity-editor">
      {!dataEnabled && (
        <div className="info-line">
          <ShieldCheck size={16} />
          <p>
            To enable this feature, first opt into Data API access under{' '}
            <a className="text-link" href="#/settings">
              Settings → Supabase integration
            </a>
            , grant Secrets Read to your registered OAuth application and reconnect. Only existing
            publishable keys are used; the provider scope is broader than this implementation.
          </p>
        </div>
      )}
      {activity.signInError && (
        <p className="error" role="alert">
          Test sign-in was rejected ({activity.signInError}). Automatic test sign-ins are blocked
          until you save updated dedicated-account credentials. MFA/CAPTCHA/SSO requirements must be
          handled in your own client.
        </p>
      )}
      {activity.sessionReviewRequired && (
        <p className="error" role="alert">
          A test sign-in may have created a session whose logout was not confirmed. Further test
          sign-ins are blocked. Inspect/revoke that dedicated account’s session in Supabase, then
          explicitly acknowledge the review below.
        </p>
      )}
      <form onSubmit={(e) => void save(e)}>
        <label className="setting-switch">
          <span>
            Enable when saving
            <small>Save these details and this activity’s enabled state together.</small>
          </span>
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy || (!dataEnabled && !enabled)}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className="switch" />
        </label>
        <Field label="Activity name">
          <input name="name" required maxLength={80} defaultValue={activity.name} />
        </Field>
        <div className="form-grid">
          <Field label="Additional activity mode">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as ActivityConfig['mode'])}
            >
              <option value="public-read">Read one safe column · public/anon RLS</option>
              <option value="test-sign-in">Test-account sign-in → read → local sign-out</option>
            </select>
          </Field>
          <Field
            label="Additional reads per execution"
            hint="1–3 reads; each reads at most one row."
          >
            <input
              type="number"
              min={1}
              max={3}
              required
              value={reads}
              onChange={(e) => setReads(Number(e.target.value))}
            />
          </Field>
        </div>
        <div className="info-line">
          <Activity size={16} />
          <p>
            Choose a database table and one small, nonsensitive column to read. Load the names
            directly from this project’s public schema, then select both below. Loading reads schema
            metadata only, does not sign in and does not enable activity.
          </p>
        </div>
        <div className="inline-actions">
          <Button secondary disabled={busy || loadingSchema} onClick={() => void loadSchema()}>
            {loadingSchema
              ? 'Loading tables…'
              : schema
                ? 'Reload tables and columns'
                : 'Load tables and columns'}
          </Button>
          <label className="checkbox">
            <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
            Enter names manually
          </label>
        </div>
        {schemaError && (
          <p className="error" role="alert">
            Could not load tables: {schemaError}. You can retry or enter names manually.
          </p>
        )}
        {schema && schema.tables.length === 0 && (
          <p role="status">
            No supported public tables were found. Check Database → Tables in Supabase. Views, other
            schemas and names with special characters are not listed.
          </p>
        )}
        <div className="form-grid">
          <Field
            label="Activity table"
            hint="Table name from Supabase → Database → Tables (public schema)."
          >
            {manual ? (
              <input
                name="table"
                required={enabled}
                pattern="[a-zA-Z_][a-zA-Z0-9_]{0,62}"
                value={table}
                onChange={(e) => {
                  setTable(e.target.value);
                  setColumn('');
                }}
                placeholder="Existing table name"
              />
            ) : (
              <select
                name="table"
                required={enabled}
                value={table}
                onChange={(e) => {
                  setTable(e.target.value);
                  setColumn('');
                }}
              >
                <option value="">
                  {schema ? 'Choose a table' : 'Load tables above to choose'}
                </option>
                {table && !schema?.tables.some((t) => t.name === table) && (
                  <option value={table}>{table} · saved / entered manually</option>
                )}
                {schema?.tables.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label="Safe column to read"
            hint="Choose a small ID or number; avoid email, personal data and large text."
          >
            {manual ? (
              <input
                name="column"
                required={enabled}
                pattern="[a-zA-Z_][a-zA-Z0-9_]{0,62}"
                value={column}
                onChange={(e) => setColumn(e.target.value)}
                placeholder="Existing column name"
              />
            ) : (
              <select
                name="column"
                required={enabled}
                value={column}
                onChange={(e) => setColumn(e.target.value)}
              >
                <option value="">{table ? 'Choose a column' : 'Choose a table first'}</option>
                {column && !columns.some((c) => c.name === column) && (
                  <option value={column}>{column} · saved / entered manually</option>
                )}
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.type})
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <p>
          The list shows database structure, not a guarantee of Data API or RLS access.
          {mode === 'test-sign-in'
            ? ' Reads use the test account below after signing in.'
            : ' Reads use public/anon access.'}{' '}
          Save, then use “Run heartbeat / test connection” to check the actual access. Empty results
          can be caused by RLS; no policies or grants are changed automatically.
        </p>
        {mode === 'test-sign-in' && (
          <>
            <div className="info-line">
              <ShieldCheck size={16} />
              <p>
                Use an existing, dedicated test account with minimal RLS access, not a personal or
                admin account. This creates real sign-in events and can count toward Auth quotas. No
                users are created/deleted. MFA, CAPTCHA and SSO flows are not automated. Logout
                targets only the new session; access JWTs remain valid until expiry and are never
                saved.
              </p>
            </div>
            <p>
              {activity.credentialsConfigured
                ? 'Test credentials are stored encrypted. Leave both fields empty to keep them.'
                : 'No test credentials configured. Enter both fields to enable this mode.'}
            </p>
            <div className="form-grid">
              <Field label="Dedicated test-account email">
                <input
                  type="email"
                  name="email"
                  autoComplete="off"
                  required={enabled && !activity.credentialsConfigured}
                  maxLength={254}
                />
              </Field>
              <Field
                label="Test-account password"
                hint="Write-only; never returned by the API or included in logs."
              >
                <input
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  required={enabled && !activity.credentialsConfigured}
                  maxLength={256}
                />
              </Field>
            </div>
            <label className="checkbox">
              <input type="checkbox" name="dedicated" />I confirm any newly entered credentials
              belong to a dedicated test account I control.
            </label>
          </>
        )}
        {activity.sessionReviewRequired && (
          <label className="checkbox session-review">
            <input type="checkbox" name="review" />I have reviewed/revoked the uncertain test
            session in Supabase and authorize clearing this local block.
          </label>
        )}
        <div className="info-line">
          <Activity size={16} />
          <p>
            Additional daily budget: <b>{settings.frequency * reads} database reads</b>
            {mode === 'test-sign-in'
              ? ` + ${settings.frequency * 2} Auth requests (one sign-in and one sign-out per execution)`
              : ''}
            . Provider-status checks, key lookups and manual executions add HTTP traffic. Existing
            heartbeat requests are separate.
          </p>
        </div>
        <div className="inline-actions">
          <button className="button" disabled={busy || (enabled && !dataEnabled)}>
            Save optional activity
          </button>
          {activity.enabled && (
            <Button secondary disabled={busy} onClick={disable}>
              Disable optional activity
            </Button>
          )}
          {activity.credentialsConfigured && (
            <Button
              secondary
              disabled={busy}
              onClick={() =>
                void action(
                  () =>
                    update({
                      activity: {
                        enabled: false,
                        mode,
                        reads,
                        table: activity.table,
                        column: activity.column,
                        testAccount: null,
                      },
                    }),
                  'Test credentials removed; optional activity disabled',
                )
              }
            >
              Remove test credentials
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

type ActivityProps = {
  project: Project;
  settings: Settings;
  dataEnabled: boolean;
  busy: boolean;
  action: Action;
};
export function ProjectActivity(props: ActivityProps) {
  const { project, settings, busy, dataEnabled, action } = props;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const active = project.activities.filter((a) => a.enabled);
  const base = (a: SavedActivity) => ({
    enabled: a.enabled,
    mode: a.mode,
    table: a.table,
    column: a.column,
    reads: a.reads,
  });
  async function toggle(a: SavedActivity) {
    setPending((current) => ({ ...current, [a.id]: !a.enabled }));
    await action(
      () =>
        api(`/projects/${project.id}/activities/${a.id}`, 'PATCH', {
          ...base(a),
          enabled: !a.enabled,
        }),
      a.enabled ? 'Activity disabled' : 'Activity enabled',
    );
    setPending((current) => {
      const next = { ...current };
      delete next[a.id];
      return next;
    });
  }
  async function add() {
    await action(async () => {
      const a = await api<SavedActivity>(`/projects/${project.id}/activities`, 'POST', {
        name: `Activity ${project.activities.length + 1}`,
      });
      setExpanded(a.id);
    }, 'Activity added · configure it before enabling');
  }
  return (
    <section className="settings-section optional-activity">
      <div className="section-title">
        <h2>
          <Activity size={17} /> Additional activity
        </h2>
        <Badge tone={active.length ? 'emerald' : 'neutral'}>
          {active.length} of {project.activities.length} enabled
        </Badge>
      </div>
      <p>
        Build your own list of checks. Each enabled activity runs after a successful heartbeat,
        automatically and on manual runs. Open a row to edit its details.
      </p>
      <div className="activity-list">
        {project.activities.map((a) => (
          <div className="activity-item" key={a.id}>
            <div className="activity-row">
              <button
                type="button"
                className="activity-expand"
                aria-expanded={expanded === a.id}
                aria-controls={`activity-${a.id}`}
                onClick={() => setExpanded(expanded === a.id ? null : a.id)}
              >
                <ChevronDown size={17} className={expanded === a.id ? 'rotated' : ''} />
                <span>
                  <strong>{a.name}</strong>
                  <small>
                    {a.mode === 'public-read' ? 'Read data' : 'Sign in → read → sign out'} ·{' '}
                    {a.table && a.column ? `${a.table}.${a.column}` : 'Needs configuration'} ·{' '}
                    {a.reads} read{a.reads === 1 ? '' : 's'}
                  </small>
                </span>
              </button>
              {(a.sessionReviewRequired || a.signInError) && (
                <Badge tone="danger">Needs attention</Badge>
              )}
              <label className="activity-toggle setting-switch">
                <span>{(pending[a.id] ?? a.enabled) ? 'On' : 'Off'}</span>
                <input
                  type="checkbox"
                  aria-label={`Enable ${a.name}`}
                  checked={pending[a.id] ?? a.enabled}
                  disabled={busy || (!a.enabled && !dataEnabled)}
                  onChange={() => void toggle(a)}
                />
                <span className="switch" />
              </label>
            </div>
            {expanded === a.id && (
              <div id={`activity-${a.id}`} className="activity-body">
                <ActivityEditor key={JSON.stringify(a)} {...props} activity={a} />
                {removing === a.id ? (
                  <div className="activity-remove-confirm">
                    <p>
                      Remove this activity and its saved credentials? The remote test account and
                      execution history stay intact.
                    </p>
                    <div className="inline-actions">
                      <Button secondary disabled={busy} onClick={() => setRemoving(null)}>
                        Keep activity
                      </Button>
                      <Button
                        secondary
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await api(`/projects/${project.id}/activities/${a.id}`, 'DELETE');
                            setRemoving(null);
                            setExpanded(null);
                          }, 'Activity removed')
                        }
                      >
                        Confirm removal
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    secondary
                    disabled={busy || a.sessionReviewRequired}
                    onClick={() => setRemoving(a.id)}
                  >
                    <Trash2 size={14} /> Remove activity
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {!project.activities.length && (
        <div className="activity-empty">
          No extra checks yet. Add a data read or a test-account sign-in flow. New activities start
          switched off.
        </div>
      )}
      <div className="activity-footer">
        <Button
          secondary
          disabled={busy || project.activities.length >= 8}
          onClick={() => void add()}
        >
          <Plus size={16} /> Add activity
        </Button>
        <small>
          {project.activities.length}/8 activities ·{' '}
          {active.reduce((n, a) => n + a.reads, 0) * settings.frequency} additional reads/day ·{' '}
          {active.filter((a) => a.mode === 'test-sign-in').length * settings.frequency * 2} Auth
          requests/day
        </small>
      </div>
      <p className="activity-note">
        Values are discarded after validation. These checks do not guarantee prevention of project
        pausing.
      </p>
    </section>
  );
}
