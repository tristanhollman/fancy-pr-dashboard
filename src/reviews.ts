import type {AdoIdentityRef, AdoReviewer, TaggedPullRequest} from './api.ts';

export interface ReviewRequirements {
  status: 'unknown' | 'none' | 'pending' | 'complete';
  /** Observed eligible votes, not an alternative to the server's evaluation. */
  minimum: {approved: number; required: number} | null;
  /** Counts required identities; a group counts once, not once per member. */
  requiredReviewers: {approved: number; total: number};
  notes: string[];
}

export interface AdoPolicyEvaluation {
  evaluationId?: string;
  status?: string;
  configuration?: {
    isEnabled?: boolean;
    isBlocking?: boolean;
    isDeleted?: boolean;
    type?: {id?: string; displayName?: string};
    settings?: Record<string, unknown>;
  };
}

// Official policy type settings:
// https://learn.microsoft.com/previous-versions/azure/devops/integrate/previous-apis/policy/settings
export const REVIEW_POLICY_TYPES = {
  minimum: 'fa4e907d-c16b-4a4c-9dfa-4906e5d171dd',
  required: 'fd2167ab-b0be-447a-8ec8-39368250530e',
} as const;

const NON_REVIEW_POLICY_TYPES = new Set([
  '0609b952-1397-4640-95ec-e00a01b2c241', // Build
  '40e92b44-2fe1-4dd6-b3d8-74a9c21d0c6e', // Work item linking
  'fa4e907d-c16b-4a4c-9dfa-4916e5d171ab', // Merge strategy
  'c6a1889d-b943-4856-b76f-9e46bb6b0df2', // Comment resolution
  'cbdc66da-9728-4af8-aada-9a5a32e4a226', // Status checks
]);

export function unknownReviewRequirements(note: string): ReviewRequirements {
  return {status: 'unknown', minimum: null, requiredReviewers: {approved: 0, total: 0}, notes: [note]};
}

function approved(reviewer: AdoReviewer): boolean {
  return reviewer.vote === 10 || reviewer.vote === 5;
}

function sameIdentity(a: AdoIdentityRef, b: AdoIdentityRef): boolean {
  if (a.id && b.id && a.id.toLowerCase() === b.id.toLowerCase()) return true;
  return Boolean(a.uniqueName && b.uniqueName && a.uniqueName.toLowerCase() === b.uniqueName.toLowerCase());
}

