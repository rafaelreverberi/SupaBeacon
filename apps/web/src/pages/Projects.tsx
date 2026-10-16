import { ProjectActivity } from '../components/ProjectActivity';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronLeft, Database, ExternalLink, Play, Search } from 'lucide-react';
import { Project, Execution, Settings } from '../../../../packages/shared/config';
import { api } from '../api';
import type { Action } from '../lib/types';
import { time } from '../lib/date';
import { Badge, Spinner, Empty, Button, Field } from '../components/ui';
import { History } from './History';
export function ProjectTable({
  projects,
  action,
  busy,
}: {
  projects: Project[];
  action: Action;
  busy: boolean;
}) {
  if (!projects.length)
    return (
      <Empty title="No projects discovered yet">
        Connect Supabase and sync your authorized projects to get started.
      </Empty>
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Provider status</th>
            <th>Monitoring</th>
            <th>Last database success</th>
            <th>Next heartbeat</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <td>
                <a className="project-name" href={`#/projects/${p.id}`}>
                  <span className="project-icon">
                    <Database size={16} />
                  </span>
                  <span>
                    {p.name}
                    <small>
                      {p.organization} · {p.region}
                    </small>
                  </span>
                </a>
              </td>
              <td>
                <Badge tone={p.status === 'ACTIVE_HEALTHY' ? 'emerald' : 'neutral'}>
                  {!p.present
                    ? 'Access unavailable'
                    : p.status === 'ACTIVE_HEALTHY'
                      ? 'Active'
                      : p.status === 'INACTIVE'
                        ? 'Paused'
                        : p.status.toLowerCase().replaceAll('_', ' ')}
                </Badge>
              </td>
              <td>
                <button
                  className="monitor-toggle"
                  aria-label={`${p.enabled ? 'Disable' : 'Enable'} monitoring for ${p.name}`}
                  aria-pressed={!!p.enabled}
                  disabled={busy}
                  onClick={() =>
                    void action(() => api(`/projects/${p.id}`, 'PATCH', { enabled: !p.enabled }))
                  }
                >
                  <span className={p.enabled ? 'mini-toggle on' : 'mini-toggle'} />
                  {p.enabled ? 'Enabled' : 'Disabled'}
                </button>
                {p.failures > 0 && <small className="error">{p.failures} recent failures</small>}
              </td>
              <td>{time(p.last_success)}</td>
              <td>{time(p.next_run)}</td>
              <td>
                <button
                  className="icon-button"
                  disabled={busy || !p.present || p.status !== 'ACTIVE_HEALTHY'}
                  aria-label={`Run heartbeat for ${p.name}`}
                  title="Run now"
                  onClick={() => {
                    location.hash = `/projects/${p.id}`;
                    void action(
                      () => api(`/projects/${p.id}/run`, 'POST'),
                      'Heartbeat started. See execution history for the result.',
                    );
                  }}
                >
                  <Play size={15} />
                </button>
                <a
                  className="icon-button"
                  href={`https://supabase.com/dashboard/project/${p.id}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${p.name} in Supabase`}
                >
                  <ExternalLink size={14} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProjectsPage({ action, busy }: { action: Action; busy: boolean }) {
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [sort, setSort] = useState('name');
  const q = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<{ items: Project[] }>('/projects'),
    refetchInterval: 5000,
  });
  const projects = (q.data?.items ?? [])
    .filter((p) =>
      `${p.name} ${p.id} ${p.organization}`.toLowerCase().includes(search.toLowerCase()),
    )
    .filter(
      (p) =>
        filter === 'all' ||
        (filter === 'enabled' && p.enabled) ||
        (filter === 'disabled' && !p.enabled) ||
        (filter === 'active' && p.status === 'ACTIVE_HEALTHY') ||
        (filter === 'paused' && p.status === 'INACTIVE') ||
        (filter === 'error' && p.last_error),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : (b.last_success ?? 0) - (a.last_success ?? 0),
    );
  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Search size={16} />
          <input
            aria-label="Search projects"
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Filter projects"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          {['all', 'enabled', 'disabled', 'active', 'paused', 'error'].map((v) => (
            <option key={v} value={v}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </option>
          ))}
        </select>
        <select aria-label="Sort projects" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="name">Name A–Z</option>
          <option value="last">Last success</option>
        </select>
      </div>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <p role="alert" className="error">
          Unable to load projects.
        </p>
      ) : (
        <ProjectTable projects={projects} action={action} busy={busy} />
      )}
    </>
  );
}

