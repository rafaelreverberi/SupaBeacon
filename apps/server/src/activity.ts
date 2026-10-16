import { z } from 'zod';
import { boundedJson } from './response.js';
import type { Project } from '../../../packages/shared/config.js';
import { Supabase, ServiceError } from './supabase.js';

/** A bounded application-read check, with optional dedicated-account authentication. */
export class ActivityRunner {
  constructor(private api: Supabase) {}
  private record(
    id: string,
    project: string,
    kind: string,
    at: number,
    status: number | null,
    ok: boolean,
    error: string | null,
    rows: number | null = null,
  ) {
    const s = this.api.store;
    s.db.transaction(() => {
      s.db
        .prepare(
          'INSERT INTO execution_requests(execution_id,at,status,duration,ok,error,kind,row_count) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(id, at, status, Date.now() - at, Number(ok), error, kind, rows);
      s.db
        .prepare(
          'UPDATE executions SET activity_successes=activity_successes+?,activity_reads=activity_reads+?,database_ok=CASE WHEN ? THEN 1 ELSE database_ok END WHERE id=?',
        )
        .run(
          Number(ok),
          Number(ok && kind === 'activity_read'),
          Number(ok && kind === 'activity_read'),
          id,
        );
      if (ok && kind === 'activity_read')
        s.db.prepare('UPDATE projects SET last_success=? WHERE id=?').run(Date.now(), project);
    })();
    s.log(ok ? 'info' : 'warning', `${kind}_${ok ? 'succeeded' : 'failed'}`, project, {
      execution: id,
      ...(error ? { code: error } : {}),
      ...(rows !== null ? { rows } : {}),
    });
  }
  private async call(
    id: string,
    p: Project,
    kind: string,
    url: string,
    init: RequestInit,
    read: (r: Response) => Promise<number | null>,
    cleanup = false,
  ) {
    const at = Date.now();
    let status: number | null = null;
    let response: Response | undefined;
    this.api.store.db
      .prepare('UPDATE executions SET activity_requests=activity_requests+1 WHERE id=?')
      .run(id);
    try {
      const r = await this.api.request(url, init, cleanup);
      response = r;
      status = r.status;
      if (!r.ok) {
        await r.body?.cancel();
        throw new ServiceError(
          kind === 'auth_sign_in'
            ? 'TEST_SIGN_IN_REJECTED'
            : kind === 'auth_sign_out'
              ? 'TEST_SIGN_OUT_FAILED'
              : 'ACTIVITY_READ_FAILED',
          r.status,
          r.headers.get('retry-after'),
        );
      }
      const rows = await read(r);
      this.record(id, p.id, kind, at, status, true, null, rows);
    } catch (e) {
      await response?.body?.cancel().catch(() => {});
      const fault =
        e instanceof ServiceError ? e : new ServiceError('ACTIVITY_RESPONSE_INVALID', 502);
      this.record(id, p.id, kind, at, status ?? fault.status, false, fault.code);
      throw fault;
    }
  }
  async run(id: string, p: Project, shouldContinue: () => boolean) {
    const a = p.activity,
      s = this.api.store;
    if (!a.enabled) return;
    s.db.prepare("UPDATE executions SET activity_state='running' WHERE id=?").run(id);
    let token: string | undefined,
      publicKey: string | undefined,
      stage = 'preflight';
    let error: ServiceError | undefined;
    try {
      if (!a.table || !a.column) throw new ServiceError('ACTIVITY_TABLE_AND_COLUMN_REQUIRED');
      if (!this.api.config()?.dataEnabled) throw new ServiceError('DATA_STRATEGY_NOT_AUTHORIZED');
      if (a.mode === 'test-sign-in' && a.signInError)
        throw new ServiceError('TEST_ACCOUNT_UPDATE_REQUIRED', 409);
      if (a.mode === 'test-sign-in' && a.sessionReviewRequired)
        throw new ServiceError('TEST_SESSION_REVIEW_REQUIRED', 409);
      if (!shouldContinue()) throw new ServiceError('EXECUTION_STOPPED', 409);
      const actual = (await (await this.api.api(`/projects/${p.id}`)).json()) as {
        status?: string;
      };
      if (typeof actual.status === 'string')
        s.db.prepare('UPDATE projects SET status=? WHERE id=?').run(actual.status, p.id);
      if (actual.status !== 'ACTIVE_HEALTHY') throw new ServiceError('PROJECT_NOT_ACTIVE', 409);
      publicKey = await this.api.publicKey(p.id);
      if (a.mode === 'test-sign-in') {
        if (!shouldContinue()) throw new ServiceError('EXECUTION_STOPPED', 409);
        const encrypted = s.activitySecret(p.id);
        if (!encrypted) throw new ServiceError('TEST_ACCOUNT_REQUIRED');
        const account = this.api.box.open<{ email: string; password: string }>(encrypted);
        // Persist uncertainty BEFORE the request. A crash or lost response must not accumulate logins.
        s.db.prepare('UPDATE project_activity SET session_review=1 WHERE project_id=?').run(p.id);
        stage = 'sign-in';
        await this.call(
          id,
          p,
          'auth_sign_in',
          `https://${p.id}.supabase.co/auth/v1/token?grant_type=password`,
          {
            method: 'POST',
            headers: { apikey: publicKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: account.email, password: account.password }),
          },
          async (r) => {
            const auth = z
              .object({
                access_token: z.string().min(1).max(16384),
                user: z
                  .object({ factors: z.array(z.object({ status: z.string() })).optional() })
                  .optional(),
              })
              .parse(await boundedJson(r, 64 * 1024));
            token = auth.access_token;
            if (auth.user?.factors?.some((f) => f.status === 'verified'))
              throw new ServiceError('TEST_ACCOUNT_MFA_UNSUPPORTED', 409);
            return null;
          },
        );
      }
      stage = 'read';
      for (let n = 0; n < a.reads; n++) {
        if (!shouldContinue()) throw new ServiceError('EXECUTION_STOPPED', 409);
        await this.call(
          id,
          p,
          'activity_read',
          `https://${p.id}.supabase.co/rest/v1/${encodeURIComponent(a.table)}?select=${encodeURIComponent(a.column)}&limit=1`,
          {
            method: 'GET',
            headers: {
              apikey: publicKey,
              'Accept-Profile': 'public',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          },
          async (r) => {
            if (!r.headers.has('content-range'))
              throw new ServiceError('ACTIVITY_RESPONSE_INVALID', 502);
            const rows: unknown = await boundedJson(r, 64 * 1024);
            if (
              !Array.isArray(rows) ||
              rows.length > 1 ||
              rows.some(
                (row) =>
                  !row ||
                  typeof row !== 'object' ||
                  Array.isArray(row) ||
                  Object.keys(row).length !== 1 ||
                  Object.keys(row).some((k) => k !== a.column),
              )
            )
              throw new ServiceError('ACTIVITY_RESPONSE_INVALID', 502);
            // Persist count and timing only. Selected values are never logged or stored.
            return rows.length;
          },
        );
      }
    } catch (e) {
      error = e instanceof ServiceError ? e : new ServiceError('ACTIVITY_RESPONSE_INVALID', 502);
      // A definitive credential/rate-limit rejection did not create a session; network/5xx is uncertain.
      if (stage === 'sign-in' && !token && [400, 401, 403, 422, 429].includes(error.status))
        s.db.prepare('UPDATE project_activity SET session_review=0 WHERE project_id=?').run(p.id);
      if (
        (stage === 'sign-in' && [400, 401, 403, 422].includes(error.status)) ||
        error.code === 'TEST_ACCOUNT_MFA_UNSUPPORTED'
      )
        s.db
          .prepare('UPDATE project_activity SET sign_in_error=? WHERE project_id=?')
          .run(error.code, p.id);
    } finally {
      if (token && publicKey) {
        try {
          // Only this newly created session; never sign the test account out of other devices.
          // Cleanup still runs after pause/cancellation or an upstream cooldown from the read.
          await this.call(
            id,
            p,
            'auth_sign_out',
            `https://${p.id}.supabase.co/auth/v1/logout?scope=local`,
            { method: 'POST', headers: { apikey: publicKey, Authorization: `Bearer ${token}` } },
            async (r) => {
              await r.body?.cancel();
              return null;
            },
            true,
          );
          s.db.prepare('UPDATE project_activity SET session_review=0 WHERE project_id=?').run(p.id);
        } catch {
          s.db.prepare('UPDATE project_activity SET session_review=1 WHERE project_id=?').run(p.id);
          error = new ServiceError('TEST_SESSION_REVIEW_REQUIRED', 409);
        }
      }
      token = undefined;
      publicKey = undefined;
      s.db
        .prepare('UPDATE executions SET activity_state=?,activity_error=? WHERE id=?')
        .run(error ? 'failed' : 'success', error?.code ?? null, id);
      if (error)
        s.log('warning', 'optional_activity_failed', p.id, { execution: id, code: error.code });
    }
    if (error) throw error;
  }
}
