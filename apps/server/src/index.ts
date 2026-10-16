import { z } from 'zod';
import { createApp } from './app.js';
const env = z
  .object({
    ENCRYPTION_KEY: z.string().length(64),
    APP_URL: z.url().default('http://localhost:8080'),
    DATABASE_PATH: z.string().default('data/supabeacon.db'),
    SETUP_TOKEN: z.string().min(32),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    HOST: z.string().default('127.0.0.1'),
    TRUST_PROXY: z.string().optional(),
    HEARTBEATS_PER_DAY: z.coerce.number().default(2),
    REQUESTS_PER_HEARTBEAT: z.coerce.number().default(2),
    TIMEZONE: z.string().default(Intl.DateTimeFormat().resolvedOptions().timeZone),
    AUTO_ENABLE: z.enum(['true', 'false']).default('true'),
  })
  .parse(process.env);
const { app, engine } = await createApp({
  database: env.DATABASE_PATH,
  key: env.ENCRYPTION_KEY,
  origin: env.APP_URL,
  setupToken: env.SETUP_TOKEN,
  trustProxy: env.TRUST_PROXY,
  initial: {
    frequency: env.HEARTBEATS_PER_DAY,
    requests: env.REQUESTS_PER_HEARTBEAT,
    timezone: env.TIMEZONE,
    autoEnable: env.AUTO_ENABLE === 'true',
  },
});
await app.listen({ port: env.PORT, host: env.HOST });
engine.start();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
