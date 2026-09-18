import {pullRequestWebUrl, type AdoIdentityRef, type AdoReviewer, type Identity, type TaggedPullRequest} from './api.ts';
import type {Config} from './config.ts';

/** Azure DevOps vote values. */
export const VOTE = {
  approved: 10,
  approvedWithSuggestions: 5,
  noVote: 0,
  waitingForAuthor: -5,
  rejected: -10,
} as const;

const APPROVED_THRESHOLD = VOTE.approvedWithSuggestions;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PersonalState = 'none' | 'approved' | 'waiting' | 'rejected';
export type Staleness = 'fresh' | 'normal' | 'stale';

export interface Progress {
  voted: number;
  total: number;
}

export interface Row {
  id: number;
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  repo: string;
  repoId: string;
  project: string;
  projectId: string;
  author: string;
  webUrl: string;
  ageMs: number;
  staleness: Staleness;
  isMine: boolean;
  isDraft: boolean;
  /** The author matches one of the configured bot names (Renovate and friends). */
  isBot: boolean;
  /** An individual reviewer entry exists for me. */
  assignedToMe: boolean;
  /** My own vote state on this PR. */
  personal: PersonalState;
  /** The team (group container, or a configured member) is a reviewer. */
  isTeamReviewer: boolean;
  /** The team relationship exists for reasons other than my own individual entry. */
  teamViaOthers: boolean;
  /** Team review progress, counted per the configured team mode. */
  teamProgress: Progress;
  /** Progress over every individual reviewer, regardless of team membership. */
  reviewProgress: Progress;
  /** How many reviewers voted "waiting for author" — drives the pill on my own PRs. */
  waitingReviewers: number;
  /**
   * The reviewer entries as Azure DevOps returned them, minus the fields nothing reads.
   * Kept so the JSON output can answer "why is this PR not in To Review?" — the exact
   * `uniqueName` strings are what a manual roster has to match.
   */
  reviewers: ReviewerSummary[];
}

export interface ReviewerSummary {
  displayName: string;
  uniqueName: string;
  vote: number;
  isContainer: boolean;
  isRequired: boolean;
}

export interface Sections {
  toReview: Row[];
  assignedToYou: Row[];
  createdByYou: Row[];
  /** What the filters removed, so the UI can admit rows are missing. */
  filtered: {drafts: number; bots: number; reviewed: number};
}

