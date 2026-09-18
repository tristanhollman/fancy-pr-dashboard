import React from 'react';
import {expect, test} from 'bun:test';
import {render} from 'ink-testing-library';
import App, {type AppServices} from './App.tsx';
import {defaultConfig} from './config.ts';
import type {TaggedPullRequest} from './api.ts';
import type {ReviewRequirements} from './reviews.ts';

const me = {id: 'me', displayName: 'Me', uniqueName: 'me@example.test'};
const pr: TaggedPullRequest = {pullRequestId: 910, title: 'Preserve cached context', creationDate: new Date().toISOString(),
  createdBy: {id: 'other'}, repository: {name: 'sample'}, project: 'project',
  reviewers: [{id: 'other', uniqueName: 'other@example.test', vote: 0}, {...me, vote: 0}]};
function setup() {
  const config = defaultConfig();
  config.org = 'example';
  config.projects = ['project'];
  config.team.members = ['other@example.test'];
  config.ui.workspace.mouseEnabled = false;
  const services: AppServices = {
    fetch: async () => ({me, prs: [pr]}),
    requirements: async () => ({status: 'none', minimum: null, requiredReviewers: {approved: 0, total: 0}, notes: []}),
    files: async () => ({files: 3, truncated: false}),
    details: async (_config, pr) => pr,
    save: async () => {}, open: () => {},
  };
  return {config, services};
}
const settle = () => Bun.sleep(60);
async function waitForFrame(lastFrame: () => string | undefined, text: string) {
  for (let attempt = 0; attempt < 40 && !lastFrame()?.includes(text); attempt++) await Bun.sleep(25);
  expect(lastFrame()).toContain(text);
}

test('failed refresh retains last snapshot and selection', async () => {
  const {config, services} = setup();
  let fail = false;
  services.fetch = async () => {
    if (fail) throw new Error('Service unavailable');
    return {me, prs: [pr]};
  };
  let opened = '';
  services.open = url => { opened = url; };
  const {stdin, lastFrame, unmount} = render(<App initialConfig={config} startInSettings={false} services={services} columns={150} height={32} />);
  await settle();
  expect(lastFrame()).toContain('Preserve cached context');
  fail = true;
  stdin.write('r');
  await settle();
  expect(lastFrame()).toContain('Service unavailable');
  expect(lastFrame()).toContain('Preserve cached context');
  stdin.write('\r');
  await settle();
  expect(opened).toContain('/910');
  unmount();
});

test('requirement API failure is explicit and never hides PRs', async () => {
  const {config, services} = setup();
  services.requirements = async () => { throw new Error('Policy access denied'); };
  const {lastFrame, unmount} = render(<App initialConfig={config} startInSettings={false} services={services} columns={160} height={40} />);
  await settle();
  expect(lastFrame()).toContain('Unknown');
  expect(lastFrame()).toContain('Some review requirements are unavailable');
  expect(lastFrame()).toContain('Policy access denied');
  expect(lastFrame()).toContain('!910');
  unmount();
});

test('rapid shortcut updates serialize config writes and retain latest preferences', async () => {
  const {config, services} = setup();
  let active = 0;
  let max = 0;
  const saved: boolean[] = [];
  services.save = async next => {
    active++;
    max = Math.max(max, active);
    await Bun.sleep(50);
    saved.push(next.ui.workspace.groupByRepo);
    active--;
  };
  const {stdin, lastFrame, unmount} = render(<App initialConfig={config} startInSettings={false} services={services} columns={150} height={32} />);
  await settle();
  stdin.write('u');
  await Bun.sleep(10);
  stdin.write('u');
  await Bun.sleep(140);
  expect(max).toBe(1);
  expect(saved.at(-1)).toBe(true);
  expect(lastFrame()).toContain('u grouped');
  unmount();
});

test('selected PR fetches its full description and reports detail failures without losing preview', async () => {
  const {config, services} = setup();
  let fail = false;
  services.details = async (_config, value) => {
    if (fail) throw new Error('Detail service unavailable');
    return {...value, description: 'Full description beyond the list preview.'};
  };
  const {stdin, lastFrame, unmount} = render(<App initialConfig={config} startInSettings={false} services={services} columns={180} height={40} />);
  await waitForFrame(lastFrame, 'Full description beyond the list preview.');
  fail = true;
  stdin.write('r');
  await waitForFrame(lastFrame, 'Detail service unavailable');
  expect(lastFrame()).toContain('!910');
  unmount();
});

