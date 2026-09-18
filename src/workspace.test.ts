import {expect, test} from 'bun:test';
import {defaultConfig} from './config.ts';
import {classify} from './classify.ts';
import {clip, keepRowVisible, queueLines, repositoryKey, rowAction, rowKey, rowMetadata, terminalText, visibleInAnyScope, workspaceLayout, workspaceRows, wrapText} from './workspace.ts';
import type {TaggedPullRequest} from './api.ts';
import type {ReviewRequirements} from './reviews.ts';

const me = {id: 'me', displayName: 'Me', uniqueName: 'me@example.test'};
const cfg = () => {
  const config = defaultConfig();
  config.team.members = ['peer@example.test'];
  return config;
};
function row(id: number, repo = 'service-a', hours = 1, vote = 0) {
  const pr: TaggedPullRequest = {
    pullRequestId: id, title: `Request ${id}`, creationDate: new Date(1_000_000_000 - hours * 3600000).toISOString(),
    project: 'project', repository: {name: repo}, createdBy: {id: 'author'},
    reviewers: [{id: 'peer', uniqueName: 'peer@example.test', vote: 0}, {...me, vote}],
  };
  return classify(pr, cfg(), me, 1_000_000_000);
}
const complete: ReviewRequirements = {status: 'complete', minimum: {approved: 2, required: 2}, requiredReviewers: {approved: 0, total: 0}, notes: []};

test('flat ordering is global and grouped ordering is per repository', () => {
  const config = cfg();
  const data = [row(1, 'a', 5), row(2, 'b', 2), row(3, 'a', 1)];
  config.ui.workspace.groupByRepo = false;
  expect(workspaceRows(data, config, {}, 'all').rows.map(row => row.id)).toEqual([3, 2, 1]);
  config.ui.workspace.sort = 'oldest';
  expect(workspaceRows(data, config, {}, 'all').rows.map(row => row.id)).toEqual([1, 2, 3]);
  config.ui.workspace.groupByRepo = true;
  expect(workspaceRows(data, config, {}, 'all').rows.map(row => row.id)).toEqual([1, 3, 2]);
});

test('TODO filtering is scoped, independent and never hides unknown or no requirements', () => {
  const config = cfg();
  const data = [row(1), row(2), row(3, 'a', 1, -5), row(4, 'a', 1, -10), row(5, 'a', 1, 10)];
  const requirements = {[rowKey(data[1]!)]: complete, [rowKey(data[4]!)]: complete};
  const queue = workspaceRows(data, config, requirements, 'team');
  expect(queue.rows.map(row => row.id)).toEqual([1]);
  expect(queue.hidden).toEqual({drafts: 0, bots: 0, reviewed: 3, complete: 1});
  expect(workspaceRows(data, config, requirements, 'assigned').rows).toHaveLength(5);
  expect(workspaceRows(data, config, requirements, 'all').rows).toHaveLength(5);
  config.ui.workspace.hideReviewed = false;
  expect(workspaceRows(data, config, requirements, 'team').rows).toHaveLength(3);
  config.ui.workspace.hideComplete = false;
  expect(workspaceRows(data, config, requirements, 'team').rows).toHaveLength(5);
});

test('identity includes project and repo; filtering preserves matching identity', () => {
  const a = row(1, 'a');
  const b = row(1, 'b');
  expect(rowKey(a)).not.toBe(rowKey(b));
  expect(workspaceRows([a, b], cfg(), {}, 'all', repositoryKey(b), 'request').rows).toEqual([b]);
});

test('My PRs uses separate filters and totals while queue and All keep shared settings', () => {
  const config = cfg();
  const active = row(1);
  const otherDraft = {...row(2), isDraft: true};
  const mine = {...row(3), isMine: true};
  const myDraft = {...row(4), isMine: true, isDraft: true};
  const myBot = {...row(5), isMine: true, isBot: true};
  const data = [active, otherDraft, mine, myDraft, myBot];
  const own = workspaceRows(data, config, {}, 'mine');
  expect(own.rows.map(row => row.id)).toEqual([3, 4]);
  expect(own.counts).toEqual({team: 1, assigned: 1, mine: 2, all: 2});
  expect(own.hidden).toEqual({drafts: 0, bots: 1, reviewed: 0, complete: 0});
  expect(workspaceRows(data, config, {}, 'all').rows.map(row => row.id)).toEqual([1, 3]);
  expect(workspaceRows(data, config, {}, 'team').hidden.drafts).toBe(1);
  config.ui.workspace.hideMyDrafts = true;
  config.ui.workspace.hideMyBots = false;
  expect(workspaceRows(data, config, {}, 'mine').rows.map(row => row.id)).toEqual([3, 5]);
  expect(workspaceRows(data, config, {}, 'all').rows.map(row => row.id)).toEqual([1, 3]);
  config.ui.hideDrafts = false;
  expect(workspaceRows(data, config, {}, 'all').rows.map(row => row.id)).toEqual([1, 2, 3, 4]);
  expect(workspaceRows(data, config, {}, 'mine').rows.map(row => row.id)).toEqual([3, 5]);
});

