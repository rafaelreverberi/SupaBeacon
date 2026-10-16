import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, X } from 'lucide-react';
import { Execution } from '../../../../packages/shared/config';
import { api } from '../api';
import type { Result } from '../lib/types';
import { time } from '../lib/date';
import { Badge, Spinner, Empty, Button, Pagination, Modal } from '../components/ui';
export function History({ project }: { project?: string }) {
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['history', project, page],
    queryFn: () =>
      api<Result<Execution>>(`/executions?page=${page}${project ? `&project=${project}` : ''}`),
    refetchInterval: 3000,
  });
  const detail = useQuery({
    queryKey: ['execution', selected],
    queryFn: () =>
      api<
        Execution & {
          details: {
            id: number;
            at: number;
            status: number;
            duration: number;
            ok: number;
            error: string | null;
            kind: string;
            activity_name: string | null;
            row_count: number | null;
          }[];
        }
      >(`/executions/${selected}`),
    enabled: !!selected,
    refetchInterval: 3000,
  });
  return (
    <section>
      <div className="section-title">
        <h2>Execution history</h2>
        <Badge>Live · updates every 3s</Badge>
      </div>
      {q.isError ? (
        <p className="error">History could not be loaded.</p>
      ) : q.isPending ? (
        <Spinner />
      ) : q.data?.items.length ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Execution / project</th>
                  <th>Time</th>
                  <th>Strategy</th>
                  <th>Result</th>
                  <th>Requests</th>
                  <th>Database operation</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <button className="text-button mono" onClick={() => setSelected(e.id)}>
                        {e.id.slice(0, 8)}
                        <ChevronRight size={12} />
                      </button>
                      <small>
                        {e.project_id} · {e.source}
                      </small>
                    </td>
                    <td>{time(e.started)}</td>
                    <td>{e.strategy}</td>
                    <td>
                      <Badge
                        tone={
                          e.state === 'success'
                            ? 'emerald'
                            : e.state === 'failed'
                              ? 'danger'
                              : 'neutral'
                        }
                      >
                        {e.state}
                      </Badge>
                      {e.error && <small className="error">{e.error}</small>}
                    </td>
                    <td>
                      {e.successes} / {e.requests}
                      {e.activity_state !== 'disabled' && (
                        <small>
                          Additional: {e.activity_state} · {e.activity_reads} reads ·{' '}
                          {e.activity_requests} HTTP
                        </small>
                      )}
                    </td>
                    <td>{e.database_ok ? 'Succeeded' : 'Not confirmed'}</td>
                    <td>{e.duration === null ? '—' : `${e.duration} ms`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={q.data.total} setPage={setPage} />
        </>
      ) : (
        <Empty title="No executions yet">
          Scheduled and manual database operations will appear here.
        </Empty>
      )}
      {selected && (
        <Modal label="Execution details" onClose={() => setSelected(null)}>
          <Button secondary label="Close execution details" onClick={() => setSelected(null)}>
            <X size={16} />
            Close
          </Button>
          <h2>Execution details</h2>
          <code>{selected}</code>
          <p>
            Request outcomes and database success are separate from unverified pause prevention.
          </p>
          {detail.data?.details.map((r) => (
            <div className="request-detail" key={r.id}>
              <span>{time(r.at)}</span>
              <code>{r.kind.replaceAll('_', ' ')}</code>
              {r.activity_name && <span>{r.activity_name}</span>}
              <Badge tone={r.ok ? 'emerald' : 'danger'}>HTTP {r.status ?? '—'}</Badge>
              <span>{r.duration} ms</span>
              <code>
                {r.error ??
                  (r.kind === 'auth_sign_in'
                    ? 'Test sign-in succeeded'
                    : r.kind === 'auth_sign_out'
                      ? 'Local sign-out succeeded'
                      : 'Database operation succeeded')}
              </code>
              {r.row_count !== null && <span>{r.row_count} row(s); values discarded</span>}
            </div>
          ))}
        </Modal>
      )}
    </section>
  );
}
