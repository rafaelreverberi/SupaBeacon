import { useState, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  Check,
  Clock3,
  Database,
  ExternalLink,
  Pause,
  Play,
  Plus,
  Radio,
  ShieldCheck,
} from 'lucide-react';
const ActivityChart = lazy(() => import('../components/ActivityChart'));
import { api } from '../api';
import type { Overview, Action } from '../lib/types';
import { time, duration } from '../lib/date';
import { Badge, Spinner, Button } from '../components/ui';
import { ProjectTable } from './Projects';
export function IntegrationIntro({
  configured,
  busy,
  action,
}: {
  configured: boolean;
  busy: boolean;
  action: Action;
}) {
  return (
    <section className="onboard">
      <div className="onboard-visual">
        <Radio size={48} strokeWidth={1.2} />
        <span className="orbit one" />
        <span className="orbit two" />
      </div>
      <div className="onboard-copy">
        <Badge tone="emerald">Ready when you are</Badge>
        <h2>Give your projects a home.</h2>
        <p>
          Connect your Supabase account to discover authorized projects and schedule minimal,
          read-only database activity.
        </p>
        <div className="inline-actions">
          <Button
            disabled={busy}
            onClick={() =>
              configured
                ? void action(async () => {
                    const r = await api<{ url: string }>('/oauth/connect', 'POST');
                    location.assign(r.url);
                  })
                : location.assign('#/settings')
            }
          >
            <Plus size={16} />
            {configured ? 'Connect Supabase' : 'Set up Supabase integration'}
          </Button>
          <a
            href="https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration"
            target="_blank"
            rel="noreferrer"
          >
            How it works
            <ExternalLink size={13} />
          </a>
        </div>
        <small>
          <ShieldCheck size={13} />
          No database passwords. No service-role keys.
        </small>
      </div>
    </section>
  );
}

export function OverviewPage({
  connected,
  configured,
  busy,
  action,
}: {
  connected: boolean;
  configured: boolean;
  busy: boolean;
  action: Action;
}) {
  const [days, setDays] = useState(7);
  const q = useQuery({
    queryKey: ['dashboard', days],
    queryFn: () => api<Overview>(`/dashboard?days=${days}`),
    refetchInterval: 5000,
  });
  const d = q.data;
  if (q.isError) return <p className="error">Unable to load the overview.</p>;
  if (!d) return <Spinner />;
  return (
    <>
      {!connected && <IntegrationIntro configured={configured} busy={busy} action={action} />}
      <div className="section-title">
        <h2>Workspace health</h2>
        <Badge tone={d.scheduler ? 'emerald' : 'neutral'}>
          {d.scheduler ? 'Scheduler running' : 'Scheduler paused'}
        </Badge>
        <button
          className="text-button push"
          disabled={busy}
          onClick={() =>
            void action(() => api(`/scheduler/${d.scheduler ? 'pause' : 'resume'}`, 'POST'))
          }
        >
          {d.scheduler ? <Pause size={13} /> : <Play size={13} />}{' '}
          {d.scheduler ? 'Pause monitoring' : 'Resume monitoring'}
        </button>
      </div>
      <div className="metrics">
        {[
          [
            'Discovered projects',
            d.total,
            `${d.enabled} monitored · ${d.disabled} disabled`,
            Database,
          ],
          ['Successful today', d.successToday, `${d.requestsToday} database requests`, Check],
          ['Failed today', d.failedToday, `${d.paused} projects reported paused`, Activity],
          ['Next heartbeat', time(d.nextRun), `Last success: ${time(d.lastSuccess)}`, Clock3],
        ].map(([label, value, detail, Icon]) => {
          const I = Icon as typeof Activity;
          return (
            <div className="metric" key={String(label)}>
              <span>
                {String(label)}
                <I size={15} />
              </span>
              <strong className={label === 'Next heartbeat' ? 'metric-date' : ''}>
                {String(value)}
              </strong>
              <small>{String(detail)}</small>
            </div>
          );
        })}
      </div>
      <section className="chart-section">
        <div className="section-title">
          <div>
            <h2>Heartbeat activity</h2>
            <p>Completed executions across your workspace</p>
          </div>
          <div className="chart-legend push">
            <span>
              <i className="success-key" />
              Successful
            </span>
            <span>
              <i className="failed-key" />
              Failed
            </span>
          </div>
          <select
            aria-label="Activity time range"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>
        <div className="chart" role="img" aria-label={`Heartbeat activity for ${days} days`}>
          <Suspense fallback={<Spinner />}>
            <ActivityChart data={d.chart} />
          </Suspense>
          {!d.successToday && !d.failedToday && d.chart.every((x) => !x.success && !x.failed) && (
            <span className="chart-empty">Your heartbeat history will appear here.</span>
          )}
        </div>
      </section>
      <div className="section-title">
        <h2>Projects</h2>
        <span className="count">{d.total}</span>
        <a className="text-link push" href="#/projects">
          View all projects
          <ArrowRight size={14} />
        </a>
      </div>
      <ProjectTable projects={d.projects.slice(0, 6)} action={action} busy={busy} />
      <div className="info-line">
        <ShieldCheck size={16} />
        <p>
          Successful database activity is recorded independently of Supabase’s pausing policy. No
          strategy guarantees a project will remain active.
        </p>
      </div>
      <div className="system-strip">
        <span>
          <i className="status-dot on" />
          All local systems operational
        </span>
        <span>Uptime {duration(d.uptime)}</span>
        <span>Last project sync {time(d.connection.lastSync)}</span>
      </div>
      {d.connection.syncError && (
        <p className="error">Project discovery: {d.connection.syncError}</p>
      )}
    </>
  );
}
