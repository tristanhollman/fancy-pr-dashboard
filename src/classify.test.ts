import {expect, test} from 'bun:test';
import type {AdoReviewer, Identity, TaggedPullRequest} from './api.ts';
import {classify, discoverReviewerGroups, flattenSections, isBotAuthor, nextSectionStart, sectionStarts, splitSections, staleness, VOTE} from './classify.ts';
import {defaultConfig, type Config} from './config.ts';

const NOW = Date.parse('2026-08-20T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const me: Identity = {id: 'me-guid', displayName: 'Me Myself', uniqueName: 'me@co.com'};
const alice = {id: 'alice-guid', displayName: 'Alice', uniqueName: 'alice@co.com'};
const bob = {id: 'bob-guid', displayName: 'Bob', uniqueName: 'bob@co.com'};
const outsider = {id: 'zed-guid', displayName: 'Zed', uniqueName: 'zed@other.com'};
const teamGroup = {id: 'group-guid', displayName: 'Platform Infra', descriptor: 'vssgp.abc'};

function reviewer(
  ref: {id: string; displayName?: string; uniqueName?: string; descriptor?: string},
  vote: number,
  isContainer = false,
): AdoReviewer {
  return {...ref, vote, isContainer};
}

function pr(overrides: Partial<TaggedPullRequest> = {}): TaggedPullRequest {
  return {
    pullRequestId: 100,
    title: 'Fix race condition in queue drain',
    creationDate: new Date(NOW - 2 * HOUR).toISOString(),
    createdBy: alice,
    repository: {name: 'ingest-worker'},
    reviewers: [],
    project: 'platform',
    ...overrides,
  };
}

function manualConfig(members = [me.uniqueName, alice.uniqueName, bob.uniqueName]): Config {
  const config = defaultConfig();
  config.org = 'myorg';
  config.projects = ['platform'];
  config.team = {mode: 'manual', groupDescriptor: null, groupDisplayName: null, members};
  config.ui.botAuthors = ['Build Bot'];
  return config;
}

function groupConfig(): Config {
  const config = defaultConfig();
  config.org = 'myorg';
  config.projects = ['platform'];
  config.team = {mode: 'group', groupDescriptor: 'vssgp.abc', groupDisplayName: 'Platform Infra', members: []};
  return config;
}

test('manual mode: roster hit marks a team reviewer and counts progress against the roster', () => {
  const row = classify(pr({reviewers: [reviewer(bob, VOTE.approved), reviewer(me, VOTE.noVote)]}), manualConfig(), me, NOW);

  expect(row.isTeamReviewer).toBe(true);
  expect(row.teamViaOthers).toBe(true);
  expect(row.teamProgress).toEqual({voted: 1, total: 3});
  expect(row.personal).toBe('none');
  expect(row.assignedToMe).toBe(true);
  expect(row.isMine).toBe(false);
});

test('manual mode: roster miss is not a team PR', () => {
  const row = classify(pr({reviewers: [reviewer(outsider, VOTE.noVote)]}), manualConfig(), me, NOW);
  expect(row.isTeamReviewer).toBe(false);
  expect(row.teamProgress).toEqual({voted: 0, total: 3});
  expect(row.assignedToMe).toBe(false);
});

test('manual mode: approved-with-suggestions counts as approved', () => {
  const row = classify(
    pr({reviewers: [reviewer(me, VOTE.approvedWithSuggestions), reviewer(bob, VOTE.approved)]}),
    manualConfig(),
    me,
    NOW,
  );
  expect(row.personal).toBe('approved');
  expect(row.teamProgress).toEqual({voted: 2, total: 3});
});

test('group mode: container alone is a team PR with zero individual progress', () => {
  const row = classify(pr({reviewers: [reviewer(teamGroup, VOTE.noVote, true)]}), groupConfig(), me, NOW);
  expect(row.isTeamReviewer).toBe(true);
  expect(row.teamViaOthers).toBe(true);
  expect(row.teamProgress).toEqual({voted: 0, total: 0});
});

test('group mode: individual entries beyond the container carry the progress', () => {
  const row = classify(
    pr({
      reviewers: [
        reviewer(teamGroup, VOTE.approved, true), // container vote is a no-op signal
        reviewer(alice, VOTE.approved),
        reviewer(bob, VOTE.approved),
        reviewer(me, VOTE.noVote),
      ],
    }),
    groupConfig(),
    me,
    NOW,
  );
  expect(row.teamProgress).toEqual({voted: 2, total: 3});
  expect(row.personal).toBe('none');
});

test('group mode: a container for a different group is not my team', () => {
  const other = {id: 'other-guid', displayName: 'Other Team', descriptor: 'vssgp.xyz'};
  const row = classify(pr({reviewers: [reviewer(other, VOTE.noVote, true)]}), groupConfig(), me, NOW);
  expect(row.isTeamReviewer).toBe(false);
});

test('waiting for author and rejected are distinct personal states', () => {
  const waiting = classify(pr({reviewers: [reviewer(me, VOTE.waitingForAuthor)]}), manualConfig(), me, NOW);
  const rejected = classify(pr({reviewers: [reviewer(me, VOTE.rejected)]}), manualConfig(), me, NOW);
  expect(waiting.personal).toBe('waiting');
  expect(rejected.personal).toBe('rejected');
});

test('identity falls back to uniqueName when the id differs', () => {
  const sameHumanDifferentId = {id: 'some-other-guid', displayName: 'Me', uniqueName: 'ME@CO.COM'};
  const row = classify(pr({reviewers: [reviewer(sameHumanDifferentId, VOTE.approved)]}), manualConfig(), me, NOW);
  expect(row.assignedToMe).toBe(true);
  expect(row.personal).toBe('approved');
});

test('no reviewers at all: nothing is claimed', () => {
  const row = classify(pr({reviewers: undefined}), manualConfig(), me, NOW);
  expect(row.isTeamReviewer).toBe(false);
  expect(row.assignedToMe).toBe(false);
  expect(row.reviewProgress).toEqual({voted: 0, total: 0});
});

test('web url falls back to a constructed link', () => {
  const row = classify(pr(), manualConfig(), me, NOW);
  expect(row.webUrl).toBe('https://dev.azure.com/myorg/platform/_git/ingest-worker/pullrequest/100');

  const linked = classify(pr({_links: {web: {href: 'https://example/pr/1'}}}), manualConfig(), me, NOW);
  expect(linked.webUrl).toBe('https://example/pr/1');
});

test('staleness thresholds: fresh under a day, stale past three', () => {
  expect(staleness(2 * HOUR)).toBe('fresh');
  expect(staleness(DAY)).toBe('normal');
  expect(staleness(3 * DAY)).toBe('normal');
  expect(staleness(4 * DAY)).toBe('stale');
});

test('sections split by relationship, and my own PRs stay out of the review lists', () => {
  const config = manualConfig();
  const prs = [
    pr({pullRequestId: 1, reviewers: [reviewer(bob, VOTE.noVote), reviewer(me, VOTE.noVote)]}),
    pr({pullRequestId: 2, createdBy: me, reviewers: [reviewer(bob, VOTE.approved)]}),
    pr({pullRequestId: 3, createdBy: outsider, reviewers: [reviewer(outsider, VOTE.noVote)]}),
  ];

  const {toReview, assignedToYou, createdByYou} = splitSections(prs, config, me, NOW);
  expect(toReview.map(r => r.id)).toEqual([1]);
  expect(assignedToYou.map(r => r.id)).toEqual([1]);
  expect(createdByYou.map(r => r.id)).toEqual([2]);
  expect(createdByYou[0]?.reviewProgress).toEqual({voted: 1, total: 1});
});

test('dedupe drops PRs whose only team signal is my own individual entry', () => {
  const onlyMe = pr({pullRequestId: 7, reviewers: [reviewer(me, VOTE.noVote)]});

  const deduped = splitSections([onlyMe], manualConfig(), me, NOW);
  expect(deduped.toReview).toHaveLength(0);
  expect(deduped.assignedToYou.map(r => r.id)).toEqual([7]);

  const config = manualConfig();
  config.ui.dedupeAssignedFromTeamSection = false;
  const kept = splitSections([onlyMe], config, me, NOW);
  expect(kept.toReview.map(r => r.id)).toEqual([7]);
});

test('rows sort newest first with already-approved last', () => {
  const config = manualConfig();
  const prs = [
    pr({pullRequestId: 1, creationDate: new Date(NOW - 4 * DAY).toISOString(), reviewers: [reviewer(bob, VOTE.noVote)]}),
    pr({pullRequestId: 2, creationDate: new Date(NOW - 2 * HOUR).toISOString(), reviewers: [reviewer(bob, VOTE.noVote)]}),
    pr({
      pullRequestId: 3,
      creationDate: new Date(NOW - 3 * HOUR).toISOString(),
      reviewers: [reviewer(bob, VOTE.noVote), reviewer(me, VOTE.approved)],
    }),
  ];

  expect(splitSections(prs, config, me, NOW).toReview.map(r => r.id)).toEqual([2, 1, 3]);
});

test('drafts and bot PRs are filtered out of every section, and counted', () => {
  const config = manualConfig();
  const bot = {id: 'bot-guid', displayName: 'Build Bot', uniqueName: 'automation@co.com'};
  const prs = [
    pr({pullRequestId: 1, reviewers: [reviewer(bob, VOTE.noVote)]}),
    pr({pullRequestId: 2, isDraft: true, reviewers: [reviewer(bob, VOTE.noVote)]}),
    pr({pullRequestId: 3, createdBy: bot, reviewers: [reviewer(bob, VOTE.noVote)]}),
    pr({pullRequestId: 4, createdBy: me, isDraft: true}), // my own draft goes too
  ];

  const hidden = splitSections(prs, config, me, NOW);
  expect(hidden.toReview.map(r => r.id)).toEqual([1]);
  expect(hidden.createdByYou).toHaveLength(0);
  expect(hidden.filtered).toEqual({drafts: 2, bots: 1, reviewed: 0});

  config.ui.hideDrafts = false;
  config.ui.hideBots = false;
  const shown = splitSections(prs, config, me, NOW);
  expect(shown.toReview.map(r => r.id)).toEqual([1, 2, 3]);
  expect(shown.createdByYou.map(r => r.id)).toEqual([4]);
  expect(shown.filtered).toEqual({drafts: 0, bots: 0, reviewed: 0});
});

test('a bot draft is counted once, as a draft', () => {
  const config = manualConfig();
  const bot = {id: 'bot-guid', displayName: 'Build Bot'};
  const sections = splitSections([pr({pullRequestId: 1, createdBy: bot, isDraft: true})], config, me, NOW);
  expect(sections.filtered).toEqual({drafts: 1, bots: 0, reviewed: 0});
});

test('bot matching is a case-insensitive substring and tolerates a pasted @mention', () => {
  expect(isBotAuthor({id: 'x', displayName: 'Build Bot (CI)'}, ['build bot'])).toBe(true);
  expect(isBotAuthor({id: 'x', displayName: 'Build Bot'}, ['@Build Bot'])).toBe(true);
  expect(isBotAuthor({id: 'x', displayName: 'Bob', uniqueName: 'renovate@bots.co'}, ['renovate'])).toBe(true);
  expect(isBotAuthor({id: 'x', displayName: 'Bob', uniqueName: 'bob@co.com'}, ['renovate'])).toBe(false);
  expect(isBotAuthor({id: 'x', displayName: 'Bob'}, [''])).toBe(false); // an empty needle matches nothing
});

test('rows carry the draft and bot flags for the UI', () => {
  const bot = {id: 'bot-guid', displayName: 'Build Bot'};
  const row = classify(pr({createdBy: bot, isDraft: true}), manualConfig(), me, NOW);
  expect(row.isDraft).toBe(true);
  expect(row.isBot).toBe(true);
});

test('reviewer groups are discovered from container entries, most used first', () => {
  const otherGroup = {id: 'other-guid', displayName: 'Other Team', descriptor: 'vssgp.xyz'};
  const groups = discoverReviewerGroups([
    pr({pullRequestId: 1, reviewers: [reviewer(teamGroup, VOTE.noVote, true), reviewer(alice, VOTE.approved)]}),
    pr({pullRequestId: 2, reviewers: [reviewer(teamGroup, VOTE.noVote, true)]}),
    pr({pullRequestId: 3, reviewers: [reviewer(otherGroup, VOTE.noVote, true)]}),
    pr({pullRequestId: 4, reviewers: [reviewer(bob, VOTE.noVote)]}), // individuals are not groups
  ]);

  expect(groups).toEqual([
    {descriptor: 'vssgp.abc', displayName: 'Platform Infra', prCount: 2},
    {descriptor: 'vssgp.xyz', displayName: 'Other Team', prCount: 1},
  ]);
});

test('a container without a descriptor falls back to its id', () => {
  const noDescriptor = {id: 'group-guid-only', displayName: 'Legacy Group'};
  const groups = discoverReviewerGroups([pr({reviewers: [reviewer(noDescriptor, VOTE.noVote, true)]})]);
  expect(groups[0]?.descriptor).toBe('group-guid-only');
});

test('hide-reviewed removes rows I approved and reports the count', () => {
  const config = manualConfig();
  const prs = [
    pr({pullRequestId: 1, reviewers: [reviewer(bob, VOTE.noVote), reviewer(me, VOTE.noVote)]}),
    pr({pullRequestId: 2, reviewers: [reviewer(bob, VOTE.noVote), reviewer(me, VOTE.approved)]}),
  ];

  const shown = splitSections(prs, config, me, NOW);
  expect(shown.toReview.map(r => r.id)).toEqual([1, 2]);
  expect(shown.filtered.reviewed).toBe(0);

  config.ui.hideReviewed = true;
  const hidden = splitSections(prs, config, me, NOW);
  expect(hidden.toReview.map(r => r.id)).toEqual([1]);
  expect(hidden.filtered.reviewed).toBe(1);
});

test('flattening and section starts drive the row cursor', () => {
  const config = manualConfig();
  const bot = {id: 'bot-guid', displayName: 'Build Bot'};
  const sections = splitSections(
    [
      pr({pullRequestId: 1, reviewers: [reviewer(bob, VOTE.noVote)]}),
      pr({pullRequestId: 2, reviewers: [reviewer(bob, VOTE.noVote), reviewer(me, VOTE.noVote)]}),
      pr({pullRequestId: 3, createdBy: me}),
      pr({pullRequestId: 4, createdBy: bot}), // filtered out, so never reachable by the cursor
    ],
    config,
    me,
    NOW,
  );

  // toReview [1, 2] → assignedToYou [2] → createdByYou [3]
  expect(flattenSections(sections).map(r => r.id)).toEqual([1, 2, 2, 3]);

  const starts = sectionStarts(sections);
  expect(starts).toEqual([0, 2, 3]);
  expect(nextSectionStart(starts, 0)).toBe(2);
  expect(nextSectionStart(starts, 2)).toBe(3);
  expect(nextSectionStart(starts, 3)).toBe(0); // wraps
});

test('section starts skip empty sections', () => {
  const config = manualConfig();
  const sections = splitSections([pr({pullRequestId: 1, createdBy: me})], config, me, NOW);
  expect(sectionStarts(sections)).toEqual([0]);
  expect(nextSectionStart(sectionStarts(sections), 0)).toBe(0);
});

test('rows preserve descriptions, branch labels, stable identity and explicit reviewer requirements', () => {
  const row = classify(pr({
    description: '# Motivation\nKeep this text intact.',
    sourceRefName: 'refs/heads/feature/improve-search',
    targetRefName: 'refs/heads/main',
    repository: {id: 'repo-guid', name: 'repo', project: {id: 'project-guid', name: 'platform'}},
    reviewers: [
      {...reviewer(teamGroup, VOTE.approved, true), isRequired: true},
      reviewer(bob, VOTE.approvedWithSuggestions),
    ],
  }), manualConfig(), me, NOW);
  expect(row.description).toBe('# Motivation\nKeep this text intact.');
  expect(row.sourceBranch).toBe('feature/improve-search');
  expect(row.targetBranch).toBe('main');
  expect(row.repoId).toBe('repo-guid');
  expect(row.projectId).toBe('project-guid');
  expect(row.reviewers).toEqual([
    {displayName: 'Platform Infra', uniqueName: '', vote: 10, isContainer: true, isRequired: true},
    {displayName: 'Bob', uniqueName: 'bob@co.com', vote: 5, isContainer: false, isRequired: false},
  ]);
});

test('missing workspace metadata becomes empty strings without changing legacy section semantics', () => {
  const sections = splitSections([pr({reviewers: [reviewer(bob, 0), reviewer(me, 0)]})], manualConfig(), me, NOW);
  const row = sections.toReview[0]!;
  expect(sections.assignedToYou[0]).toBe(row);
  expect([row.description, row.sourceBranch, row.targetBranch, row.repoId, row.projectId]).toEqual(['', '', '', '', '']);
  expect(row.reviewProgress).toEqual({voted: 0, total: 2});
  expect(sections.filtered).toEqual({drafts: 0, bots: 0, reviewed: 0});
});
