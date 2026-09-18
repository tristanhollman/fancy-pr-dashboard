import {afterEach, beforeEach, expect, test} from 'bun:test';
import {ApiError, getChangedFileCount, getMe, getPullRequestDetails, getReviewRequirements, listActivePullRequests, resetIdentityCache, type TaggedPullRequest} from './api.ts';
import {resetAzTokenCache, setAzRunner} from './azcli.ts';
import {defaultConfig, type Config} from './config.ts';
import {REVIEW_POLICY_TYPES} from './reviews.ts';

const realFetch = globalThis.fetch;
const savedEnvPat = process.env.FPR_PAT;

interface Call {
  url: string;
  authorization: string;
}

let calls: Call[] = [];

/** Replaces fetch with a canned responder; records what was requested. */
function stubFetch(responder: (url: string) => {status?: number; body?: unknown; text?: string}) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({url, authorization: headers.get('authorization') ?? ''});

    const {status = 200, body, text} = responder(url);
    const payload = text ?? JSON.stringify(body ?? {});
    return new Response(payload, {status, headers: {'content-type': 'application/json'}});
  }) as typeof fetch;
}

function config(): Config {
  const c = defaultConfig();
  c.org = 'myorg';
  c.projects = ['platform'];
  c.auth.pat = 'token-not-real';
  return c;
}

const CONNECTION_DATA = {
  authenticatedUser: {
    id: 'me-guid',
    providerDisplayName: 'Me Myself',
    properties: {Account: {$value: 'me@co.com'}},
  },
};

/** An az-cli config plus a stubbed az that hands out `token`. */
function azConfig(token = 'az-token-not-real'): Config {
  const c = config();
  c.auth.mode = 'az-cli';
  c.auth.pat = null;
  setAzRunner(async (_resource, tenant) => {
    azTenants.push(tenant);
    return {
      exitCode: 0,
      stdout: JSON.stringify({accessToken: token, expires_on: Math.floor(Date.now() / 1000) + 3600}),
      stderr: '',
    };
  });
  return c;
}

/** Tenants az was asked for, in order. */
let azTenants: Array<string | null> = [];

beforeEach(() => {
  calls = [];
  azTenants = [];
  resetIdentityCache();
  resetAzTokenCache();
  delete process.env.FPR_PAT;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  resetIdentityCache();
  resetAzTokenCache();
  setAzRunner();
  if (savedEnvPat === undefined) delete process.env.FPR_PAT;
  else process.env.FPR_PAT = savedEnvPat;
});

test('identity comes from connectionData on the org host, not the profile endpoint', async () => {
  stubFetch(() => ({body: CONNECTION_DATA}));

  const me = await getMe(config());

  expect(me).toEqual({id: 'me-guid', displayName: 'Me Myself', uniqueName: 'me@co.com'});
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toStartWith('https://dev.azure.com/myorg/_apis/connectionData');
  // The vssps profile endpoint needs the User Profile scope; a Code-only PAT 401s there.
  expect(calls[0]?.url).not.toContain('vssps');
  expect(calls[0]?.url).not.toContain('profiles/me');
});

test('identity is cached until the cache is dropped', async () => {
  stubFetch(() => ({body: CONNECTION_DATA}));

  await getMe(config());
  await getMe(config());
  expect(calls).toHaveLength(1);

  resetIdentityCache();
  await getMe(config());
  expect(calls).toHaveLength(2);
});

test('the PAT is sent as basic auth and trimmed of stray whitespace', async () => {
  stubFetch(() => ({body: CONNECTION_DATA}));

  const c = config();
  c.auth.pat = '  token-not-real\n';
  await getMe(c);

  expect(calls[0]?.authorization).toBe(`Basic ${btoa(':token-not-real')}`);
});

test('a 401 explains the plausible causes without echoing the token', async () => {
  stubFetch(() => ({status: 401, body: {}}));

  const failure = await getMe(config()).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ApiError);
  const error = failure as ApiError;
  expect(error.status).toBe(401);
  expect(error.message).toContain('expired');
  expect(error.message).toContain('organization');
  expect(error.message).not.toContain('token-not-real');
});

test('az-cli mode sends the az token as a bearer token, and ignores any stored PAT', async () => {
  stubFetch(() => ({body: CONNECTION_DATA}));

  const c = azConfig();
  c.auth.pat = 'stored-pat-not-real';
  await getMe(c);

  expect(calls[0]?.authorization).toBe('Bearer az-token-not-real');
  expect(calls[0]?.authorization).not.toContain('stored-pat-not-real');
});

