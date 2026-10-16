import { ServiceError } from './supabase.js';

export async function boundedJson(response: Response, limit: number): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel();
    throw new ServiceError('ACTIVITY_RESPONSE_INVALID', 502);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ServiceError('ACTIVITY_RESPONSE_INVALID', 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new ServiceError('ACTIVITY_RESPONSE_TOO_LARGE', 413);
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  } finally {
    await reader.cancel().catch(() => {});
  }
}
