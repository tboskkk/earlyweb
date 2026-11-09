// Builds the EarlyWeb apps into a chosen output root (cross-platform, no shell env syntax).
//   node tools/app-build/build-apps.ts --out dist/bundle-apps [--clean] [--with-fixtures] [--watch]
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'dist/apps' },
    clean: { type: 'boolean', default: false },
    'with-fixtures': { type: 'boolean', default: false },
    watch: { type: 'boolean', default: false },
  },
});

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const out = values.out as string;
if (values.clean) rmSync(path.resolve(repoRoot, out), { recursive: true, force: true });

const args = ['-r', '--filter', './apps/*'];
if (values['with-fixtures']) args.push('--filter', './tests/fixtures/*');
args.push('build');
if (values.watch) args.push('--watch');

const child = spawn('pnpm', args, {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, EW_APPS_OUT: out },
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