const complete: ReviewRequirements = {
  status: 'complete', minimum: {approved: 2, required: 2},
  requiredReviewers: {approved: 0, total: 0}, notes: [],
};
const pending: ReviewRequirements = {...complete, status: 'pending', minimum: {approved: 1, required: 2}};
const completedPr: TaggedPullRequest = {...pr, pullRequestId: 911, title: 'Already completed review'};

test('initial load never publishes PRs before the requirements used to filter them', async () => {
  const {config, services} = setup();
  const policy = Promise.withResolvers<ReviewRequirements>();
  const started = Promise.withResolvers<void>();
  services.fetch = async () => ({me, prs: [pr, completedPr]});
  services.requirements = async (_config, value) => {
    if (value.pullRequestId === completedPr.pullRequestId) { started.resolve(); return policy.promise; }
    return pending;
  };
  const instance = render(<App initialConfig={config} startInSettings={false} services={services} columns={150} height={32} />);
  try {
    await started.promise;
    await settle();
    expect(instance.lastFrame()).toContain('Loading pull requests');
    expect(instance.frames.some(frame => frame.includes(completedPr.title))).toBe(false);
    policy.resolve(complete);
    await waitForFrame(instance.lastFrame, pr.title);
    expect(instance.lastFrame()).toContain('1 visible');
    expect(instance.frames.some(frame => frame.includes(completedPr.title))).toBe(false);
  } finally {
    policy.resolve(complete);
    instance.unmount();
    instance.cleanup();
  }
});

test('refresh keeps filtered PRs and selection stable until list and policies can be swapped together', async () => {
  const {config, services} = setup();
  let refreshing = false;
  const policy = Promise.withResolvers<ReviewRequirements>();
  const started = Promise.withResolvers<void>();
  services.fetch = async () => ({me, prs: [
    refreshing ? {...pr, title: 'Updated retained PR'} : pr,
    {...completedPr},
  ]});
  services.requirements = async (_config, value) => {
    if (value.pullRequestId !== completedPr.pullRequestId) return pending;
    if (!refreshing) return complete;
    started.resolve();
    return policy.promise;
  };
  let opened = '';
  services.open = url => { opened = url; };
  const instance = render(<App initialConfig={config} startInSettings={false} services={services} columns={150} height={32} />);
  try {
    await waitForFrame(instance.lastFrame, pr.title);
    refreshing = true;
    instance.stdin.write('r');
    await started.promise;
    await settle();
    expect(instance.lastFrame()).toContain('refreshing...');
    expect(instance.lastFrame()).toContain(pr.title);
    expect(instance.lastFrame()).toContain('1 visible');
    expect(instance.lastFrame()).not.toContain('Updated retained PR');
    instance.stdin.write('\r');
    await settle();
    expect(opened).toContain('/910');
    policy.resolve(complete);
    await waitForFrame(instance.lastFrame, 'Updated retained PR');
    expect(instance.frames.some(frame => frame.includes(completedPr.title))).toBe(false);
    expect(instance.lastFrame()).toContain('1 visible');
  } finally {
    policy.resolve(complete);
    instance.unmount();
    instance.cleanup();
  }
});

