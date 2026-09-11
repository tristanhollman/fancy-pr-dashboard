import {afterEach, beforeEach, expect, test} from 'bun:test';
import {ApiError, getChangedFileCount, getMe, listActivePullRequests, resetIdentityCache, type TaggedPullRequest} from './api.ts';
import {resetAzTokenCache, setAzRunner} from './azcli.ts';
import {defaultConfig, type Config} from './config.ts';

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