test('az-cli mode ignores FPR_PAT — the mode, not the environment, picks the credential', async () => {
  stubFetch(() => ({body: CONNECTION_DATA}));
  process.env.FPR_PAT = 'env-token-not-real';

  await getMe(azConfig());

  expect(calls[0]?.authorization).toBe('Bearer az-token-not-real');
});

test('a failing az never reaches the network', async () => {
  stubFetch(() => ({body: CONNECTION_DATA}));

  const c = config();
  c.auth.mode = 'az-cli';
  setAzRunner(async () => ({exitCode: 1, stdout: '', stderr: "ERROR: Please run 'az login'"}));

  await expect(getMe(c)).rejects.toThrow('az login');
  expect(calls).toHaveLength(0);
});

test('a rejected az token is dropped so the next attempt re-runs az', async () => {
  stubFetch(() => ({status: 401, body: {}}));

  let issued = 0;
  const c = config();
  c.auth.mode = 'az-cli';
  setAzRunner(async () => ({
    exitCode: 0,
    stdout: JSON.stringify({accessToken: `az-token-${++issued}`, expires_on: Math.floor(Date.now() / 1000) + 3600}),
    stderr: '',
  }));

  await expect(getMe(c)).rejects.toThrow(ApiError);
  await expect(getMe(c)).rejects.toThrow(ApiError);

  expect(calls.map(call => call.authorization)).toEqual(['Bearer az-token-1', 'Bearer az-token-2']);
});

test('the configured tenant reaches az, and is otherwise left to az', async () => {
  stubFetch(() => ({body: CONNECTION_DATA}));

  await getMe(azConfig());
  expect(azTenants).toEqual([null]);

  resetIdentityCache();
  resetAzTokenCache();
  const c = azConfig();
  c.auth.tenant = 'contoso-tenant-id';
  await getMe(c);
  expect(azTenants).toEqual([null, 'contoso-tenant-id']);
});

test('a 401 in az-cli mode blames the login, not a PAT', async () => {
  stubFetch(() => ({status: 401, body: {}}));

  const failure = (await getMe(azConfig()).catch((error: unknown) => error)) as ApiError;
  expect(failure.message).toContain('az login');
  // The other thing a 401 means here: a valid token for the wrong Entra tenant.
  expect(failure.message).toContain('tenant');
  expect(failure.message).not.toContain('PAT');
});

test('a 403 in az-cli mode does not suggest changing a PAT scope', async () => {
  stubFetch(() => ({status: 403, body: {}}));

  const failure = (await getMe(azConfig()).catch((error: unknown) => error)) as ApiError;
  expect(failure.status).toBe(403);
  expect(failure.message).toContain('az identity');
  expect(failure.message).not.toContain('Code: Read');
});

test('a missing PAT never reaches the network', async () => {
  stubFetch(() => ({body: CONNECTION_DATA}));

  const c = config();
  c.auth.pat = null;
  await expect(getMe(c)).rejects.toThrow('no PAT configured');
  expect(calls).toHaveLength(0);
});

test('pull requests are fetched per project and tagged with it', async () => {
  stubFetch(url => ({
    body: {
      value: [
        {
          pullRequestId: url.includes('platform') ? 1 : 2,
          title: 't',
          creationDate: '2026-08-20T10:00:00Z',
          createdBy: {id: 'x'},
          repository: {name: url.includes('platform') ? 'ingest-worker' : 'telemetry'},
          reviewers: [],
        },
      ],
    },
  }));

  const c = config();
  c.projects = ['platform', 'payments'];
  const prs = await listActivePullRequests(c);

  expect(prs.map(pr => [pr.project, pr.pullRequestId])).toEqual([
    ['platform', 1],
    ['payments', 2],
  ]);
  expect(calls).toHaveLength(2);
  expect(calls[0]?.url).toContain('searchCriteria.status=active');
  expect(calls[0]?.url).toContain('/platform/_apis/git/pullrequests');
});

test('the repos filter drops repositories that are not configured', async () => {
  stubFetch(() => ({
    body: {
      value: [
        {pullRequestId: 1, title: 't', creationDate: '2026-08-20T10:00:00Z', createdBy: {id: 'x'}, repository: {name: 'ingest-worker'}},
        {pullRequestId: 2, title: 't', creationDate: '2026-08-20T10:00:00Z', createdBy: {id: 'x'}, repository: {name: 'telemetry'}},
      ],
    },
  }));

  const c = config();
  c.repos = ['Telemetry']; // case-insensitive
  const prs = await listActivePullRequests(c);
  expect(prs.map(pr => pr.pullRequestId)).toEqual([2]);
});

