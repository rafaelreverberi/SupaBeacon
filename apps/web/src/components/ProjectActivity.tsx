import { useState, type FormEvent } from 'react';
import { ShieldCheck, Activity } from 'lucide-react';
import type {
  Project,
  Settings,
  ProjectActivity as ActivityConfig,
} from '../../../../packages/shared/config';
import type { Action } from '../lib/types';
import { api } from '../api';
import { Badge, Field, Button } from './ui';
export function ProjectActivity({
  project,
  settings,
  dataEnabled,
  busy,
  action,
}: {
  project: Project;
  settings: Settings;
  dataEnabled: boolean;
  busy: boolean;
  action: Action;
}) {
  const [enabled, setEnabled] = useState(project.activity.enabled);
  const [mode, setMode] = useState<ActivityConfig['mode']>(project.activity.mode);
  const [reads, setReads] = useState(project.activity.reads);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    const email = String(f.get('email') || ''),
      password = String(f.get('password') || '');
    await action(async () => {
      await api(`/projects/${project.id}`, 'PATCH', {
        activity: {
          enabled,
          mode,
          reads,
          table: String(f.get('table') || '') || null,
          column: String(f.get('column') || '') || null,
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
        api(`/projects/${project.id}`, 'PATCH', {
          activity: {
            enabled: false,
            mode: project.activity.mode,
            table: project.activity.table,
            column: project.activity.column,
            reads: project.activity.reads,
          },
        }),
      'Optional activity disabled',
    );
  return (
    <section className="settings-section optional-activity">
      <div className="section-title">
        <h2>
          <Activity size={17} />
          Optional project activity
        </h2>
        <Badge tone={project.activity.enabled ? 'emerald' : 'neutral'}>
          {project.activity.enabled ? 'Enabled for this project' : 'Off by default'}
        </Badge>
      </div>
      <p>
        Add a real, bounded application-facing read after each successful heartbeat. Values are
        discarded after validation. These checks do not disguise traffic or prove prevention of
        project pausing.
      </p>
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
      {project.activity.signInError && (
        <p className="error" role="alert">
          Test sign-in was rejected ({project.activity.signInError}). Automatic test sign-ins are
          blocked until you save updated dedicated-account credentials. MFA/CAPTCHA/SSO requirements
          must be handled in your own client.
        </p>
      )}
      {project.activity.sessionReviewRequired && (
        <p className="error" role="alert">
          A test sign-in may have created a session whose logout was not confirmed. Further test
          sign-ins are blocked. Inspect/revoke that dedicated account’s session in Supabase, then
          explicitly acknowledge the review below.
        </p>
      )}
      <form onSubmit={(e) => void save(e)}>
        <label className="setting-switch">
          <span>
            Enable additional activity for this project
            <small>
              Independent of other projects. Uses this project’s existing heartbeat schedule.
            </small>
          </span>
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy || (!dataEnabled && !enabled)}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className="switch" />
        </label>
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
          <Field label="Activity table" hint="Existing safe table in the default exposed schema.">
            <input
              name="table"
              required={enabled}
              pattern="[a-zA-Z_][a-zA-Z0-9_]{0,62}"
              defaultValue={project.activity.table ?? ''}
              placeholder="healthcheck"
            />
          </Field>
          <Field
            label="Safe column to read"
            hint="Choose a small, nonsensitive column such as id. No wildcard selection."
          >
            <input
              name="column"
              required={enabled}
              pattern="[a-zA-Z_][a-zA-Z0-9_]{0,62}"
              defaultValue={project.activity.column ?? ''}
              placeholder="id"
            />
          </Field>
        </div>
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
              {project.activity.credentialsConfigured
                ? 'Test credentials are stored encrypted. Leave both fields empty to keep them.'
                : 'No test credentials configured. Enter both fields to enable this mode.'}
            </p>
            <div className="form-grid">
              <Field label="Dedicated test-account email">
                <input
                  type="email"
                  name="email"
                  autoComplete="off"
                  required={enabled && !project.activity.credentialsConfigured}
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
                  required={enabled && !project.activity.credentialsConfigured}
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
        {project.activity.signInError && (
          <p className="error" role="alert">
            Test sign-in was rejected ({project.activity.signInError}). Automatic test sign-ins are
            blocked until you save updated dedicated-account credentials. MFA/CAPTCHA/SSO
            requirements must be handled in your own client.
          </p>
        )}
        {project.activity.sessionReviewRequired && (
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
          {project.activity.enabled && (
            <Button secondary disabled={busy} onClick={disable}>
              Disable optional activity
            </Button>
          )}
          {project.activity.credentialsConfigured && (
            <Button
              secondary
              disabled={busy}
              onClick={() =>
                void action(
                  () =>
                    api(`/projects/${project.id}`, 'PATCH', {
                      activity: {
                        enabled: false,
                        mode,
                        reads,
                        table: project.activity.table,
                        column: project.activity.column,
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
    </section>
  );
}
