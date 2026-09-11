import {afterEach, expect, test} from 'bun:test';
import {ApiError} from './errors.ts';
import {getAzAccessToken, resetAzTokenCache, setAzRunner, type AzResult} from './azcli.ts';

interface Invocation {
  resource: string;
  tenant: string | null;
}

let invocations: Invocation[] = [];

/** Stands in for the az process; records what it was asked for. */
function stubAz(respond: () => AzResult | Promise<AzResult>) {
  invocations = [];
  setAzRunner(async (resource, tenant) => {
    invocations.push({resource, tenant});
    return respond();
  });
}

function ok(token: string, extra: Record<string, unknown> = {}): AzResult {
  return {exitCode: 0, stdout: JSON.stringify({accessToken: token, tokenType: 'Bearer', ...extra}), stderr: ''};
}

function failed(stderr: string): AzResult {
  return {exitCode: 1, stdout: '', stderr};
}

afterEach(() => {
  setAzRunner();
  resetAzTokenCache();
});

test('the token is requested for the Azure DevOps resource id', async () => {
  stubAz(() => ok('az-token', {expires_on: Math.floor(Date.now() / 1000) + 3600}));

  expect(await getAzAccessToken()).toBe('az-token');
  // A fixed, Microsoft-owned first-party app id — the same in every tenant.
  expect(invocations).toEqual([{resource: '499b84ac-1321-427f-aa17-267ca6975798', tenant: null}]);
});

test('no tenant is asked for by default, so az uses its own', async () => {
  stubAz(() => ok('az-token'));

  await getAzAccessToken();
  expect(invocations[0]?.tenant).toBeNull();
});

test('a configured tenant is passed through to az', async () => {
  stubAz(() => ok('az-token'));

  await getAzAccessToken('contoso-tenant-id');
  expect(invocations[0]?.tenant).toBe('contoso-tenant-id');
});

test('a token cached for one tenant is not handed to another', async () => {
  let issued = 0;
  stubAz(() => ok(`token-${++issued}`, {expires_on: Math.floor(Date.now() / 1000) + 3600}));

  expect(await getAzAccessToken('tenant-a')).toBe('token-1');
  expect(await getAzAccessToken('tenant-a')).toBe('token-1');
  expect(await getAzAccessToken('tenant-b')).toBe('token-2');
  expect(await getAzAccessToken(null)).toBe('token-3');
  expect(invocations.map(i => i.tenant)).toEqual(['tenant-a', 'tenant-b', null]);
});

test('a signed-out tenant is named in the az login command to run', async () => {
  stubAz(() => failed("ERROR: Please run 'az login' to setup account."));

  await expect(getAzAccessToken('contoso-tenant-id')).rejects.toThrow('az login --tenant contoso-tenant-id');
});

test('a live token is reused instead of shelling out again', async () => {
  stubAz(() => ok('az-token', {expires_on: Math.floor(Date.now() / 1000) + 3600}));

  await getAzAccessToken();
  await getAzAccessToken();
  expect(invocations).toHaveLength(1);

  resetAzTokenCache();
  await getAzAccessToken();
  expect(invocations).toHaveLength(2);
});

test('a token inside the renewal window is not reused — unlike a PAT it expires', async () => {
  let issued = 0;
  // Two minutes of life left: past the five-minute renewal margin, so never cached.
  stubAz(() => ok(`token-${++issued}`, {expires_on: Math.floor(Date.now() / 1000) + 120}));

  expect(await getAzAccessToken()).toBe('token-1');
  expect(await getAzAccessToken()).toBe('token-2');
  expect(invocations).toHaveLength(2);
});

test('expires_on wins over the timezone-less expiresOn string', async () => {
  stubAz(() =>
    ok('az-token', {
      expires_on: Math.floor(Date.now() / 1000) + 3600,
      // Long expired, and written in local time with no offset — the trap this avoids.
      expiresOn: '2020-01-01 00:00:00.000000',
    }),
  );

  await getAzAccessToken();
  await getAzAccessToken();
  expect(invocations).toHaveLength(1);
});

test('a response with no expiry at all is still cached for a while', async () => {
  stubAz(() => ok('az-token'));

  await getAzAccessToken();
  await getAzAccessToken();
  expect(invocations).toHaveLength(1);
});

test('a missing az CLI says so instead of quoting the shell', async () => {
  stubAz(() => failed('bash: line 1: az: command not found'));

  const failure = (await getAzAccessToken().catch((error: unknown) => error)) as ApiError;
  expect(failure).toBeInstanceOf(ApiError);
  expect(failure.message).toContain('not installed');
  expect(failure.message).toContain('pat');
});

test('a signed-out az CLI points at az login', async () => {
  stubAz(() => failed("ERROR: Please run 'az login' to setup account."));

  await expect(getAzAccessToken()).rejects.toThrow('az login');
});

test('any other az failure passes az\'s own words through', async () => {
  stubAz(() => failed('ERROR: AADSTS50076: multi-factor authentication is required.'));

  await expect(getAzAccessToken()).rejects.toThrow('AADSTS50076');
});

test('a failure to spawn az at all is reported, not thrown raw', async () => {
  setAzRunner(() => Promise.reject(new Error('spawn az ENOENT')));

  const failure = (await getAzAccessToken().catch((error: unknown) => error)) as ApiError;
  expect(failure).toBeInstanceOf(ApiError);
  expect(failure.message).toContain('not installed');
});

test('a non-JSON or token-less response never echoes stdout', async () => {
  stubAz(() => ({exitCode: 0, stdout: 'accessToken=secret-not-real', stderr: ''}));
  const nonJson = (await getAzAccessToken().catch((error: unknown) => error)) as ApiError;
  expect(nonJson.message).toContain('not JSON');
  expect(nonJson.message).not.toContain('secret-not-real');

  resetAzTokenCache();
  stubAz(() => ({exitCode: 0, stdout: JSON.stringify({tokenType: 'Bearer'}), stderr: ''}));
  await expect(getAzAccessToken()).rejects.toThrow('no access token');
});

test('a token is trimmed of the whitespace az can leave on it', async () => {
  stubAz(() => ok('  az-token\n'));
  expect(await getAzAccessToken()).toBe('az-token');
});
