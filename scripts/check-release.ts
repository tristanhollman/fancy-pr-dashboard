import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {dist, root, version} from './release.ts';

const tag = process.env.RELEASE_TAG;
if (tag !== `v${version}`) {
  throw new Error(`Release tag must equal package.json version: expected v${version}, received ${tag ?? '(unset)'}`);
}
const changelog = await Bun.file(path.join(root, 'CHANGELOG.md')).text();
const section = changelog.split(/^## /m).find(value => value.startsWith(`${version}\n`));
if (!section) throw new Error(`CHANGELOG.md is missing notes for ${version}`);

mkdirSync(dist, {recursive: true});
await Bun.write(path.join(dist, 'RELEASE_NOTES.md'), `## ${section.trim()}\n`);
console.log(`Validated ${tag}; release notes are in dist/RELEASE_NOTES.md.`);