export function ProjectPage({
  id,
  action,
  busy,
  dataEnabled,
}: {
  id: string;
  action: Action;
  busy: boolean;
  dataEnabled: boolean;
}) {
  const q = useQuery({
    queryKey: ['project', id],
    queryFn: () => api<Project & { effective: Settings }>(`/projects/${id}`),
    refetchInterval: 3000,
  });
  const p = q.data;
  const [execution, setExecution] = useState<string | null>(null);
  const run = useQuery({
    queryKey: ['run', execution],
    queryFn: () => api<Execution & { details: unknown[] }>(`/executions/${execution}`),
    enabled: !!execution,
    refetchInterval: (query) => (query.state.data?.state === 'running' ? 1000 : false),
  });
  if (q.isError) return <p className="error">Project unavailable.</p>;
  if (!p) return <Spinner />;
  return (
    <>
      <a className="text-link" href="#/projects">
        <ChevronLeft size={15} />
        All projects
      </a>
      <div className="detail-heading">
        <span className="project-icon large">
          <Database size={26} />
        </span>
        <div>
          <h2>{p.name}</h2>
          <code>{p.id}</code>
        </div>
        <Badge tone={p.status === 'ACTIVE_HEALTHY' ? 'emerald' : 'neutral'}>{p.status}</Badge>
        <a
          className="text-link push"
          href={`https://supabase.com/dashboard/project/${id}`}
          target="_blank"
          rel="noreferrer"
        >
          Supabase Dashboard
          <ExternalLink size={14} />
        </a>
      </div>
      <div className="detail-facts">
        {[
          ['Organization', p.organization],
          ['Region', p.region],
          ['First discovered', time(p.first_seen)],
          ['Last discovered', time(p.last_seen)],
          ['Last run', time(p.last_run)],
          ['Last database success', time(p.last_success)],
          ['Next scheduled', time(p.next_run)],
        ].map(([k, v]) => (
          <div key={k}>
            <small>{k}</small>
            <span>{v}</span>
          </div>
        ))}
      </div>
      <div className="inline-actions">
        <Button
          disabled={
            busy || run.data?.state === 'running' || p.status !== 'ACTIVE_HEALTHY' || !p.present
          }
          onClick={() =>
            void action(async () => {
              const r = await api<{ id: string }>(`/projects/${id}/run`, 'POST');
              setExecution(r.id);
            })
          }
        >
          {run.data?.state === 'running' ? <Spinner /> : <Play size={15} />}Run heartbeat / test
          connection
        </Button>
        <Button
          secondary
          disabled={busy}
          onClick={() =>
            void action(() => api(`/projects/${id}`, 'PATCH', { enabled: !p.enabled }))
          }
        >
          {p.enabled ? 'Disable monitoring' : 'Enable monitoring'}
        </Button>
        <a className="text-link" href={`#/logs?project=${id}`}>
          Inspect logs
          <ArrowRight size={13} />
        </a>
      </div>
      {run.data && (
        <div className={`run-result ${run.data.state === 'failed' ? 'error' : ''}`} role="status">
          <Badge tone={run.data.state === 'success' ? 'emerald' : 'neutral'}>
            {run.data.state}
          </Badge>
          <span>
            {run.data.successes} successful requests ·{' '}
            {run.data.database_ok
              ? 'Database operation succeeded'
              : 'Database operation not confirmed'}{' '}
            · {run.data.duration ?? '…'} ms
          </span>
          {run.data.activity_state !== 'disabled' && (
            <span>
              Additional activity: {run.data.activity_state} · {run.data.activity_reads} reads ·{' '}
              {run.data.activity_requests} HTTP requests
            </span>
          )}
          {run.data.error && <code>{run.data.error}</code>}
        </div>
      )}
      {p.last_error && <p className="error">Last error: {p.last_error}</p>}
      <section className="settings-section">
        <h2>Project configuration</h2>
        <p>
          {p.overrides
            ? 'Using project-specific overrides.'
            : 'Inheriting global monitoring defaults.'}
        </p>
        <form
          key={JSON.stringify([p.overrides, p.strategy, p.safe_table])}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void action(
              () =>
                api(`/projects/${id}`, 'PATCH', {
                  overrides: {
                    frequency: Number(f.get('frequency')),
                    requests: Number(f.get('requests')),
                  },
                  strategy: f.get('strategy'),
                  safeTable: String(f.get('safeTable') || '') || null,
                }),
              'Project configuration saved',
            );
          }}
        >
          <div className="form-grid">
            <Field label="Heartbeats per day">
              <input
                name="frequency"
                type="number"
                min={1}
                max={6}
                defaultValue={p.effective.frequency}
              />
            </Field>
            <Field label="Requests per heartbeat">
              <input
                name="requests"
                type="number"
                min={1}
                max={3}
                defaultValue={p.effective.requests}
              />
            </Field>
            <Field label="Heartbeat strategy">
              <select name="strategy" defaultValue={p.strategy}>
                <option value="management">Management API · read-only SQL (Beta)</option>
                <option value="data" disabled={!dataEnabled}>
                  Data API · opt-in publishable key
                </option>
              </select>
            </Field>
            <Field
              label="Existing safe Data API table"
              hint="Only for Data API. No rows are returned; RLS is respected."
            >
              <input
                name="safeTable"
                pattern="[a-zA-Z_][a-zA-Z0-9_]{0,62}"
                defaultValue={p.safe_table ?? ''}
                placeholder="healthcheck"
              />
            </Field>
          </div>
          <div className="inline-actions">
            <button className="button" disabled={busy}>
              Save project configuration
            </button>
            <Button
              secondary
              disabled={busy}
              onClick={() =>
                void action(
                  () =>
                    api(`/projects/${id}`, 'PATCH', {
                      overrides: null,
                      strategy: 'management',
                      safeTable: null,
                    }),
                  'Global defaults restored',
                )
              }
            >
              Restore inherited defaults
            </Button>
          </div>
        </form>
      </section>
      <ProjectActivity
        key={p.id}
        project={p}
        settings={p.effective}
        dataEnabled={dataEnabled}
        busy={busy}
        action={action}
      />
      <History project={id} />
    </>
  );
}
