import {mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {assetName, dist, type Target} from './release.ts';

if (process.arch !== 'x64' || !['linux', 'win32'].includes(process.platform)) {
  throw new Error('Runtime smoke requires a native Linux x64 or Windows x64 runner.');
}
const target: Target = process.platform === 'win32' ? 'windows-x64' : 'linux-x64';
const binary = path.join(dist, assetName(target));
const home = path.join(dist, `smoke-${crypto.randomUUID()}`);
mkdirSync(home, {recursive: true});

// Allowlist the child environment: never inherit credentials or the real config.
const env: Record<string, string> = {
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, 'AppData', 'Roaming'),
  LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
  XDG_CONFIG_HOME: path.join(home, '.config'),
  CI: 'true',
  NO_COLOR: '1',
};
for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'windir', 'COMSPEC']) {
  if (process.env[key]) env[key] = process.env[key];
}

try {
  const child = Bun.spawn([binary], {
    cwd: home, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  });
  const timeout = setTimeout(() => child.kill(), 15_000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (code !== 1 || stdout.trim() || !stderr.includes('no usable config — run fpr in a terminal to set it up')) {
      throw new Error(`Startup smoke failed (exit ${code}).\n${stdout}${stderr}`);
    }
    console.log(`${assetName(target)}: isolated config-missing startup passed (exit 1).`);
  } finally {
    clearTimeout(timeout);
  }
} finally {
  rmSync(home, {recursive: true, force: true});
}