test('connectionData is requested at its preview api-version', async () => {
  stubFetch(() => ({body: CONNECTION_DATA}));
  await getMe(config());
  expect(calls[0]?.url).toContain('api-version=7.1-preview.1');
});

test("a 400 carries Azure DevOps's own explanation", async () => {
  stubFetch(() => ({
    status: 400,
    body: {message: 'The requested REST API version of 7.1 is out of range for this endpoint.'},
  }));

  const failure = (await getMe(config()).catch((error: unknown) => error)) as ApiError;
  expect(failure.status).toBe(400);
  expect(failure.message).toContain('out of range');
  expect(failure.message).not.toContain('token-not-real');
});

test('a 203 sign-in page is an auth failure, not a success', async () => {
  stubFetch(() => ({status: 203, text: '<html>sign in</html>'}));

  const failure = (await getMe(config()).catch((error: unknown) => error)) as ApiError;
  expect(failure.status).toBe(401);
  expect(failure.message).toContain('expired');
});

function prForDiff(overrides: Record<string, unknown> = {}): TaggedPullRequest {
  return {
    pullRequestId: 7,
    title: 't',
    creationDate: '2026-08-20T10:00:00Z',
    createdBy: {id: 'x'},
    repository: {id: 'repo-guid', name: 'ingest-worker'},
    sourceRefName: 'refs/heads/feature/x',
    targetRefName: 'refs/heads/main',
    lastMergeSourceCommit: {commitId: 'source-sha'},
    lastMergeTargetCommit: {commitId: 'target-sha'},
    project: 'platform',
    ...overrides,
  };
}

test('changed-file count diffs the merge commits and ignores folder entries', async () => {
  stubFetch(() => ({
    body: {
      allChangesIncluded: true,
      changes: [
        {item: {isFolder: true}},
        {item: {path: '/a.ts'}},
        {item: {path: '/b.ts'}},
      ],
    },
  }));

  const count = await getChangedFileCount(config(), prForDiff());

  expect(count).toEqual({files: 2, truncated: false});
  const url = calls[0]?.url ?? '';
  expect(url).toContain('/platform/_apis/git/repositories/repo-guid/diffs/commits');
  expect(url).toContain('baseVersionType=commit');
  expect(url).toContain('baseVersion=target-sha'); // base is the target branch side
  expect(url).toContain('targetVersion=source-sha');
  expect(url).toContain('diffCommonCommit=true');
});

test('changed-file count falls back to branch names when merge commits are missing', async () => {
  stubFetch(() => ({body: {changes: []}}));

  await getChangedFileCount(config(), prForDiff({lastMergeSourceCommit: undefined, lastMergeTargetCommit: undefined}));

  const url = calls[0]?.url ?? '';
  expect(url).toContain('baseVersionType=branch');
  expect(url).toContain('baseVersion=main');
  expect(url).toContain(`targetVersion=${encodeURIComponent('feature/x')}`);
});

test('a truncated diff is reported as a floor, and a summary-only body still counts', async () => {
  stubFetch(() => ({body: {allChangesIncluded: false, changes: [{item: {path: '/a.ts'}}]}}));
  expect(await getChangedFileCount(config(), prForDiff())).toEqual({files: 1, truncated: true});

  stubFetch(() => ({body: {allChangesIncluded: true, changeCounts: {Add: 3, Edit: 4}}}));
  expect(await getChangedFileCount(config(), prForDiff())).toEqual({files: 7, truncated: false});
});

test('an HTML body on a 200 is reported as a wrong-organization symptom', async () => {
  stubFetch(() => ({text: '<html>sign in</html>'}));

  await expect(getMe(config())).rejects.toThrow('non-JSON response');
});

const PROJECT_ID = 'a7573007-bbb3-4341-b726-0c4148a07853';

function prForReviews(overrides: Partial<TaggedPullRequest> = {}): TaggedPullRequest {
  return prForDiff({
    repository: {id: 'repo-guid', name: 'ingest-worker', project: {id: PROJECT_ID, name: 'platform'}},
    reviewers: [],
    ...overrides,
  });
}

