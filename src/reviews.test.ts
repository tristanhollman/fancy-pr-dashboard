import {expect, test} from 'bun:test';
import type {AdoReviewer, TaggedPullRequest} from './api.ts';
import {
  REVIEW_POLICY_TYPES, summarizeReviewRequirements, unknownReviewRequirements, type AdoPolicyEvaluation,
} from './reviews.ts';

function pr(reviewers: AdoReviewer[] | undefined = []): TaggedPullRequest {
  return {
    pullRequestId: 1, title: 'A change', creationDate: '2026-09-01T00:00:00Z',
    createdBy: {id: 'creator', uniqueName: 'creator@example.invalid'},
    repository: {name: 'repo'}, project: 'project', reviewers,
  };
}

function minimum(status = 'approved', settings: Record<string, unknown> = {}): AdoPolicyEvaluation {
  return {
    status,
    configuration: {
      isEnabled: true, isBlocking: true, type: {id: REVIEW_POLICY_TYPES.minimum},
      settings: {minimumApproverCount: 2, creatorVoteCounts: false, ...settings},
    },
  };
}

function required(status = 'approved', ids = ['team']): AdoPolicyEvaluation {
  return {
    status,
    configuration: {
      isEnabled: true, isBlocking: true, type: {id: REVIEW_POLICY_TYPES.required},
      settings: {requiredReviewerIds: ids},
    },
  };
}

test('unknown helper is safe for initial loading and visible failures', () => {
  expect(unknownReviewRequirements('Loading policies')).toEqual({
    status: 'unknown', minimum: null, requiredReviewers: {approved: 0, total: 0}, notes: ['Loading policies'],
  });
});

test('minimum approval and required people/groups are independent requirements', () => {
  const result = summarizeReviewRequirements(pr([
    {id: 'one', vote: 10}, {id: 'two', vote: 5},
    {id: 'team', vote: 0, isContainer: true, isRequired: true},
  ]), [minimum(), required('rejected')]);
  expect(result.status).toBe('pending');
  expect(result.minimum).toEqual({approved: 2, required: 2});
  expect(result.requiredReviewers).toEqual({approved: 0, total: 1});
});

test('required group approval alone does not satisfy a minimum person count', () => {
  const result = summarizeReviewRequirements(pr([{id: 'team', vote: 10, isContainer: true, isRequired: true}]),
    [minimum('rejected'), required()]);
  expect(result.status).toBe('pending');
  expect(result.minimum).toEqual({approved: 0, required: 2});
  expect(result.requiredReviewers).toEqual({approved: 1, total: 1});
});

test('approved with suggestions counts for individuals and required people/groups', () => {
  const result = summarizeReviewRequirements(pr([
    {id: 'one', vote: 5, isRequired: true}, {id: 'two', vote: 5},
    {id: 'team', vote: 5, isContainer: true, isRequired: true},
  ]), [minimum(), required()]);
  expect(result.status).toBe('complete');
  expect(result.minimum).toEqual({approved: 2, required: 2});
  expect(result.requiredReviewers).toEqual({approved: 2, total: 2});
});

test('explicit required entries cannot establish completeness without policy data', () => {
  const result = summarizeReviewRequirements(pr([{id: 'one', vote: 10, isRequired: true}]), null);
  expect(result.status).toBe('unknown');
  expect(result.requiredReviewers).toEqual({approved: 1, total: 1});
});

test('explicit required entries can establish progress after confirming there are no applicable policies', () => {
  expect(summarizeReviewRequirements(pr([{id: 'one', vote: 0, isRequired: true}]), []).status).toBe('pending');
  expect(summarizeReviewRequirements(pr([{id: 'one', vote: 5, isRequired: true}]), []).status).toBe('complete');
});

test('none requires confirmed policy data and reviewer metadata', () => {
  expect(summarizeReviewRequirements(pr(), []).status).toBe('none');
  expect(summarizeReviewRequirements(pr([{id: 'optional', vote: 0}]), []).status).toBe('none');
  expect(summarizeReviewRequirements(pr(), null).status).toBe('unknown');
  expect(summarizeReviewRequirements({...pr(), reviewers: undefined}, []).status).toBe('unknown');
});

test('disabled, optional, deleted and not-applicable review policies are not requirements', () => {
  const disabled = minimum('rejected');
  disabled.configuration!.isEnabled = false;
  const optional = minimum('rejected');
  optional.configuration!.isBlocking = false;
  const deleted = minimum('rejected');
  deleted.configuration!.isDeleted = true;
  expect(summarizeReviewRequirements(pr(), [disabled, optional, deleted, minimum('notApplicable')]).status).toBe('none');
});

