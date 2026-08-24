import React from 'react';
import {expect, test} from 'bun:test';
import {render} from 'ink-testing-library';
import Dashboard, {formatAge, scrollOffset} from './Dashboard.tsx';
import {splitSections, VOTE} from './classify.ts';
import {defaultConfig, type Config} from './config.ts';
import type {Identity, TaggedPullRequest} from './api.ts';

const NOW = Date.parse('2026-08-20T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const ESCAPES = new RegExp(`${String.fromCharCode(27)}\\]8;;[^${String.fromCharCode(7)}]*${String.fromCharCode(7)}`, 'g');

const me: Identity = {id: 'me-guid', displayName: 'Me', uniqueName: 'me@co.com'};
const bob = {id: 'bob-guid', displayName: 'Bob', uniqueName: 'bob@co.com'};

function config(): Config {
  const c = defaultConfig();
  c.org = 'myorg';
  c.projects = ['platform'];
  c.team.members = ['me@co.com', 'bob@co.com', 'zoe@co.com'];
  c.ui.botAuthors = ['Build Bot'];
  return c;
}

function pr(id: number, overrides: Partial<TaggedPullRequest> = {}): TaggedPullRequest {
  return {
    pullRequestId: id,
    title: 'Fix race condition in queue drain',
    creationDate: new Date(NOW - 2 * HOUR).toISOString(),
    createdBy: bob,
    repository: {name: 'ingest-worker'},
    reviewers: [
      {...bob, vote: VOTE.approved},
      {...me, vote: VOTE.noVote},
    ],
    project: 'platform',
    ...overrides,
  };
}

function frameFor(columns: number, cfg = config(), prs = [pr(482)], options: {rows?: number; selected?: number} = {}): string {
  const sections = splitSections(prs, cfg, me, NOW);
  const {lastFrame, unmount} = render(
    <Dashboard
      config={cfg}
      sections={sections}
      refreshedAt={NOW - 14_000}
      now={NOW}
      columns={columns}
      rows={options.rows ?? 40}
      selected={options.selected ?? 0}
    />,
  );
  const frame = lastFrame() ?? '';
  unmount();
  return frame;
}

/** Hyperlink targets contain repo names and ids; strip them before asserting on text. */
function plain(frame: string): string {
  return frame.replace(ESCAPES, '');
}

test('wide render shows every column', () => {
  const frame = frameFor(120);
  expect(frame).toContain('myorg/platform');
  expect(frame).toContain('refreshed 14s ago');
  expect(frame).toContain('TO REVIEW');
  expect(frame).toContain('!482');
  expect(frame).toContain('ingest-worker');
  expect(frame).toContain('@Bob');
  expect(frame).toContain('○ you');
  expect(frame).toContain('1/3 team');
  // A team member plus me as reviewers: the PR belongs to both review sections.
  expect(frame).toContain('ASSIGNED TO YOU  1 open');
  expect(frame).toContain('you have no open pull requests');
});

test('narrow render drops author, pills and repo tag', () => {
  const frame = plain(frameFor(60));
  expect(frame).toContain('!482');
  expect(frame).toContain('Fix race');
  expect(frame).not.toContain('@Bob');
  expect(frame).not.toContain('○ you');
  expect(frame).not.toContain('ingest-worker');
});

test('hide reviewed removes approved rows and reports the count', () => {
  const cfg = config();
  cfg.ui.hideReviewed = true;
  const prs = [pr(1), pr(2, {reviewers: [{...bob, vote: VOTE.noVote}, {...me, vote: VOTE.approved}]})];

  const frame = plain(frameFor(120, cfg, prs));
  expect(frame).toContain('1 reviewed hidden');
  expect(frame).toContain('!1');
  expect(frame).not.toContain('!2');
});

test('my own PRs show review progress instead of my vote', () => {
  const mine = pr(500, {createdBy: me, reviewers: [{...bob, vote: VOTE.waitingForAuthor}]});
  const frame = frameFor(120, config(), [mine]);
  expect(frame).toContain('CREATED BY YOU');
  expect(frame).toContain('waiting on author');
});

test('the PR id is an OSC 8 hyperlink to the PR', () => {
  const frame = frameFor(120);
  expect(frame).toContain(']8;;https://dev.azure.com/myorg/platform/_git/ingest-worker/pullrequest/482');
  expect(frame).toContain('!482');
});

test('an unconfigured team says so instead of claiming nothing is waiting', () => {
  const cfg = config();
  cfg.team.members = [];
  const frame = frameFor(120, cfg, [pr(1)]);
  expect(frame).toContain('no team configured');
});

test('hidden drafts and bots are reported, not silently swallowed', () => {
  const bot = {id: 'bot-guid', displayName: 'Build Bot'};
  const prs = [pr(1), pr(2, {isDraft: true}), pr(3, {createdBy: bot})];

  const frame = plain(frameFor(120, config(), prs));
  expect(frame).toContain('1 draft + 1 bot hidden');
  expect(frame).toContain('!1');
  expect(frame).not.toContain('!2');
  expect(frame).not.toContain('!3');
});

test('showing drafts marks them and drops the hidden note', () => {
  const cfg = config();
  cfg.ui.hideDrafts = false;
  const frame = plain(frameFor(120, cfg, [pr(2, {isDraft: true})]));
  expect(frame).toContain('draft');
  expect(frame).not.toContain('draft hidden');
  expect(frame).toContain('!2');
});

test('the footer states where each filter currently stands', () => {
  const cfg = config();
  cfg.ui.hideBots = false;
  const frame = frameFor(120, cfg, [pr(1)]);
  expect(frame).toContain('h reviewed shown');
  expect(frame).toContain('d drafts hidden');
  expect(frame).toContain('b bots shown');
});

test('the frame fills the terminal height even with a single PR', () => {
  const frame = frameFor(120, config(), [pr(1)], {rows: 20});
  expect(frame.split('\n')).toHaveLength(20);
});

test('the frame fills the height when there is nothing at all', () => {
  const cfg = config();
  const frame = frameFor(120, cfg, [], {rows: 15});
  expect(frame.split('\n')).toHaveLength(15);
  expect(frame).toContain('nothing waiting on the team');
});

test('the list scrolls inside a fixed frame, chrome stays put', () => {
  const many = Array.from({length: 40}, (_, i) => pr(100 + i));
  const height = 12;

  const top = plain(frameFor(120, config(), many, {rows: height, selected: 0}));
  expect(top.split('\n')).toHaveLength(height);
  expect(top).toContain('TO REVIEW'); // header visible at the top of the list
  expect(top).toContain('!100');
  expect(top).not.toContain('!139'); // the far end is out of view
  expect(top).toContain('more'); // "↓ N more" scroll counter

  const bottom = plain(frameFor(120, config(), many, {rows: height, selected: 39}));
  expect(bottom.split('\n')).toHaveLength(height);
  expect(bottom).toContain('!139'); // the viewport followed the cursor
  expect(bottom).not.toContain('!100');

  // The chrome is present in both frames — that is the sticky part.
  for (const frame of [top, bottom]) {
    expect(frame).toContain('myorg/platform');
    expect(frame).toContain('j/k move');
  }
});

test('the cursor marks the selected row', () => {
  const many = [pr(1), pr(2), pr(3)];
  const frame = plain(frameFor(120, config(), many, {selected: 1}));
  const line = frame.split('\n').find(l => l.includes('!2')) ?? '';
  expect(line.trimStart().startsWith('›')).toBe(true);

  const other = frame.split('\n').find(l => l.includes('!1')) ?? '';
  expect(other.trimStart().startsWith('›')).toBe(false);
});

test('the changed-files column shows a placeholder until the count arrives', () => {
  const sections = splitSections([pr(482)], config(), me, NOW);
  const withoutCounts = render(
    <Dashboard config={config()} sections={sections} refreshedAt={NOW} now={NOW} columns={140} rows={20} selected={0} />,
  );
  expect(withoutCounts.lastFrame()).toContain('·');
  expect(withoutCounts.lastFrame()).not.toContain('12f');
  withoutCounts.unmount();

  const withCounts = render(
    <Dashboard
      config={config()}
      sections={sections}
      refreshedAt={NOW}
      now={NOW}
      columns={140}
      rows={20}
      selected={0}
      fileCounts={{482: {files: 12, truncated: false}}}
    />,
  );
  expect(withCounts.lastFrame()).toContain('12f');
  withCounts.unmount();
});

test('a truncated count is marked, and narrow mode drops the column', () => {
  const sections = splitSections([pr(482)], config(), me, NOW);
  const counts = {482: {files: 1000, truncated: true}};

  const wide = render(
    <Dashboard config={config()} sections={sections} refreshedAt={NOW} now={NOW} columns={140} rows={20} selected={0} fileCounts={counts} />,
  );
  expect(wide.lastFrame()).toContain('999+f'); // capped so the cell can never wrap
  wide.unmount();

  const narrow = render(
    <Dashboard config={config()} sections={sections} refreshedAt={NOW} now={NOW} columns={60} rows={20} selected={0} fileCounts={counts} />,
  );
  expect(narrow.lastFrame()).not.toContain('999+f');
  narrow.unmount();
});

test('scroll offset moves only when the cursor would leave the window', () => {
  // 50 items, a 10-line window.
  expect(scrollOffset(0, 5, 50, 10)).toBe(0); // inside: no movement
  expect(scrollOffset(0, 9, 50, 10)).toBe(0); // last visible line
  expect(scrollOffset(0, 10, 50, 10)).toBe(1); // one past: scroll by one
  expect(scrollOffset(20, 15, 50, 10)).toBe(15); // moving up pulls the window up
  expect(scrollOffset(45, 49, 50, 10)).toBe(40); // clamped to the end of the list
  expect(scrollOffset(30, 0, 5, 10)).toBe(0); // list shorter than the window
  expect(scrollOffset(4, -1, 50, 10)).toBe(4); // no selection: leave it alone
});

test('age formatting', () => {
  expect(formatAge(14_000)).toBe('14s');
  expect(formatAge(90_000)).toBe('1m');
  expect(formatAge(2 * HOUR)).toBe('2h');
  expect(formatAge(30 * HOUR)).toBe('1d');
});
