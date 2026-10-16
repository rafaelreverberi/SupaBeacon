import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
const files = execFileSync('git', ['ls-files', '-z']).toString().split('\0').filter(Boolean);
if (!files.length) throw new Error('Stage repository files before checking publication readiness.');
const environment = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
const secrets = environment
  .split('\n')
  .filter((line) => /^(ENCRYPTION_KEY|SETUP_TOKEN|.*SECRET|.*TOKEN)=/.test(line))
  .map((line) => line.slice(line.indexOf('=') + 1))
  .filter((value) => value.length >= 24 && !value.startsWith('REPLACE_'));
const forbidden = files.filter((file) =>
  /(^|\/)(\.env(?!\.example$)|node_modules|data|backups|test-results)(\/|$)|\.(db|sqlite)(-|$|\.)/.test(
    file,
  ),
);
for (const file of files) {
  const contents = readFileSync(file);
  if (secrets.some((secret) => contents.includes(secret))) forbidden.push(file);
  if (
    !file.includes('/tests/') &&
    /sb_(secret|access|refresh)_[a-zA-Z0-9_-]{20,}/.test(contents.toString())
  )
    forbidden.push(file);
}
if (forbidden.length) {
  console.error('Publication check failed for:', [...new Set(forbidden)].join(', '));
  process.exit(1);
}
console.log(
  `Publication check passed: ${files.length} tracked files; no runtime data, private environment files or generated credentials found.`,
);
