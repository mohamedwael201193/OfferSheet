// Spawn backend/server.js on an ephemeral port and report the port Node
// bound (server.address().port), read from the test-only preload.
import { spawn } from 'node:child_process';

const PRELOAD = new URL('./print-bound-port.cjs', import.meta.url).pathname;
const CWD = new URL('..', import.meta.url).pathname;

export async function spawnEphemeralBackend(env) {
  const child = spawn(process.execPath, ['-r', PRELOAD, 'backend/server.js'], {
    cwd: CWD,
    env: { ...env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const port = await readBoundPort(child);
    return { child, port };
  } catch (err) {
    child.kill('SIGTERM');
    throw err;
  }
}

function readBoundPort(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(`backend did not report a bound port\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 10000);

    function finish(err, port) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(port);
    }

    child.stdout.on('data', (chunk) => {
      if (settled) return;
      stdout += chunk.toString();
      const match = stdout.match(/BOUND_PORT (\d+)/);
      if (match) finish(null, Number(match[1]));
    });
    child.stderr.on('data', (chunk) => {
      if (settled) return;
      stderr += chunk.toString();
    });
    child.once('exit', (code) => {
      finish(new Error(`backend exited (${code}) before binding\nstdout: ${stdout}\nstderr: ${stderr}`));
    });
  });
}
