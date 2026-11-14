// Builds the desktop self-test binary (`--features e2e`, fixtures bundled), runs it
// against fresh home and data folders, and exits with its code. The binary judges itself
// (src-tauri/src/e2e.rs): 0 pass, 1 leak or tampered canary, 3 watchdog.
//   node tools/tauri-e2e/run.ts [--no-build]
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const win = process.platform === 'win32';
const RUN_TIMEOUT_MS = 120_000;

if (!process.argv.includes('--no-build')) {
  const build = spawnSync(
    'pnpm',
    [
      'tauri',
      'build',
      '--debug',
      '--no-bundle',
      '--features',
      'e2e',
      '--config',
      'src-tauri/tauri.e2e.conf.json',
    ],
    { cwd: repoRoot, stdio: 'inherit', shell: win },
  );
  if (build.status !== 0) {
    console.error(`e2e build failed (${build.status ?? build.signal})`);
    process.exit(2);
  }
}

const bin = path.join(repoRoot, 'src-tauri', 'target', 'debug', win ? 'earlyweb.exe' : 'earlyweb');
const scratch = mkdtempSync(path.join(tmpdir(), 'ew-tauri-e2e-'));
const env = {
  ...process.env,
  EARLYWEB_HOME: path.join(scratch, 'home'),
  EARLYWEB_DATA: path.join(scratch, 'data'),
};

const child = spawn(bin, [], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (chunk: Buffer) => {
  out += chunk.toString();
  process.stdout.write(chunk);
});
const killer = setTimeout(() => {
  console.error(`e2e: no exit after ${RUN_TIMEOUT_MS / 1000}s, killing`);
  child.kill('SIGKILL');
}, RUN_TIMEOUT_MS);

child.on('exit', (code, signal) => {
  clearTimeout(killer);
  rmSync(scratch, { recursive: true, force: true });
  const line = out.split(/\r?\n/).find((l) => l.startsWith('EW-SELFTEST '));
  console.log(line ?? 'EW-SELFTEST line missing');
  // A clean exit without the report line (e.g. another instance took over) is a failure.
  if (!line) process.exit(code && code !== 0 ? code : 4);
  process.exit(signal ? 5 : (code ?? 5));
});