test('review requirements use the project GUID artifact and documented preview endpoint', async () => {
  stubFetch(() => ({
    body: {
      value: [{
        status: 'rejected',
        configuration: {
          isEnabled: true,
          isBlocking: true,
          type: {id: REVIEW_POLICY_TYPES.minimum},
          settings: {minimumApproverCount: 2, creatorVoteCounts: false},
        },
      }],
    },
  }));

  const result = await getReviewRequirements(config(), prForReviews());
  expect(result.status).toBe('pending');
  expect(result.minimum).toEqual({approved: 0, required: 2});
  const url = new URL(calls[0]!.url);
  expect(url.pathname).toBe(`/myorg/${PROJECT_ID}/_apis/policy/evaluations`);
  expect(url.searchParams.get('artifactId')).toBe(`vstfs:///CodeReview/CodeReviewId/${PROJECT_ID}/7`);
  expect(url.searchParams.get('api-version')).toBe('7.1-preview.1');
  expect(url.searchParams.get('includeNotApplicable')).toBe('true');
});

test('review evaluation pagination finds a requirement after a full page of unrelated checks', async () => {
  stubFetch(url => {
    const skip = Number(new URL(url).searchParams.get('$skip'));
    if (skip === 0) {
      return {
        body: {
          value: Array.from({length: 100}, (_, i) => ({
            evaluationId: `build-${i}`,
            status: 'rejected',
            configuration: {isEnabled: true, isBlocking: true, type: {id: '0609b952-1397-4640-95ec-e00a01b2c241'}},
          })),
        },
      };
    }
    return {
      body: {
        value: [{
          evaluationId: 'review',
          status: 'queued',
          configuration: {
            isEnabled: true, isBlocking: true,
            type: {id: REVIEW_POLICY_TYPES.minimum}, settings: {minimumApproverCount: 1},
          },
        }],
      },
    };
  });
  const result = await getReviewRequirements(config(), prForReviews());
  expect(result.status).toBe('pending');
  expect(result.minimum?.required).toBe(1);
  expect(calls.map(call => new URL(call.url).searchParams.get('$skip'))).toEqual(['0', '100']);
});

test('an exact full evaluation page is followed by an empty final page', async () => {
  stubFetch(url => ({
    body: {
      value: new URL(url).searchParams.get('$skip') === '0'
        ? Array.from({length: 100}, (_, i) => ({evaluationId: `optional-${i}`, configuration: {isBlocking: false}}))
        : [],
    },
  }));
  expect((await getReviewRequirements(config(), prForReviews())).status).toBe('none');
  expect(calls).toHaveLength(2);
});

test('review requirements are unknown without a project GUID and never send the project name as artifact ID', async () => {
  stubFetch(() => ({body: {value: []}}));
  for (const project of [undefined, {name: 'platform'}, {id: 'platform'}, {id: ''}]) {
    const result = await getReviewRequirements(config(), prForReviews({
      repository: {name: 'repo', project},
      reviewers: [{id: 'required', vote: 10, isRequired: true}],
    }));
    expect(result.status).toBe('unknown');
  }
  expect(calls).toHaveLength(0);
});

test('confirmed empty review evaluations can establish none, but absent list data cannot', async () => {
  stubFetch(() => ({body: {value: []}}));
  expect((await getReviewRequirements(config(), prForReviews())).status).toBe('none');
  for (const body of [{}, {value: null}, {value: {}}]) {
    stubFetch(() => ({body}));
    await expect(getReviewRequirements(config(), prForReviews())).rejects.toThrow('invalid list response');
  }
});

test('review-policy HTTP failures propagate instead of declaring completion from required votes', async () => {
  const pr = prForReviews({reviewers: [{id: 'required', vote: 10, isRequired: true}]});
  for (const status of [401, 403, 404, 429, 500]) {
    stubFetch(() => ({status, body: {}}));
    await expect(getReviewRequirements(config(), pr)).rejects.toBeInstanceOf(ApiError);
  }
});

test('review-policy network failures propagate', async () => {
  globalThis.fetch = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  await expect(getReviewRequirements(config(), prForReviews())).rejects.toThrow('could not reach Azure DevOps');
});

test('a later review-policy page failure does not return the first page as complete', async () => {
  stubFetch(url => new URL(url).searchParams.get('$skip') === '0'
    ? {body: {value: Array.from({length: 100}, (_, i) => ({evaluationId: `optional-${i}`, configuration: {isBlocking: false}}))}}
    : {status: 503});
  await expect(getReviewRequirements(config(), prForReviews())).rejects.toThrow(ApiError);
});

test('repeated evaluation pages fail safely instead of looping forever or claiming completeness', async () => {
  stubFetch(() => ({
    body: {value: Array.from({length: 100}, (_, i) => ({evaluationId: `optional-${i}`, configuration: {isBlocking: false}}))},
  }));
  await expect(getReviewRequirements(config(), prForReviews())).rejects.toThrow('repeated a page');
  expect(calls).toHaveLength(2);
});

