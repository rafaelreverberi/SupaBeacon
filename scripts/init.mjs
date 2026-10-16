import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
if (existsSync('.env')) {
  console.log('Existing .env preserved.');
  process.exit(0);
}
const key = randomBytes(32).toString('hex'),
  token = randomBytes(32).toString('hex');
writeFileSync(
  '.env',
  `ENCRYPTION_KEY=${key}\nSETUP_TOKEN=${token}\nAPP_URL=http://localhost:8080\nAPP_URL_MODE=auto\nDATABASE_PATH=data/supabeacon.db\nHOST=127.0.0.1\nPORT=8080\nDASHBOARD_PORT=8080\nBIND_ADDRESS=127.0.0.1\nTIMEZONE=${Intl.DateTimeFormat().resolvedOptions().timeZone}\nHEARTBEATS_PER_DAY=2\nREQUESTS_PER_HEARTBEAT=2\nAUTO_ENABLE=true\n`,
  { mode: 0o600 },
);
console.log(
  'Created .env with mode 0600. Use SETUP_TOKEN from that file to create your first administrator.',
);