test('non-review checks do not determine review completion even if broken or rejected', () => {
  const unrelated = [
    ['0609b952-1397-4640-95ec-e00a01b2c241', 'Build'],
    ['40e92b44-2fe1-4dd6-b3d8-74a9c21d0c6e', 'Work item linking'],
    ['fa4e907d-c16b-4a4c-9dfa-4916e5d171ab', 'Merge strategy'],
    ['c6a1889d-b943-4856-b76f-9e46bb6b0df2', 'Comment requirements'],
    ['cbdc66da-9728-4af8-aada-9a5a32e4a226', 'Status'],
    ['extension-check', 'Security scan'],
  ].map(([id, displayName]): AdoPolicyEvaluation => ({
    status: 'broken', configuration: {isEnabled: true, isBlocking: true, type: {id, displayName}},
  }));
  expect(summarizeReviewRequirements(pr(), unrelated).status).toBe('none');
  expect(summarizeReviewRequirements(pr(), [...unrelated, minimum()]).status).toBe('complete');
});

test('unsupported applicable review types cannot claim completion or none', () => {
  const unsupported: AdoPolicyEvaluation = {
    status: 'approved',
    configuration: {isEnabled: true, isBlocking: true, type: {id: 'custom', displayName: 'Additional reviewer quorum'}},
  };
  expect(summarizeReviewRequirements(pr(), [unsupported]).status).toBe('unknown');
  expect(summarizeReviewRequirements(pr(), [minimum(), unsupported]).status).toBe('unknown');
  unsupported.configuration!.isBlocking = false;
  expect(summarizeReviewRequirements(pr(), [unsupported]).status).toBe('none');
});

test('missing policy configuration, type, blocking flags and minimum count stay unknown', () => {
  const missingEnabled = minimum();
  delete missingEnabled.configuration!.isEnabled;
  const missingBlocking = minimum();
  delete missingBlocking.configuration!.isBlocking;
  const missingCount = minimum();
  delete missingCount.configuration!.settings!.minimumApproverCount;
  for (const evaluation of [{}, {configuration: {}}, missingEnabled, missingBlocking, missingCount]) {
    expect(summarizeReviewRequirements(pr(), [evaluation]).status).toBe('unknown');
  }
});

test('invalid minimum counts cannot be interpreted as zero requirements', () => {
  for (const minimumApproverCount of [-1, 1.5, '2', null, undefined, NaN]) {
    expect(summarizeReviewRequirements(pr(), [minimum('approved', {minimumApproverCount})]).status).toBe('unknown');
  }
});

test('creator approval is excluded from the displayed minimum when the policy excludes it', () => {
  const review = pr([{id: 'CREATOR', vote: 10}, {id: 'other', vote: 5}]);
  const result = summarizeReviewRequirements(review, [minimum('rejected')]);
  expect(result.status).toBe('pending');
  expect(result.minimum).toEqual({approved: 1, required: 2});
  expect(summarizeReviewRequirements(review, [minimum('approved', {creatorVoteCounts: true})]).minimum?.approved).toBe(2);
});

test('creator matching falls back to the unique name for different identity IDs', () => {
  const result = summarizeReviewRequirements(pr([
    {id: 'alias', uniqueName: 'CREATOR@example.invalid', vote: 10},
  ]), [minimum('rejected')]);
  expect(result.minimum?.approved).toBe(0);
});

test('rejected policy stays pending despite enough visible approvals and a blocking downvote', () => {
  const result = summarizeReviewRequirements(pr([
    {id: 'one', vote: 10}, {id: 'two', vote: 10}, {id: 'three', vote: -10},
  ]), [minimum('rejected', {allowDownvotes: false})]);
  expect(result.minimum).toEqual({approved: 2, required: 2});
  expect(result.status).toBe('pending');
});

test('approved policy is authoritative when downvotes are allowed', () => {
  const result = summarizeReviewRequirements(pr([
    {id: 'one', vote: 10}, {id: 'two', vote: 5}, {id: 'three', vote: -5},
  ]), [minimum('approved', {allowDownvotes: true})]);
  expect(result.status).toBe('complete');
});

test('push resets, last-pusher and iteration rules honor evaluation status rather than current votes', () => {
  for (const setting of ['resetOnSourcePush', 'blockLastPusherVote', 'requireVoteOnLastIteration', 'requireVoteOnEachIteration']) {
    const result = summarizeReviewRequirements(pr([{id: 'one', vote: 10}, {id: 'two', vote: 10}]),
      [minimum('rejected', {[setting]: true})]);
    expect(result.minimum?.approved).toBe(2);
    expect(result.status).toBe('pending');
    expect(result.notes.some(note => note.includes('iteration'))).toBe(true);
  }
});