for (const outcome of ['pending', 'unknown'] as const) {
  test(`a previously hidden PR returns when refreshed requirements become ${outcome}`, async () => {
    const {config, services} = setup();
    let refreshing = false;
    const policy = Promise.withResolvers<ReviewRequirements>();
    const started = Promise.withResolvers<void>();
    services.fetch = async () => ({me, prs: [pr, {...completedPr, lastMergeSourceCommit: {commitId: refreshing ? 'new-head' : 'old-head'}}]});
    services.requirements = async (_config, value) => {
      if (value.pullRequestId !== completedPr.pullRequestId) return pending;
      if (!refreshing) return complete;
      started.resolve();
      return policy.promise;
    };
    const instance = render(<App initialConfig={config} startInSettings={false} services={services} columns={180} height={40} />);
    try {
      await waitForFrame(instance.lastFrame, pr.title);
      refreshing = true;
      instance.stdin.write('r');
      await started.promise;
      await settle();
      expect(instance.lastFrame()).not.toContain(completedPr.title);
      if (outcome === 'pending') policy.resolve(pending);
      else policy.reject(new Error('Policy service unavailable'));
      await waitForFrame(instance.lastFrame, completedPr.title);
      expect(instance.lastFrame()).toContain('Team queue · 2');
      if (outcome === 'unknown') {
        expect(instance.lastFrame()).toContain('Unknown');
        expect(instance.lastFrame()).toContain('Some review requirements are unavailable');
      }
    } finally {
      policy.resolve(pending);
      instance.unmount();
      instance.cleanup();
    }
  });
}

test('eligibility changes during a refresh are resolved before publishing newly unhidden drafts', async () => {
  const {config, services} = setup();
  const ordinary = Promise.withResolvers<ReviewRequirements>();
  const draftPolicy = Promise.withResolvers<ReviewRequirements>();
  const draftStarted = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const draft = {...completedPr, isDraft: true};
  let refreshing = false;
  services.fetch = async () => ({me, prs: [pr, draft]});
  services.requirements = async (_config, value) => {
    if (value.isDraft) { draftStarted.resolve(); return draftPolicy.promise; }
    if (refreshing) { started.resolve(); return ordinary.promise; }
    return pending;
  };
  const instance = render(<App initialConfig={config} startInSettings={false} services={services} columns={150} height={32} />);
  try {
    await waitForFrame(instance.lastFrame, pr.title);
    refreshing = true;
    instance.stdin.write('r');
    await started.promise;
    instance.stdin.write('d');
    await settle();
    ordinary.resolve(pending);
    await draftStarted.promise;
    await settle();
    draftPolicy.resolve(complete);
    await waitForFrame(instance.lastFrame, 'queue hides 0 reviewed + 1 required met');
    // Newly unhidden rows in the old cached snapshot may lack policies; the new snapshot
    // must still include every requirement for the latest draft/bot filter preferences.
    expect(instance.lastFrame()).not.toContain(draft.title);
  } finally {
    ordinary.resolve(pending);
    draftPolicy.resolve(complete);
    instance.unmount();
    instance.cleanup();
  }
});

test('own drafts receive metadata and My PRs shortcuts persist without changing shared filters', async () => {
  const {config, services} = setup();
  const mine = {...pr, pullRequestId: 920, title: 'My work in progress', isDraft: true, createdBy: me};
  const requiredIds: number[] = [];
  const fileIds: number[] = [];
  const saved: ReturnType<typeof defaultConfig>[] = [];
  services.fetch = async () => ({me, prs: [pr, mine]});
  services.requirements = async (_config, value) => { requiredIds.push(value.pullRequestId); return pending; };
  services.files = async (_config, value) => { fileIds.push(value.pullRequestId); return {files: 7, truncated: false}; };
  services.save = async value => { saved.push(value); };
  const instance = render(<App initialConfig={config} startInSettings={false} services={services} columns={150} height={32} />);
  try {
    await waitForFrame(instance.lastFrame, pr.title);
    expect(requiredIds).toContain(mine.pullRequestId);
    instance.stdin.write('3');
    await waitForFrame(instance.lastFrame, mine.title);
    await settle();
    expect(fileIds).toContain(mine.pullRequestId);
    expect(instance.lastFrame()).toContain('7f');
    instance.stdin.write('d');
    await waitForFrame(instance.lastFrame, 'Nothing waiting here');
    expect(saved.at(-1)?.ui.workspace.hideMyDrafts).toBe(true);
    expect(saved.at(-1)?.ui.hideDrafts).toBe(true);
    instance.stdin.write('d');
    await waitForFrame(instance.lastFrame, mine.title);
    expect(saved.at(-1)?.ui.workspace.hideMyDrafts).toBe(false);
    expect(saved.at(-1)?.ui.hideDrafts).toBe(true);
    instance.stdin.write('1');
    await waitForFrame(instance.lastFrame, pr.title);
    expect(instance.lastFrame()).not.toContain(mine.title);
  } finally {
    instance.unmount();
    instance.cleanup();
  }
});

