import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === 'win32') {
      spawn(
        resolve(process.env.SystemRoot || 'C:/Windows', 'System32/taskkill.exe'),
        ['/pid', String(child.pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true },
      );
    } else child.kill('SIGTERM');
  }
  process.exitCode = code;
}
function run(args, cwd) {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('error', () => stop(1));
  child.on('exit', (code) => {
    if (!closing) stop(code ?? 1);
  });
}
// Direct Node entry points avoid cmd.exe/PATH differences in Windows IDE shells.
run(
  ['--env-file-if-exists=../../.env', '--import', 'tsx', '--watch', 'src/main.ts'],
  resolve(root, 'apps/server'),
);
run(
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '7457', '--strictPort'],
  resolve(root, 'apps/web'),
);
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
