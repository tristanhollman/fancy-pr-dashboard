import React, {useState} from 'react';
import {expect, test} from 'bun:test';
import {render} from 'ink-testing-library';
import Workspace from './Workspace.tsx';
import {classify} from './classify.ts';
import {defaultConfig, type Config, type WorkspacePreferences} from './config.ts';
import type {TaggedPullRequest} from './api.ts';
import type {Requirements} from './workspace.ts';
import {rowKey, workspaceLayout} from './workspace.ts';

const me = {id: 'me', displayName: 'Me', uniqueName: 'me@example.test'};
const now = Date.now();
function config() {
  const value = defaultConfig();
  value.org = 'example';
  value.projects = ['Delivery'];
  value.team.members = ['peer@example.test'];
  value.ui.workspace.mouseEnabled = false;
  return value;
}
function pr(id: number, repo: string, age: number, overrides: Partial<TaggedPullRequest> = {}): TaggedPullRequest {
  return {pullRequestId: id, title: `Improve feature ${id}`, creationDate: new Date(now - age * 3600000).toISOString(),
    description: '## Summary\nMake the feature easier to use.\n\n- Preserve existing behavior.\n- Handle missing input.\n\n' + 'More context for reviewers.\n'.repeat(30),
    repository: {name: repo}, project: 'Delivery', createdBy: {id: 'peer', displayName: 'Peer'},
    sourceRefName: 'refs/heads/feature', targetRefName: 'refs/heads/main',
    reviewers: [{id: 'peer', uniqueName: 'peer@example.test', vote: 0}, {...me, vote: 0}], ...overrides};
}
const samples = [pr(901, 'alpha', 5), pr(902, 'beta', 2), pr(903, 'alpha', 1)];
const settle = () => Bun.sleep(30);

function Harness({width = 150, height = 32, prs = samples, onOpen = () => {}, requirements = {}, initialConfig = config()}:
  {width?: number; height?: number; prs?: TaggedPullRequest[]; onOpen?: (id: number) => void; requirements?: Requirements; initialConfig?: Config}) {
  const [current, setCurrent] = useState(initialConfig);
  return <Workspace config={current} rows={prs.map(value => classify(value, current, me, now))}
    requirements={requirements} refreshedAt={now} columns={width} height={height}
    onPreferencesChange={workspace => setCurrent({...current, ui: {...current.ui, workspace}})}
    onToggleFilter={key => setCurrent({...current, ui: {...current.ui, [key]: !current.ui[key]}})}
    onRefresh={() => {}} onSettings={() => {}} onQuit={() => {}} onOpen={row => onOpen(row.id)} />;
}

test('workspace has named panels, footer toggles and independent description', () => {
  const {lastFrame, unmount} = render(<Harness />);
  const text = lastFrame() ?? '';
  expect(text).toContain('Repositories');
  expect(text).toContain('PR inspector');
  expect(text).toContain('Team queue');
  expect(text).toContain('DESCRIPTION');
  expect(text).toContain('Make the feature');
  expect(text).toContain('Unknown');
  expect(text).not.toContain('01 Repositories');
  expect(text.split('\n').length).toBeLessThanOrEqual(32);
  for (const line of text.split('\n')) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(150);
  unmount();
});

test('grouping and global date sorting share navigation and preserve selected identity', async () => {
  let opened = 0;
  const {stdin, lastFrame, unmount} = render(<Harness onOpen={id => { opened = id; }} />);
  await settle();
  stdin.write('\r');
  await settle();
  expect(opened).toBe(903);
  stdin.write('u');
  await settle();
  stdin.write('j');
  await settle();
  stdin.write('\r');
  await settle();
  expect(opened).toBe(902);
  expect(lastFrame()).toContain('Delivery/beta');
  stdin.write('o');
  await settle();
  stdin.write('\r');
  await settle();
  expect(opened).toBe(902);
  stdin.write('g');
  await settle();
  stdin.write('\r');
  await settle();
  expect(opened).toBe(901);
  unmount();
});

test('search accepts shortcut letters, Escape clears, and repo picker filters', async () => {
  const {stdin, lastFrame, unmount} = render(<Harness />);
  await settle();
  stdin.write('/');
  await settle();
  stdin.write('beta');
  await settle();
  stdin.write('\r');
  await settle();
  expect(lastFrame()).toContain('1 visible');
  expect(lastFrame()).toContain('!902');
  stdin.write('/');
  await settle();
  stdin.write('\u001b');
  await settle();
  expect(lastFrame()).toContain('3 visible');
  stdin.write('f');
  await settle();
  expect(lastFrame()).toContain('Repository filter');
  stdin.write('j');
  await settle();
  stdin.write('\r');
  await settle();
  expect(lastFrame()).toContain('2 visible');
  expect(lastFrame()).not.toContain('!902');
  unmount();
});