test('metadata eligibility includes own drafts visible only in My PRs', () => {
  const config = cfg();
  const draft = {...row(1), isDraft: true};
  expect(visibleInAnyScope(draft, config)).toBe(false);
  expect(visibleInAnyScope({...draft, isMine: true}, config)).toBe(true);
  config.ui.workspace.hideMyDrafts = true;
  expect(visibleInAnyScope({...draft, isMine: true}, config)).toBe(false);
  config.ui.hideDrafts = false;
  expect(visibleInAnyScope({...draft, isMine: true}, config)).toBe(true);
});

test('pane layout reserves minimum widths and sidebar space goes to details', () => {
  const preferences = cfg().ui.workspace;
  const shown = workspaceLayout(180, 40, preferences);
  const hidden = workspaceLayout(180, 40, {...preferences, showRepositories: false});
  expect(hidden.queueWidth).toBe(shown.queueWidth);
  expect(hidden.detailWidth - shown.detailWidth).toBe(shown.repoWidth + 1);
  for (const width of [96, 120, 132, 180]) {
    for (const listShare of [0.1, 0.9]) {
      const layout = workspaceLayout(width, 30, {...preferences, listShare});
      expect(layout.queueWidth).toBeGreaterThanOrEqual(40);
      expect(layout.detailWidth).toBeGreaterThanOrEqual(36);
    }
  }
  expect(workspaceLayout(80, 24, preferences).compact).toBe(true);
  expect(workspaceLayout(180, 12, preferences).compact).toBe(true);
  expect(workspaceLayout(80, 24, preferences, true).detailWidth).toBe(80);
});

test('queue viewport keeps complete selected rows visible', () => {
  const data = [row(1), row(2), row(3)];
  const lines = queueLines(data, false);
  expect(lines).toHaveLength(11);
  expect(keepRowVisible(0, rowKey(data[2]!), lines, 4)).toBe(7);
  expect(keepRowVisible(7, rowKey(data[0]!), lines, 4)).toBe(0);
  expect(keepRowVisible(0, rowKey(data[2]!), lines, 3)).toBe(8);
});

test('PRs have exactly one spacer between entries, including repository boundaries', () => {
  const data = [row(1, 'a'), row(2, 'a'), row(3, 'b')];
  expect(queueLines(data, true).map(line => line.kind)).toEqual([
    'repo', 'title', 'meta', 'spacer', 'title', 'meta', 'spacer', 'repo', 'title', 'meta',
  ]);
  expect(queueLines(data, false).map(line => line.kind)).toEqual([
    'title', 'repository', 'meta', 'spacer', 'title', 'repository', 'meta', 'spacer', 'title', 'repository', 'meta',
  ]);
  expect(queueLines([], false)).toEqual([]);
  expect(queueLines([data[0]!], true).some(line => line.kind === 'spacer')).toBe(false);
});

test('terminal text removes terminal commands, controls and direction overrides', () => {
  expect(terminalText('safe\x1b[2Jtext\x1b]0;title\x07!\u202eevil')).toBe('safetext!evil');
  expect(terminalText('a\nb\tc', true)).toBe('a\nb    c');
  expect(clip('ab界cd', 4)).toBe('ab界');
  expect(wrapText('one two three\n\n界界', 5)).toEqual(['one', 'two', 'three', '', '界界']);
  expect(wrapText('abcdefgh', 3)).toEqual(['abc', 'def', 'gh']);
});

test('row metadata identifies authors instead of repeating the team queue context', () => {
  const value = {...row(1), author: 'Ari Example', assignedToMe: false};
  expect(rowAction(value)).toBe('');
  expect(rowMetadata(value, '2d', {files: 6, truncated: false}, 70)).toBe('  !1 2d @Ari Example · 6f');
  expect(rowMetadata({...value, isMine: true}, '2d', undefined, 70)).toContain('@you');
  expect(rowMetadata({...value, author: ''}, '2d', undefined, 70)).toContain('@(unknown)');
  expect(rowMetadata({...value, personal: 'approved'}, '2d', undefined, 70)).toContain('You approved');
  expect(rowMetadata({...value, personal: 'waiting'}, '2d', undefined, 70)).toContain('Author turn');
  expect(rowMetadata({...value, personal: 'rejected'}, '2d', undefined, 70)).toContain('You requested changes');
});

test('long and non-ASCII author names remain identifiable without overflowing narrow rows', () => {
  const value = {...row(123456), author: 'Long reviewer name with several words', personal: 'rejected' as const};
  const text = rowMetadata(value, '10d', {files: 12, truncated: true}, 36);
  expect(text).toContain('@Long');
  expect(text).toContain('…');
  expect(Bun.stringWidth(text)).toBeLessThanOrEqual(36);
  const wide = rowMetadata({...value, author: '界界界界界界\x1b[2J', assignedToMe: false}, '1h', undefined, 36);
  expect(wide).toContain('@界');
  expect(wide).not.toContain('\x1b');
  expect(Bun.stringWidth(wide)).toBeLessThanOrEqual(36);
});
