import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { eq } from 'drizzle-orm';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  defaults,
  defaultActivity,
  type ProjectActivity,
  type SavedActivity,
  settingsSchema,
  type Settings,
  type Project,
} from '../../../packages/shared/config.js';
const kv = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
export class Store {
  db: Database.Database;
  orm: ReturnType<typeof drizzle>;
  constructor(path: string, initial: Partial<Settings> = {}) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    chmodSync(path, 0o600);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('synchronous = FULL');
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied INTEGER NOT NULL);`,
    );
    this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM migrations WHERE version=1').get()) return;
      this.db.exec(`
      CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE admin(id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, password TEXT NOT NULL);
      CREATE TABLE sessions(id TEXT PRIMARY KEY, csrf TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE oauth_flow(state TEXT PRIMARY KEY, session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, verifier TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,organization TEXT NOT NULL,region TEXT NOT NULL,status TEXT NOT NULL,present INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL,strategy TEXT NOT NULL DEFAULT 'management',safe_table TEXT,overrides TEXT, first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,last_run INTEGER,last_success INTEGER,next_run INTEGER,last_error TEXT);
      CREATE TABLE jobs(id INTEGER PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),due INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'pending',UNIQUE(project_id,due));
      CREATE INDEX jobs_due ON jobs(state,due);
      CREATE TABLE executions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),source TEXT NOT NULL,strategy TEXT NOT NULL,state TEXT NOT NULL,started INTEGER NOT NULL,finished INTEGER,requests INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,database_ok INTEGER NOT NULL DEFAULT 0,error TEXT,duration INTEGER);
      CREATE UNIQUE INDEX execution_overlap ON executions(project_id) WHERE state='running';
      CREATE INDEX execution_time ON executions(started);
      CREATE TABLE execution_requests(id INTEGER PRIMARY KEY,execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,at INTEGER NOT NULL,status INTEGER,duration INTEGER NOT NULL,ok INTEGER NOT NULL,error TEXT);
      CREATE TABLE logs(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,level TEXT NOT NULL,event TEXT NOT NULL,project_id TEXT,details TEXT NOT NULL);
      CREATE INDEX logs_at ON logs(at);
      `);
      this.db.prepare('INSERT INTO migrations VALUES(1,?)').run(Date.now());
    })();
    this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM migrations WHERE version=2').get()) return;
      this.db.exec(`
        CREATE TABLE project_activity(project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),mode TEXT NOT NULL DEFAULT 'public-read' CHECK(mode IN ('public-read','test-sign-in')),table_name TEXT,column_name TEXT,reads INTEGER NOT NULL DEFAULT 1 CHECK(reads BETWEEN 1 AND 3),credentials TEXT,sign_in_error TEXT,session_review INTEGER NOT NULL DEFAULT 0 CHECK(session_review IN (0,1)));
        ALTER TABLE executions ADD COLUMN activity_state TEXT NOT NULL DEFAULT 'disabled';
        ALTER TABLE executions ADD COLUMN activity_requests INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE executions ADD COLUMN activity_successes INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE executions ADD COLUMN activity_reads INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE executions ADD COLUMN activity_error TEXT;
        ALTER TABLE execution_requests ADD COLUMN kind TEXT NOT NULL DEFAULT 'heartbeat';
        ALTER TABLE execution_requests ADD COLUMN row_count INTEGER;
      `);
      this.db.prepare('INSERT INTO migrations VALUES(2,?)').run(Date.now());
    })();
    this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM migrations WHERE version=3').get()) return;
      this.db.exec(`
        ALTER TABLE project_activity RENAME TO project_activity_v2;
        CREATE TABLE project_activity(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id TEXT NOT NULL,name TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),mode TEXT NOT NULL DEFAULT 'public-read' CHECK(mode IN ('public-read','test-sign-in')),table_name TEXT,column_name TEXT,reads INTEGER NOT NULL DEFAULT 1 CHECK(reads BETWEEN 1 AND 3),credentials TEXT,sign_in_error TEXT,session_review INTEGER NOT NULL DEFAULT 0 CHECK(session_review IN (0,1)),PRIMARY KEY(project_id,id));
        INSERT INTO project_activity SELECT project_id,'default','Additional activity',enabled,mode,table_name,column_name,reads,credentials,sign_in_error,session_review FROM project_activity_v2;
        DROP TABLE project_activity_v2;
        ALTER TABLE execution_requests ADD COLUMN activity_id TEXT;
        ALTER TABLE execution_requests ADD COLUMN activity_name TEXT;
      `);
      this.db.prepare('INSERT INTO migrations VALUES(3,?)').run(Date.now());
    })();
    this.orm = drizzle(this.db);
    if (!this.get('monitoring'))
      this.set('monitoring', settingsSchema.parse({ ...defaults, ...initial }));
  }
  get<T = string>(key: string): T | null {
    const row = this.orm.select().from(kv).where(eq(kv.key, key)).get();
    return row ? (JSON.parse(row.value) as T) : null;
  }
  set(key: string, value: unknown) {
    this.orm
      .insert(kv)
      .values({ key, value: JSON.stringify(value) })
      .onConflictDoUpdate({ target: kv.key, set: { value: JSON.stringify(value) } })
      .run();
  }
  settings() {
    return settingsSchema.parse(this.get('monitoring'));
  }
  projects(): Project[] {
    const rows = this.db
      .prepare(
        `SELECT p.*, (SELECT count(*) FROM executions e WHERE e.project_id=p.id AND e.state='failed' AND e.started>?) AS failures FROM projects p ORDER BY p.name`,
      )
      .all(Date.now() - 7 * 86400_000) as Omit<Project, 'activity' | 'activities'>[];
    // Never select the encrypted credential column into API-facing project objects.
    const configs = this.db
      .prepare(
        'SELECT project_id,id,name,enabled,mode,table_name,column_name,reads,credentials IS NOT NULL AS configured,session_review,sign_in_error FROM project_activity ORDER BY rowid',
      )
      .all() as {
      project_id: string;
      id: string;
      name: string;
      enabled: number;
      mode: ProjectActivity['mode'];
      table_name: string | null;
      column_name: string | null;
      reads: number;
      configured: number;
      session_review: number;
      sign_in_error: string | null;
    }[];
    const byProject = new Map<string, SavedActivity[]>();
    for (const a of configs) {
      const list = byProject.get(a.project_id) ?? [];
      list.push({
        id: a.id,
        name: a.name,
        enabled: !!a.enabled,
        mode: a.mode,
        table: a.table_name,
        column: a.column_name,
        reads: a.reads,
        credentialsConfigured: !!a.configured,
        sessionReviewRequired: !!a.session_review,
        signInError: a.sign_in_error,
      });
      byProject.set(a.project_id, list);
    }
    return rows.map((p) => {
      const activities = byProject.get(p.id) ?? [];
      return {
        ...p,
        activities,
        activity: activities.find((a) => a.id === 'default') ?? { ...defaultActivity },
      };
    });
  }
  activitySecret(project: string, id = 'default') {
    return (
      (
        this.db
          .prepare('SELECT credentials FROM project_activity WHERE project_id=? AND id=?')
          .get(project, id) as { credentials: string | null } | undefined
      )?.credentials ?? null
    );
  }

  project(id: string) {
    return this.projects().find((p) => p.id === id);
  }
  log(
    level: string,
    event: string,
    project: string | null = null,
    details: Record<string, unknown> = {},
  ) {
    this.db
      .prepare('INSERT INTO logs(at,level,event,project_id,details) VALUES(?,?,?,?,?)')
      .run(Date.now(), level, event, project, JSON.stringify(details));
  }
  prune() {
    const until = Date.now() - this.settings().retentionDays * 86400_000;
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM logs WHERE at<?').run(until);
      this.db.prepare("DELETE FROM executions WHERE started<? AND state!='running'").run(until);
      this.db.prepare("DELETE FROM jobs WHERE state!='pending' AND due<?").run(until);
      this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
      this.db.prepare('DELETE FROM oauth_flow WHERE expires<?').run(Date.now());
    })();
  }
}
