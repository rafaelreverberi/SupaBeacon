import { z } from 'zod';
import type { ActivitySchema } from '../../../packages/shared/config.js';
import { Supabase, ServiceError } from './supabase.js';
import { boundedJson } from './response.js';

// Fixed metadata-only query: no user SQL and no application row values.
export const activitySchemaQuery = `SELECT c.table_name, c.column_name, c.data_type
FROM information_schema.columns AS c
JOIN information_schema.tables AS t
  ON t.table_schema = c.table_schema AND t.table_name = c.table_name
WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
  AND c.table_name ~ '^[a-zA-Z_][a-zA-Z0-9_]{0,62}$'
  AND c.column_name ~ '^[a-zA-Z_][a-zA-Z0-9_]{0,62}$'
ORDER BY c.table_name, c.ordinal_position
LIMIT 2001;`;
const identifier = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/);
const metadata = z
  .array(
    z.object({
      table_name: identifier,
      column_name: identifier,
      data_type: z.string().min(1).max(100),
    }),
  )
  .max(2001);

export async function activitySchema(api: Supabase, ref: string): Promise<ActivitySchema> {
  const actual = (await (await api.api(`/projects/${ref}`)).json()) as { status?: string };
  if (actual.status !== 'ACTIVE_HEALTHY') throw new ServiceError('PROJECT_NOT_ACTIVE', 409);
  const response = await api.api(`/projects/${ref}/database/query/read-only`, {
    method: 'POST',
    body: JSON.stringify({ query: activitySchemaQuery }),
  });
  let rows: z.infer<typeof metadata>;
  try {
    rows = metadata.parse(await boundedJson(response, 1024 * 1024));
  } catch {
    throw new ServiceError('SCHEMA_RESPONSE_INVALID', 502);
  }
  // A partial table would hide columns. Keep the manual fallback for large schemas.
  if (rows.length > 2000) throw new ServiceError('SCHEMA_TOO_LARGE_USE_MANUAL_ENTRY', 422);
  const tables = new Map<string, { name: string; columns: { name: string; type: string }[] }>();
  for (const row of rows) {
    if (!tables.has(row.table_name))
      tables.set(row.table_name, { name: row.table_name, columns: [] });
    tables.get(row.table_name)!.columns.push({ name: row.column_name, type: row.data_type });
  }
  return { schema: 'public' as const, tables: [...tables.values()] };
}
