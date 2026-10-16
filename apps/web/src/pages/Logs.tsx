import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, ChevronRight, Search } from 'lucide-react';
import { Project } from '../../../../packages/shared/config';
import { api } from '../api';
import type { Log, Result } from '../lib/types';
import { time, localDateRange } from '../lib/date';
import { Badge, Spinner, Empty, Button, Pagination } from '../components/ui';
export function Logs() {
  const params = new URLSearchParams(location.hash.split('?')[1]);
  const [project, setProject] = useState(params.get('project') ?? ''),
    [level, setLevel] = useState(''),
    [search, setSearch] = useState(''),
    [date, setDate] = useState(''),
    [page, setPage] = useState(1),
    [auto, setAuto] = useState(true),
    [copyError, setCopyError] = useState('');
  const filter = new URLSearchParams({
    page: String(page),
    project,
    level,
    search,
    ...(date ? localDateRange(date) : {}),
  });
  const q = useQuery({
    queryKey: ['logs', filter.toString()],
    queryFn: () => api<Result<Log>>(`/logs?${filter}`),
    refetchInterval: auto ? 5000 : false,
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<{ items: Project[] }>('/projects'),
  });
  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Search size={15} />
          <input
            aria-label="Search log events"
            value={search}
            placeholder="Search events…"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          aria-label="Log severity"
          value={level}
          onChange={(e) => {
            setLevel(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All severities</option>
          {['debug', 'info', 'warning', 'error'].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <select
          aria-label="Log project"
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All projects</option>
          {projects.data?.items.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label="Log date (configured timezone)"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setPage(1);
          }}
        />
        <label className="checkbox">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Auto-refresh
        </label>
        <a className="button secondary" href={`/api/logs/export?${filter}`} download>
          <ArrowDownToLine size={15} />
          Export
        </a>
      </div>
      {copyError && (
        <p role="alert" className="error">
          {copyError}
        </p>
      )}
      {q.isError ? (
        <p className="error">Unable to load logs.</p>
      ) : q.isPending ? (
        <Spinner />
      ) : (
        <>
          <div className="log-list">
            {q.data?.items.map((log) => (
              <details className="log-event" key={log.id}>
                <summary>
                  <span className="log-time">{time(log.at)}</span>
                  <Badge
                    tone={
                      log.level === 'error'
                        ? 'danger'
                        : log.level === 'info'
                          ? 'emerald'
                          : 'neutral'
                    }
                  >
                    {log.level}
                  </Badge>
                  <span className="event-name">{log.event.replaceAll('_', ' ')}</span>
                  <code>{log.project_id ?? 'system'}</code>
                  <ChevronRight size={14} />
                </summary>
                <div className="log-details">
                  <pre>{JSON.stringify({ ...log, details: JSON.parse(log.details) }, null, 2)}</pre>
                  <Button
                    secondary
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(JSON.stringify(log, null, 2))
                        .catch(() =>
                          setCopyError(
                            'Clipboard unavailable. Use an HTTPS connection or select the event details.',
                          ),
                        )
                    }
                  >
                    Copy event details
                  </Button>
                </div>
              </details>
            ))}
            {q.data?.items.length === 0 && (
              <Empty title="No matching events">Try changing the log filters.</Empty>
            )}
          </div>
          <Pagination page={page} total={q.data?.total ?? 0} setPage={setPage} />
        </>
      )}
    </>
  );
}
