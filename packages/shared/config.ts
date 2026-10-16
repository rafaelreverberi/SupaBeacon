import { z } from 'zod';
export const timezone = z
  .string()
  .max(80)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, 'Use an IANA timezone');
export const monitoringSchema = z.object({
  frequency: z.number().int().min(1).max(6),
  requests: z.number().int().min(1).max(3),
  randomized: z.boolean(),
  fixedTimes: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(6),
  retry: z.boolean(),
  maxRetries: z.number().int().min(0).max(3),
  timeout: z.number().int().min(3).max(60),
});
export const settingsSchema = monitoringSchema
  .extend({
    timezone,
    enabled: z.boolean(),
    autoEnable: z.boolean(),
    discoveryHours: z.number().int().min(1).max(24),
    concurrency: z.number().int().min(1).max(5),
    retentionDays: z.number().int().min(7).max(365),
    theme: z.enum(['dark', 'light', 'system']),
    dateFormat: z.enum(['24h', '12h']),
  })
  .refine(
    (v) => v.randomized || v.fixedTimes.length === v.frequency,
    'Fixed schedule must have one time per daily heartbeat',
  )
  .refine((v) => new Set(v.fixedTimes).size === v.fixedTimes.length, 'Fixed times must be unique');
export type Settings = z.infer<typeof settingsSchema>;
export const defaults: Settings = {
  frequency: 2,
  requests: 2,
  randomized: true,
  fixedTimes: ['06:00', '18:00'],
  retry: true,
  maxRetries: 2,
  timeout: 15,
  timezone: 'Europe/Zurich',
  enabled: true,
  autoEnable: true,
  discoveryHours: 2,
  concurrency: 2,
  retentionDays: 30,
  theme: 'dark',
  dateFormat: '24h',
};
export const overrideSchema = z
  .object({
    frequency: z.number().int().min(1).max(6).optional(),
    requests: z.number().int().min(1).max(3).optional(),
  })
  .strict();
const identifier = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/);
export const activityPatchSchema = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(['public-read', 'test-sign-in']),
    table: identifier.nullable(),
    column: identifier.nullable(),
    reads: z.number().int().min(1).max(3),
    testAccount: z
      .object({
        email: z.email().max(254),
        password: z.string().min(1).max(256),
        dedicated: z.literal(true),
      })
      .strict()
      .nullable()
      .optional(),
    acknowledgeSessionReview: z.literal(true).optional(),
  })
  .strict();
export interface ProjectActivity {
  enabled: boolean;
  mode: 'public-read' | 'test-sign-in';
  table: string | null;
  column: string | null;
  reads: number;
  credentialsConfigured: boolean;
  sessionReviewRequired: boolean;
  signInError: string | null;
}
export const defaultActivity: ProjectActivity = {
  enabled: false,
  mode: 'public-read',
  table: null,
  column: null,
  reads: 1,
  credentialsConfigured: false,
  sessionReviewRequired: false,
  signInError: null,
};
export const projectPatch = z
  .object({
    activity: activityPatchSchema.optional(),
    enabled: z.boolean().optional(),
    overrides: overrideSchema.nullable().optional(),
    strategy: z.enum(['management', 'data']).optional(),
    safeTable: z
      .string()
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/)
      .nullable()
      .optional(),
  })
  .strict();
export interface Project {
  activity: ProjectActivity;
  id: string;
  name: string;
  organization: string;
  region: string;
  status: string;
  present: number;
  enabled: number;
  strategy: 'management' | 'data';
  safe_table: string | null;
  overrides: string | null;
  first_seen: number;
  last_seen: number;
  last_run: number | null;
  last_success: number | null;
  next_run: number | null;
  last_error: string | null;
  failures: number;
}
export interface Execution {
  activity_state: string;
  activity_requests: number;
  activity_successes: number;
  activity_reads: number;
  activity_error: string | null;
  id: string;
  project_id: string;
  source: string;
  strategy: string;
  state: string;
  started: number;
  finished: number | null;
  requests: number;
  successes: number;
  database_ok: number;
  error: string | null;
  duration: number | null;
}
export const budget = (settings: Pick<Settings, 'frequency' | 'requests'>, projects: number) =>
  settings.frequency * settings.requests * projects;
export const runnable = (p: Pick<Project, 'status' | 'present'>) =>
  p.present === 1 && p.status === 'ACTIVE_HEALTHY';
