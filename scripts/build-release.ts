import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {assetName, dist, root, targets, writeChecksums, type Target} from './release.ts';

const args = process.argv.slice(2);
if (args.length > 1 || (args[0] && !targets.includes(args[0] as Target))) {
  throw new Error('Usage: bun run scripts/build-release.ts [linux-x64|windows-x64]');
}
const selected: readonly Target[] = args[0] ? [args[0] as Target] : targets;
mkdirSync(dist, {recursive: true});

for (const target of selected) {
  const result = Bun.spawn([
    process.execPath, 'build', '--compile', `--target=bun-${target}`,
    './src/index.tsx', '--outfile', path.join(dist, assetName(target)),
  ], {cwd: root, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit'});
  if (await result.exited !== 0) throw new Error(`Build failed for ${target}`);
}
await writeChecksums(selected);
console.log('Release binaries and SHA256SUMS are in dist/.');