for (const save of [false, true]) {
  test(`settings ${save ? 'save' : 'cancel'} preserves tab, search, repository, selection and inspector scroll`, async () => {
    const {config, services} = setup();
    config.auth.mode = 'az-cli';
    services.validateSettings = async () => null;
    const other = {...pr, pullRequestId: 921, title: 'Other workspace item', repository: {name: 'other'}};
    const selected = {...pr, pullRequestId: 922, title: 'Context second item',
      creationDate: new Date(Date.now() - 3600000).toISOString()};
    services.fetch = async () => ({me, prs: [pr, other, selected]});
    services.details = async (_config, value) => ({...value, description: 'Scroll context.\n'.repeat(50) + 'End of context.'});
    let saved = false;
    services.save = async () => { saved = true; };
    let opened = '';
    services.open = url => { opened = url; };
    const instance = render(<App initialConfig={config} startInSettings={false} services={services} columns={160} height={36} />);
    const key = async (input: string) => { instance.stdin.write(input); await settle(); };
    try {
      await waitForFrame(instance.lastFrame, pr.title);
      await key('4');
      await key('f');
      await key('j');
      await key('j');
      await key('\r');
      expect(instance.lastFrame()).toContain('f Repo: project/sample');
      await key('/');
      await key('context');
      await key('\r');
      await key('j');
      await key('\r');
      expect(opened).toContain('/922');
      await key('\t');
      await key('G');
      await waitForFrame(instance.lastFrame, 'End of context.');
      const scroll = instance.lastFrame()?.match(/\d+\/\d+ · Tab focus · j\/k scroll/)?.[0];
      expect(scroll).toBeDefined();
      await key('s');
      await waitForFrame(instance.lastFrame, 'organization');
      await settle();
      await key(save ? 's' : '\x1b');
      await waitForFrame(instance.lastFrame, 'All open · 2');
      expect(instance.lastFrame()).toContain('/ context');
      expect(instance.lastFrame()).toContain('f Repo: project/sample');
      await waitForFrame(instance.lastFrame, 'End of context.');
      expect(instance.lastFrame()).toContain(scroll!);
      await key('\r');
      expect(opened).toContain('/922');
      expect(saved).toBe(save);
    } finally {
      instance.unmount();
      instance.cleanup();
    }
  });
}

test('settings return preserves the compact inspector view', async () => {
  const {config, services} = setup();
  const instance = render(<App initialConfig={config} startInSettings={false} services={services} columns={80} height={24} />);
  try {
    await waitForFrame(instance.lastFrame, pr.title);
    instance.stdin.write('4');
    await settle();
    instance.stdin.write('p');
    await waitForFrame(instance.lastFrame, 'PR inspector');
    await settle();
    instance.stdin.write('s');
    await waitForFrame(instance.lastFrame, 'organization');
    await settle();
    instance.stdin.write('\x1b');
    await waitForFrame(instance.lastFrame, 'PR inspector');
    expect(instance.lastFrame()).not.toContain('Team queue ·');
    expect(instance.lastFrame()).toContain('p back');
  } finally {
    instance.unmount();
    instance.cleanup();
  }
});

test('switching organizations does not restore filters or selection from the previous connection', async () => {
  const {config, services} = setup();
  config.auth.mode = 'az-cli';
  services.validateSettings = async () => null;
  const instance = render(<App initialConfig={config} startInSettings={false} services={services} columns={150} height={32} />);
  const key = async (input: string) => { instance.stdin.write(input); await settle(); };
  try {
    await waitForFrame(instance.lastFrame, pr.title);
    await key('4');
    await key('/');
    await key('context');
    await key('\r');
    await key('s');
    await waitForFrame(instance.lastFrame, 'organization');
    await settle();
    await key('\r');
    await key('-new');
    await key('\r');
    await key('s');
    await waitForFrame(instance.lastFrame, 'example-new');
    await waitForFrame(instance.lastFrame, 'Team queue · 1');
    expect(instance.lastFrame()).toContain('/ Search PRs');
    expect(instance.lastFrame()).not.toContain('/ context');
  } finally {
    instance.unmount();
    instance.cleanup();
  }
});