for (const height of [24, 10]) {
  test(`long search stays in its own line at 80x${height}, including after terminal resize`, async () => {
    const instance = render(<Harness width={80} height={height} />);
    const searchLine = height < 12 ? 0 : 2;
    const expectIsolated = (width: number) => {
      const lines = (instance.lastFrame() ?? '').split('\n');
      expect(lines.length).toBeLessThanOrEqual(height);
      expect(lines[searchLine]).toContain('TAIL');
      expect(lines[searchLine]).toContain('/ ');
      expect(Bun.stringWidth(lines[searchLine] ?? '')).toBeLessThanOrEqual(width);
      for (const [index, line] of lines.entries()) {
        expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width);
        if (index !== searchLine) {
          expect(line).not.toContain('needle');
          expect(line).not.toContain('TAIL');
        }
      }
      expect(lines.some(line => line.includes('Team queue · 0'))).toBe(true);
    };
    try {
      await settle();
      instance.stdin.write('/');
      await settle();
      instance.stdin.write('needle'.repeat(45) + 'TAIL');
      await settle();
      expectIsolated(80);
      instance.rerender(<Harness width={60} height={height} />);
      await settle();
      expectIsolated(60);
      instance.stdin.write('\x1b[H');
      await settle();
      instance.stdin.write('START');
      await settle();
      expect(instance.lastFrame()?.split('\n')[searchLine]).toContain('START');
      instance.stdin.write('\x1b[F');
      await settle();
      expectIsolated(60);
    } finally {
      instance.unmount();
      instance.cleanup();
    }
  });
}

test('queue-only filters keep approved PRs accessible in All open', async () => {
  const reviewed = pr(904, 'beta', 1, {reviewers: [{id: 'peer', uniqueName: 'peer@example.test', vote: 0}, {...me, vote: 10}]});
  const complete = pr(905, 'beta', 2);
  const row = classify(complete, config(), me, now);
  const requirements: Requirements = {[rowKey(row)]: {status: 'complete', minimum: {approved: 2, required: 2}, requiredReviewers: {approved: 0, total: 0}, notes: []}};
  const {stdin, lastFrame, unmount} = render(<Harness prs={[reviewed, complete]} requirements={requirements} />);
  await settle();
  expect(lastFrame()).toContain('Nothing waiting');
  expect(lastFrame()).toContain('queue hides 1 reviewed + 1 required met');
  stdin.write('4');
  await settle();
  expect(lastFrame()).toContain('!904');
  expect(lastFrame()).toContain('!905');
  unmount();
});

test('narrow windows switch details instead of squeezing panes; help is accessible', async () => {
  const {stdin, lastFrame, unmount} = render(<Harness width={80} height={24} />);
  await settle();
  expect(lastFrame()).not.toContain('PR inspector');
  stdin.write('p');
  await settle();
  expect(lastFrame()).toContain('PR inspector');
  expect(lastFrame()).not.toContain('Repositories');
  stdin.write('j');
  await settle();
  stdin.write('p');
  await settle();
  expect(lastFrame()).not.toContain('PR inspector');
  stdin.write('?');
  await settle();
  expect(lastFrame()).toContain('Keyboard help');
  expect((lastFrame() ?? '').split('\n').length).toBeLessThanOrEqual(24);
  unmount();
});

test('short/small terminals stay within the viewport', () => {
  for (const [width, height] of [[80, 12], [40, 8], [30, 7], [100, 24], [180, 50]]) {
    const {lastFrame, unmount} = render(<Harness width={width} height={height} />);
    const lines = (lastFrame() ?? '').split('\n');
    expect(lines.length).toBeLessThanOrEqual(height!);
    for (const line of lines) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width!);
    unmount();
  }
});

test('same PR stays selected after refresh reorders payloads', async () => {
  let opened = 0;
  const {stdin, rerender, unmount} = render(<Harness onOpen={id => { opened = id; }} />);
  await settle();
  stdin.write('j');
  await settle();
  stdin.write('\r');
  await settle();
  expect(opened).toBe(901);
  rerender(<Harness prs={[samples[2]!, samples[1]!, samples[0]!]} onOpen={id => { opened = id; }} />);
  await settle();
  stdin.write('\r');
  await settle();
  expect(opened).toBe(901);
  unmount();
});

test('authors are visible in both grouped and flat lists without a generic Team review label', async () => {
  const samples = [pr(906, 'alpha', 1, {createdBy: {id: 'author', displayName: 'Ari Example'},
    reviewers: [{id: 'peer', uniqueName: 'peer@example.test', vote: 0}]})];
  const {stdin, lastFrame, unmount} = render(<Harness prs={samples} width={80} />);
  try {
    await settle();
    expect(lastFrame()).not.toContain('PR inspector');
    expect(lastFrame()).toContain('@Ari Example');
    expect(lastFrame()).not.toContain('Team review');
    stdin.write('u');
    await settle();
    expect(lastFrame()).toContain('@Ari Example');
    expect(lastFrame()).toContain('Delivery/alpha');
    expect(lastFrame()).not.toContain('Team review');
  } finally {
    unmount();
  }
});

