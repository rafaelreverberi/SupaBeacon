import type { Project } from '../../../../packages/shared/config';
export type Connection = {
  configured: boolean;
  connected: boolean;
  reauthorize: boolean;
  dataEnabled: boolean;
  callback: string;
  callbackAllowed: boolean;
  scopes: string[];
  expectedScopes: string[];
  lastSync: number | null;
  syncError: string | null;
};
export type Overview = {
  projects: Project[];
  connection: Connection;
  scheduler: boolean;
  uptime: number;
  total: number;
  enabled: number;
  disabled: number;
  paused: number;
  successToday: number;
  failedToday: number;
  requestsToday: number;
  nextRun: number | null;
  lastSuccess: number | null;
  chart: { date: string; success: number; failed: number }[];
};
export type Log = {
  id: number;
  at: number;
  level: string;
  event: string;
  project_id: string | null;
  details: string;
};
export type Result<T> = { items: T[]; total: number; page: number };
export type Action = (fn: () => Promise<unknown>, message?: string) => Promise<void>;
