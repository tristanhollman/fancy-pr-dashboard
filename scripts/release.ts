import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const dist = path.join(root, 'dist');
export const {version} = await Bun.file(path.join(root, 'package.json')).json() as {version: string};
export const targets = ['linux-x64', 'windows-x64'] as const;
export type Target = typeof targets[number];

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid release version: ${version}`);
}

export function assetName(target: Target): string {
  return `fpr-v${version}-${target}${target === 'windows-x64' ? '.exe' : ''}`;
}

export async function writeChecksums(selected: readonly Target[] = targets): Promise<void> {
  mkdirSync(dist, {recursive: true});
  const lines: string[] = [];
  for (const target of selected) {
    const name = assetName(target);
    const bytes = await Bun.file(path.join(dist, name)).arrayBuffer();
    const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    lines.push(`${hash}  ${name}`);
  }
  await Bun.write(path.join(dist, 'SHA256SUMS'), `${lines.join('\n')}\n`);
}

if (import.meta.main) {
  await writeChecksums();
  console.log('Wrote dist/SHA256SUMS for both release binaries.');
}