function lower(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Identity match on id, falling back to uniqueName — see the plan's Risks note. */
export function isMe(ref: AdoIdentityRef, me: Identity): boolean {
  if (ref.id && me.id && ref.id === me.id) return true;
  const a = lower(ref.uniqueName);
  return a.length > 0 && a === lower(me.uniqueName);
}

function isConfiguredMember(ref: AdoIdentityRef, members: string[]): boolean {
  const unique = lower(ref.uniqueName);
  const display = lower(ref.displayName);
  return members.some(member => {
    const m = lower(member);
    return m.length > 0 && (m === unique || m === display);
  });
}

/**
 * Substring match, not equality: bot display names drift ("Build Bot" vs
 * "Build Bot (CI)"), and a needle short enough to be typed should still hit.
 * A leading `@` is stripped so a pasted mention works.
 */
export function isBotAuthor(author: AdoIdentityRef, botAuthors: string[]): boolean {
  const display = lower(author.displayName);
  const unique = lower(author.uniqueName);
  return botAuthors.some(entry => {
    const needle = lower(entry).replace(/^@/, '');
    if (needle.length === 0) return false;
    return display.includes(needle) || unique.includes(needle);
  });
}

function isTeamContainer(reviewer: AdoReviewer, config: Config): boolean {
  if (!reviewer.isContainer) return false;
  const descriptor = config.team.groupDescriptor;
  // No descriptor configured yet: any container reviewer counts as "the team".
  if (!descriptor) return true;
  return reviewer.descriptor === descriptor || reviewer.id === descriptor;
}

function hasApproved(reviewer: AdoReviewer): boolean {
  return reviewer.vote >= APPROVED_THRESHOLD;
}

function personalState(mine: AdoReviewer | undefined): PersonalState {
  if (!mine) return 'none';
  if (hasApproved(mine)) return 'approved';
  if (mine.vote === VOTE.rejected) return 'rejected';
  if (mine.vote === VOTE.waitingForAuthor) return 'waiting';
  return 'none';
}

export function staleness(ageMs: number): Staleness {
  if (ageMs < DAY_MS) return 'fresh';
  if (ageMs <= 3 * DAY_MS) return 'normal';
  return 'stale';
}

export function classify(pr: TaggedPullRequest, config: Config, me: Identity, now = Date.now()): Row {
  const reviewers = pr.reviewers ?? [];
  const individuals = reviewers.filter(r => !r.isContainer);
  const mine = individuals.find(r => isMe(r, me));
  const containerIsTeam = reviewers.some(r => isTeamContainer(r, config));

  const groupMode = config.team.mode === 'group';
  const memberEntries = groupMode ? individuals : individuals.filter(r => isConfiguredMember(r, config.team.members));

  const isTeamReviewer = groupMode ? containerIsTeam : memberEntries.length > 0;
  const teamViaOthers = groupMode ? containerIsTeam : memberEntries.some(r => !isMe(r, me));

  const teamProgress: Progress = groupMode
    ? {voted: individuals.filter(hasApproved).length, total: individuals.length}
    : {voted: memberEntries.filter(hasApproved).length, total: config.team.members.length};

  const ageMs = Math.max(0, now - Date.parse(pr.creationDate));

  return {
    id: pr.pullRequestId,
    title: pr.title,
    description: pr.description ?? '',
    sourceBranch: pr.sourceRefName?.replace(/^refs\/heads\//, '') ?? '',
    targetBranch: pr.targetRefName?.replace(/^refs\/heads\//, '') ?? '',
    repo: pr.repository.name,
    repoId: pr.repository.id ?? '',
    project: pr.project,
    projectId: pr.repository.project?.id ?? '',
    author: pr.createdBy.displayName || pr.createdBy.uniqueName || '',
    webUrl: pullRequestWebUrl(config.org, pr),
    ageMs,
    staleness: staleness(ageMs),
    isMine: isMe(pr.createdBy, me),
    isDraft: pr.isDraft ?? false,
    isBot: isBotAuthor(pr.createdBy, config.ui.botAuthors),
    assignedToMe: mine !== undefined,
    personal: personalState(mine),
    isTeamReviewer,
    teamViaOthers,
    teamProgress,
    reviewProgress: {voted: individuals.filter(hasApproved).length, total: individuals.length},
    waitingReviewers: individuals.filter(r => r.vote === VOTE.waitingForAuthor).length,
    reviewers: reviewers.map(r => ({
      displayName: r.displayName ?? '',
      uniqueName: r.uniqueName ?? '',
      vote: r.vote,
      isContainer: r.isContainer ?? false,
      isRequired: r.isRequired ?? false,
    })),
  };
}

function rank(row: Row): number {
  return row.personal === 'approved' ? 1 : 0;
}

export function splitSections(prs: TaggedPullRequest[], config: Config, me: Identity, now = Date.now()): Sections {
  // Mockup order: rows still wanting my vote first (newest first), already-approved last.
  const all = prs
    .map(pr => classify(pr, config, me, now))
    .sort((a, b) => rank(a) - rank(b) || a.ageMs - b.ageMs);

  // Every filter applies to every section, including my own drafts — one rule, no surprises.
  // Counted in priority order so a bot's draft is reported once, as a draft.
  const {ui} = config;
  const drafts = ui.hideDrafts ? all.filter(row => row.isDraft).length : 0;
  const bots = ui.hideBots ? all.filter(row => row.isBot && !(ui.hideDrafts && row.isDraft)).length : 0;
  const hiddenByFilter = (row: Row) => (ui.hideDrafts && row.isDraft) || (ui.hideBots && row.isBot);
  const reviewed = ui.hideReviewed ? all.filter(row => !hiddenByFilter(row) && row.personal === 'approved').length : 0;

  const rows = all.filter(row => !hiddenByFilter(row) && !(ui.hideReviewed && row.personal === 'approved'));
  const dedupe = ui.dedupeAssignedFromTeamSection;

  return {
    toReview: rows.filter(row => row.isTeamReviewer && !row.isMine && (!dedupe || row.teamViaOthers)),
    assignedToYou: rows.filter(row => row.assignedToMe && !row.isMine),
    createdByYou: rows.filter(row => row.isMine),
    filtered: {drafts, bots, reviewed},
  };
}

/** Every visible row, in the order the dashboard renders them. */
export function flattenSections(sections: Sections): Row[] {
  return [...sections.toReview, ...sections.assignedToYou, ...sections.createdByYou];
}

/** Index into `flattenSections` where each non-empty section starts — what `tab` jumps to. */
export function sectionStarts(sections: Sections): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const rows of [sections.toReview, sections.assignedToYou, sections.createdByYou]) {
    if (rows.length > 0) starts.push(offset);
    offset += rows.length;
  }
  return starts;
}

/** `tab`: first row of the next non-empty section, wrapping back to the top. */
export function nextSectionStart(starts: number[], current: number): number {
  return starts.find(start => start > current) ?? starts[0] ?? 0;
}

export interface ReviewerGroup {
  /** What `team.groupDescriptor` should hold: the descriptor, or the id when ADO omits it. */
  descriptor: string;
  displayName: string;
  /** How many of the fetched PRs this group is a reviewer on — the picker sorts on it. */
  prCount: number;
}

/**
 * Groups that actually appear as container reviewers in the fetched PRs.
 *
 * This is why the settings screen needs no Graph API search: whatever group is put on
 * these PRs is already in their payload, and it is the only group worth offering.
 */
export function discoverReviewerGroups(prs: TaggedPullRequest[]): ReviewerGroup[] {
  const seen = new Map<string, ReviewerGroup>();

  for (const pr of prs) {
    for (const reviewer of pr.reviewers ?? []) {
      if (!reviewer.isContainer) continue;
      const descriptor = reviewer.descriptor ?? reviewer.id;
      if (!descriptor) continue;
      const existing = seen.get(descriptor);
      if (existing) existing.prCount += 1;
      else seen.set(descriptor, {descriptor, displayName: reviewer.displayName ?? descriptor, prCount: 1});
    }
  }

  return [...seen.values()].sort((a, b) => b.prCount - a.prCount || a.displayName.localeCompare(b.displayName));
}

/** True when a reviewer has voted "waiting for author" on this PR. */
export function awaitsAuthor(row: Row): boolean {
  return row.waitingReviewers > 0;
}