test('rendered PR entries have breathing room and keyboard navigation skips spacers', async () => {
  let opened = 0;
  const {stdin, lastFrame, unmount} = render(<Harness width={80} height={32} onOpen={id => { opened = id; }} />);
  const expectSpacer = () => {
    const lines = (lastFrame() ?? '').split('\n');
    const metadata = lines.findIndex(line => line.includes('!903'));
    expect(metadata).toBeGreaterThanOrEqual(0);
    expect(lines[metadata + 1]?.replace(/[│\s]/g, '')).toBe('');
  };
  try {
    await settle();
    expectSpacer();
    stdin.write('j');
    await settle();
    stdin.write('\r');
    await settle();
    expect(opened).toBe(901);
    stdin.write('u');
    await settle();
    expectSpacer();
    stdin.write('g');
    await settle();
    stdin.write('j');
    await settle();
    stdin.write('\r');
    await settle();
    expect(opened).toBe(902);
  } finally {
    unmount();
  }
});

test('My PRs shows drafts by default and draft/bot shortcuts stay local to that tab', async () => {
  const initial = config();
  initial.ui.botAuthors = ['Automation'];
  const data = [
    pr(907, 'alpha', 1),
    pr(908, 'alpha', 2, {title: 'Other draft', isDraft: true}),
    pr(909, 'alpha', 3, {title: 'My draft', createdBy: {...me, displayName: 'Owner'}, isDraft: true}),
    pr(910, 'alpha', 4, {title: 'My bot PR', createdBy: {...me, displayName: 'Automation'}}),
  ];
  const {stdin, lastFrame, unmount} = render(<Harness prs={data} initialConfig={initial} width={100} height={34} />);
  try {
    await settle();
    expect(lastFrame()).not.toContain('My draft');
    expect(lastFrame()).not.toContain('Other draft');
    stdin.write('3');
    await settle();
    expect(lastFrame()).toContain('My draft');
    expect(lastFrame()).not.toContain('My bot PR');
    expect(lastFrame()).toContain('my drafts:shown');
    stdin.write('d');
    await settle();
    expect(lastFrame()).not.toContain('My draft');
    stdin.write('b');
    await settle();
    expect(lastFrame()).toContain('My bot PR');
    stdin.write('4');
    await settle();
    expect(lastFrame()).not.toContain('My draft');
    expect(lastFrame()).not.toContain('Other draft');
    expect(lastFrame()).not.toContain('My bot PR');
    expect(lastFrame()).toContain('drafts:hidden');
    stdin.write('d');
    await settle();
    expect(lastFrame()).toContain('Other draft');
    stdin.write('3');
    await settle();
    expect(lastFrame()).not.toContain('My draft');
    expect(lastFrame()).toContain('My bot PR');
  } finally {
    unmount();
  }
});

test('coalesced mouse reports resize the divider without requiring a render between press and motion', async () => {
  const updates: WorkspacePreferences[] = [];
  const initial = config();
  initial.ui.workspace.mouseEnabled = true;
  const geometry = workspaceLayout(150, 32, initial.ui.workspace);
  function Example() {
    const [current, setCurrent] = useState(initial);
    return <Workspace config={current} rows={samples.map(pr => classify(pr, current, me, now))}
      requirements={{}} refreshedAt={now} columns={150} height={32}
      onPreferencesChange={workspace => { updates.push(workspace); setCurrent({...current, ui: {...current.ui, workspace}}); }}
      onToggleFilter={() => {}} onRefresh={() => {}} onSettings={() => {}} onQuit={() => {}} onOpen={() => {}} />;
  }
  const instance = render(<Example />);
  try {
    await settle();
    Object.defineProperty(instance.stdout, 'isTTY', {value: true});
    instance.rerender(<Example />);
    await settle();
    instance.stdin.write(`\x1b[<0;${geometry.detailX};10M\x1b[<32;101;10M\x1b[<0;101;10m`);
    await settle();
    expect(updates.at(-1)?.listShare).toBeCloseTo((100 - geometry.queueX) / 150);
    const count = updates.length;
    instance.stdin.write('\x1b[<32;110;10M');
    await settle();
    expect(updates).toHaveLength(count);
    instance.stdin.write('\t');
    await settle();
    instance.stdin.write('\t');
    await settle();
    instance.stdin.write('[');
    await settle();
    expect(updates.at(-1)?.repoWidth).toBe(19);
  } finally {
    instance.unmount();
    instance.cleanup();
  }
});
