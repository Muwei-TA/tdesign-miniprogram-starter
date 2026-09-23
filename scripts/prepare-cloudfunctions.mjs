// Local deployment mirror for WeChat DevTools. Backend remains the source of truth.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
const frontend = fileURLToPath(new URL('..', import.meta.url));
const backend = resolve(process.argv[2] || resolve(frontend, '../blacklight-development'));
if (!existsSync(resolve(backend, 'scripts/sync-shared.mjs'))) throw new Error('Supply the blacklight backend checkout path');
execFileSync(process.execPath, ['scripts/sync-shared.mjs'], { cwd: backend, stdio: 'inherit' });
for (const name of ['api', 'worker']) {
  const target = resolve(frontend, 'cloudfunctions', name);
  mkdirSync(target, { recursive: true });
  cpSync(resolve(backend, 'cloudfunctions', name), target, {
    recursive: true,
    filter: (source) => basename(source) !== 'node_modules',
  });
}
console.log('Prepared cloudfunctions/api and cloudfunctions/worker for DevTools. Deploy each with cloud-side dependency installation.');