test('queued and running review evaluations are pending, broken/missing/unrecognized status is unknown', () => {
  for (const status of ['queued', 'running', 'rejected']) {
    expect(summarizeReviewRequirements(pr(), [minimum(status)]).status).toBe('pending');
  }
  for (const status of ['broken', '', 'unexpected']) {
    expect(summarizeReviewRequirements(pr(), [minimum(status)]).status).toBe('unknown');
  }
  const missing = minimum();
  delete missing.status;
  expect(summarizeReviewRequirements(pr(), [missing]).status).toBe('unknown');
});

test('a required group with a positive aggregate vote can still have an unmet policy quorum', () => {
  const policy = required('rejected');
  policy.configuration!.settings!.minimumNumberOfReviewers = 2;
  const result = summarizeReviewRequirements(pr([{id: 'team', vote: 10, isContainer: true, isRequired: true}]), [policy]);
  expect(result.requiredReviewers).toEqual({approved: 1, total: 1});
  expect(result.status).toBe('pending');
});

test('an approved required-reviewer evaluation is authoritative when the list vote snapshot is older', () => {
  const result = summarizeReviewRequirements(pr([{id: 'team', vote: 0, isContainer: true, isRequired: true}]), [required()]);
  expect(result.status).toBe('complete');
  expect(result.requiredReviewers).toEqual({approved: 0, total: 1});
  expect(result.notes.some(note => note.includes('observed progress'))).toBe(true);
});

test('required policy identities are counted even when the reviewer isRequired flag is absent', () => {
  const result = summarizeReviewRequirements(pr([{id: 'team', vote: 10, isContainer: true}]), [required()]);
  expect(result.status).toBe('complete');
  expect(result.requiredReviewers).toEqual({approved: 1, total: 1});
});

test('required policies and explicit entries deduplicate identities case insensitively', () => {
  const result = summarizeReviewRequirements(pr([
    {id: 'TEAM', vote: 5, isContainer: true, isRequired: true},
    {id: 'one', vote: 10, isRequired: true},
  ]), [required('approved', ['team', 'ONE']), required('approved', ['TEAM'])]);
  expect(result.requiredReviewers).toEqual({approved: 2, total: 2});
  expect(result.status).toBe('complete');
});

test('missing required identities or vote metadata remain unknown even with approved evaluations', () => {
  expect(summarizeReviewRequirements(pr(), [required()]).status).toBe('unknown');
  expect(summarizeReviewRequirements(pr([{id: 'team', vote: 99}]), [required()]).status).toBe('unknown');
  expect(summarizeReviewRequirements(pr(), [required('approved', [])]).status).toBe('unknown');
  const missing = required();
  delete missing.configuration!.settings;
  expect(summarizeReviewRequirements(pr(), [missing]).status).toBe('unknown');
});

test('multiple minimum policies use the strongest threshold and require every evaluation to approve', () => {
  const result = summarizeReviewRequirements(pr([
    {id: 'creator', vote: 10}, {id: 'one', vote: 5}, {id: 'two', vote: 10},
  ]), [
    minimum('approved', {minimumApproverCount: 2, creatorVoteCounts: false}),
    minimum('rejected', {minimumApproverCount: 3, creatorVoteCounts: true}),
  ]);
  expect(result.minimum).toEqual({approved: 2, required: 3});
  expect(result.status).toBe('pending');
});

test('an active zero-minimum policy is still a rule, not confirmed absence of requirements', () => {
  expect(summarizeReviewRequirements(pr(), [minimum('rejected', {minimumApproverCount: 0})]).status).toBe('pending');
});

test('malformed reviewer or policy-settings payloads remain unknown instead of throwing or succeeding', () => {
  const malformed = {...pr(), reviewers: {}} as unknown as TaggedPullRequest;
  expect(summarizeReviewRequirements(malformed, []).status).toBe('unknown');
  expect(summarizeReviewRequirements(pr([{id: 'one', vote: undefined as unknown as number}]), [minimum()]).status).toBe('unknown');
  for (const settings of [null, 'unexpected', 7, []]) {
    const evaluation = minimum();
    evaluation.configuration!.settings = settings as unknown as Record<string, unknown>;
    expect(summarizeReviewRequirements(pr(), [evaluation]).status).toBe('unknown');
  }
});