function policySettings(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Votes explain progress; evaluations decide policy completion. In particular,
 * container votes do not prove group quorum, and visible approvals can predate
 * a push, come from the creator/latest pusher, or coexist with a blocking downvote.
 */
export function summarizeReviewRequirements(
  pr: TaggedPullRequest,
  evaluations: readonly AdoPolicyEvaluation[] | null,
): ReviewRequirements {
  const result: ReviewRequirements = {status: 'none', minimum: null, requiredReviewers: {approved: 0, total: 0}, notes: []};
  let uncertain = false;
  let pending = false;
  let policyCount = 0;
  const unknown = (note: string) => {
    uncertain = true;
    result.notes.push(note);
  };
  const reviewers = new Map<string, AdoReviewer>();
  const required = new Set<string>();
  const policyRequired = new Set<string>();

  const entries = Array.isArray(pr.reviewers) ? pr.reviewers : [];
  if (!Array.isArray(pr.reviewers)) unknown('Reviewer metadata is unavailable.');
  for (const reviewer of entries) {
    if (!reviewer?.id || typeof reviewer.id !== 'string') {
      unknown('A reviewer has no stable identity.');
      continue;
    }
    if (![10, 5, 0, -5, -10].includes(reviewer.vote)) unknown('A reviewer has no supported vote metadata.');
    const id = reviewer.id.toLowerCase();
    reviewers.set(id, reviewer);
    if (reviewer.isRequired) required.add(id);
  }

  if (evaluations === null) unknown('Applicable review policies are unavailable.');
  for (const evaluation of evaluations ?? []) {
    const configuration = evaluation?.configuration;
    const status = typeof evaluation?.status === 'string' ? evaluation.status.toLowerCase() : '';
    if (status === 'notapplicable' || configuration?.isDeleted === true ||
        configuration?.isEnabled === false || configuration?.isBlocking === false) continue;

    const type = configuration?.type;
    const id = typeof type?.id === 'string' ? type.id.toLowerCase() : '';
    const minimumPolicy = id === REVIEW_POLICY_TYPES.minimum;
    const requiredPolicy = id === REVIEW_POLICY_TYPES.required;
    if (NON_REVIEW_POLICY_TYPES.has(id)) continue;
    if (!minimumPolicy && !requiredPolicy) {
      const settings = policySettings(configuration?.settings);
      const name = typeof type?.displayName === 'string' ? type.displayName : '';
      if (!id || !name || /review|approv|vote/i.test(name) ||
          (settings && ('minimumApproverCount' in settings || 'requiredReviewerIds' in settings))) {
        unknown('An applicable policy has missing or unsupported review-rule metadata.');
      }
      continue;
    }
    if (configuration?.isEnabled !== true || configuration.isBlocking !== true) {
      unknown('A review policy is missing its enabled/blocking metadata.');
      continue;
    }

    policyCount += 1;
    if (status === 'queued' || status === 'running' || status === 'rejected') pending = true;
    else if (status !== 'approved') unknown('A review policy evaluation is unavailable or broken.');

    const settings = policySettings(configuration.settings);
    if (minimumPolicy) {
      const count = settings?.minimumApproverCount;
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        unknown('The minimum approval policy has no supported approval count.');
        continue;
      }
      if (settings?.creatorVoteCounts !== true && !pr.createdBy?.id && !pr.createdBy?.uniqueName) {
        unknown('The creator identity is unavailable for the minimum approval policy.');
      }
      const votes = [...reviewers.values()].filter(reviewer =>
        !reviewer.isContainer && approved(reviewer) &&
        (settings?.creatorVoteCounts === true || (pr.createdBy && !sameIdentity(reviewer, pr.createdBy))),
      ).length;
      // Multiple applicable minimum policies can have different eligibility rules.
      result.minimum = result.minimum
        ? {approved: Math.min(result.minimum.approved, votes), required: Math.max(result.minimum.required, count)}
        : {approved: votes, required: count};
      if (settings?.creatorVoteCounts !== true) result.notes.push('The creator’s vote does not count toward the minimum.');
      if (settings?.blockLastPusherVote || settings?.resetOnSourcePush || settings?.resetRejectionsOnSourcePush ||
          settings?.requireVoteOnLastIteration || settings?.requireVoteOnEachIteration) {
        result.notes.push('Push/iteration restrictions are enforced by the policy evaluation, not the displayed vote count.');
      }
    } else {
      const ids = settings?.requiredReviewerIds;
      if (!Array.isArray(ids) || ids.length === 0 || ids.some(value => typeof value !== 'string' || !value.trim())) {
        unknown('A required-reviewer policy has no supported reviewer identities.');
        continue;
      }
      for (const reviewerId of ids as string[]) {
        required.add(reviewerId.toLowerCase());
        policyRequired.add(reviewerId.toLowerCase());
      }
    }
  }

  for (const id of required) {
    const reviewer = reviewers.get(id);
    if (!reviewer || ![10, 5, 0, -5, -10].includes(reviewer.vote)) {
      unknown('A required person or group has no available vote metadata.');
    } else if (approved(reviewer)) {
      result.requiredReviewers.approved += 1;
    } else if (!policyRequired.has(id)) {
      pending = true;
    }
  }
  result.requiredReviewers.total = required.size;
  if (policyCount > 0) {
    result.notes.push('Review policy evaluations determine completion; vote counts show observed progress only.');
  }
  result.notes = [...new Set(result.notes)];
  result.status = uncertain ? 'unknown' : pending ? 'pending' : policyCount > 0 || required.size > 0 ? 'complete' : 'none';
  return result;
}