test('active PR listing pages each project before applying repository filters', async () => {
  stubFetch(url => {
    const skip = Number(new URL(url).searchParams.get('$skip'));
    const offset = url.includes('/platform/') ? 0 : 10;
    return {
      body: {
        value: skip === 0
          ? [prForReviews({pullRequestId: offset + 1}), prForReviews({pullRequestId: offset + 2})]
          : [prForReviews({pullRequestId: offset + 3, repository: {name: 'wanted'}})],
      },
    };
  });
  const c = config();
  c.projects = ['platform', 'payments'];
  c.repos = ['wanted'];
  expect((await listActivePullRequests(c, 2)).map(pr => [pr.project, pr.pullRequestId])).toEqual([
    ['platform', 3], ['payments', 13],
  ]);
  expect(calls).toHaveLength(4);
  expect(calls.filter(call => new URL(call.url).searchParams.get('$skip') === '2')).toHaveLength(2);
});

test('default active PR listing reads more than 200 rows', async () => {
  stubFetch(url => ({
    body: {
      value: new URL(url).searchParams.get('$skip') === '0'
        ? Array.from({length: 200}, (_, i) => prForReviews({pullRequestId: i + 1}))
        : [prForReviews({pullRequestId: 201})],
    },
  }));
  expect(await listActivePullRequests(config())).toHaveLength(201);
  expect(calls).toHaveLength(2);
});

test('top=1 validation stays a single request, with an explicit opt-in to pagination', async () => {
  stubFetch(url => ({body: {value: new URL(url).searchParams.get('$skip') === '0' ? [prForReviews()] : []}}));
  expect(await listActivePullRequests(config(), 1)).toHaveLength(1);
  expect(calls).toHaveLength(1);
  calls = [];
  expect(await listActivePullRequests(config(), 1, true)).toHaveLength(1);
  expect(calls).toHaveLength(2);
});

test('PR list retains description, branch names, stable repository/project identity and required metadata', async () => {
  const expected = prForReviews({
    description: '# Context\nReview carefully.',
    reviewers: [{id: 'group', vote: 5, isContainer: true, isRequired: true}],
  });
  stubFetch(() => ({body: {value: [expected]}}));
  expect((await listActivePullRequests(config()))[0]).toEqual(expected);
});

test('individual PR details return descriptions beyond the list limit and preserve the project tag', async () => {
  const description = '# Full description\n' + 'Longer review context.\n'.repeat(100);
  const expected = prForReviews({
    description,
    reviewers: [{id: 'required-team', vote: 5, isRequired: true, isContainer: true}],
  });
  stubFetch(() => ({body: {...expected, project: 'not-the-local-tag'}}));

  const base = prForReviews({description: description.slice(0, 400)});
  const details = await getPullRequestDetails(config(), base);
  expect(details).toEqual(expected);
  expect(details.description!.length).toBeGreaterThan(400);
  expect(base.description).toHaveLength(400);
  expect(calls).toHaveLength(1);
  expect(new URL(calls[0]!.url).pathname).toBe(`/myorg/${PROJECT_ID}/_apis/git/repositories/repo-guid/pullrequests/7`);
  expect(new URL(calls[0]!.url).searchParams.get('api-version')).toBe('7.1');
});

test('individual PR details encode names when stable repository/project IDs are unavailable', async () => {
  const base = prForDiff({project: 'A project', repository: {name: 'repo/name'}});
  stubFetch(() => ({body: base}));
  const c = config();
  c.org = 'an org';
  expect(await getPullRequestDetails(c, base)).toEqual(base);
  expect(calls[0]!.url).toContain('/an%20org/A%20project/_apis/git/repositories/repo%2Fname/pullrequests/7');
});

test('individual PR details do not resurrect a removed description from the list snapshot', async () => {
  const base = prForReviews({description: 'Older list description'});
  for (const description of ['', undefined]) {
    stubFetch(() => ({body: prForReviews({description})}));
    expect((await getPullRequestDetails(config(), base)).description ?? '').toBe('');
  }
});

test('individual PR detail failures and malformed or mismatched responses propagate', async () => {
  stubFetch(() => ({status: 503}));
  await expect(getPullRequestDetails(config(), prForReviews())).rejects.toThrow(ApiError);
  for (const body of [{}, {value: []}, prForReviews({pullRequestId: 8}), {...prForReviews(), description: 42}]) {
    stubFetch(() => ({body}));
    await expect(getPullRequestDetails(config(), prForReviews())).rejects.toThrow('invalid pull request details');
  }
});
