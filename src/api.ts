import {getAzAccessToken, resetAzTokenCache} from './azcli.ts';
import {effectivePat, type Config} from './config.ts';
import {ApiError} from './errors.ts';

export {ApiError} from './errors.ts';

const API_VERSION = '7.1';
/** connectionData is only published as a preview API; `7.1` gets "version out of range". */
const CONNECTION_DATA_API_VERSION = '7.1-preview.1';
const DEV_HOST = 'https://dev.azure.com';

/** Fields we actually read. Everything else in the payload is ignored. */
export interface AdoIdentityRef {
  id: string;
  displayName?: string;
  uniqueName?: string;
  descriptor?: string;
}

export interface AdoReviewer extends AdoIdentityRef {
  vote: number;
  isContainer?: boolean;
}

export interface AdoPullRequest {
  pullRequestId: number;
  title: string;
  creationDate: string;
  createdBy: AdoIdentityRef;
  isDraft?: boolean;
  sourceRefName?: string;
  targetRefName?: string;
  lastMergeSourceCommit?: {commitId?: string};
  lastMergeTargetCommit?: {commitId?: string};
  repository: {id?: string; name: string; project?: {name?: string}};
  reviewers?: AdoReviewer[];
  _links?: {web?: {href?: string}};
}

/** A PR tagged with the project it was fetched from. */
export type TaggedPullRequest = AdoPullRequest & {project: string};

export interface Identity {
  id: string;
  displayName: string;
  uniqueName: string;
}

/**
 * Never returns or embeds the credential itself — only the header value, which is never
 * logged. A PAT is basic auth with an empty username; an az token is a bearer token.
 */
async function authHeader(config: Config): Promise<string> {
  if (config.auth.mode === 'az-cli') {
    return `Bearer ${await getAzAccessToken(config.auth.tenant)}`;
  }
  // Trimmed: a token pasted with a stray newline or space authenticates as garbage.
  const pat = effectivePat(config)?.trim();
  if (!pat) {
    throw new ApiError(0, 'no PAT configured — add one in settings or set FPR_PAT');
  }
  return `Basic ${btoa(`:${pat}`)}`;
}

function describe(status: number, config: Config): string {
  const az = config.auth.mode === 'az-cli';
  if (status === 401)
    return az
      ? 'authentication rejected — the az login may have expired, or the token was issued for the wrong Entra tenant; run `az login`, and set the tenant in settings if this organization lives in another one'
      : 'authentication rejected — the PAT may be expired, scoped to a different organization, or blocked by an org PAT policy';
  if (status === 403)
    return az
      ? 'access denied — this az identity cannot read code in this organization'
      : 'access denied — the PAT needs the Code: Read scope';
  if (status === 404) return 'not found — check the organization and project names';
  if (status === 400) return 'Azure DevOps rejected the request';
  if (status === 429) return 'rate limited by Azure DevOps — try again in a moment';
  if (status >= 500) return 'Azure DevOps is unavailable right now';
  return `unexpected response from Azure DevOps (HTTP ${status})`;
}

/**
 * Azure DevOps explains most 4xx failures in the body (`{message: "..."}`), and that text is
 * far more useful than our status guess — a version mismatch and a malformed query are both
 * plain 400s. The body is ADO's own prose about the request; it never contains our header.
 */
async function detail(response: Response): Promise<string> {
  try {
    const body = await response.text();
    let found = body;
    try {
      const parsed: unknown = JSON.parse(body);
      // A JSON error object without a `message` says nothing worth showing.
      found =
        typeof parsed === 'object' && parsed !== null && 'message' in parsed && typeof parsed.message === 'string'
          ? parsed.message
          : '';
    } catch {
      // Not JSON (an HTML error page): fall through to the raw text.
    }
    const cleaned = found.replace(/\s+/g, ' ').trim();
    return cleaned.length > 300 ? `${cleaned.slice(0, 300)}…` : cleaned;
  } catch {
    return '';
  }
}

async function apiFetch<T>(url: string, config: Config): Promise<T> {
  // Resolved outside the try so an auth failure is not reported as a network failure.
  const authorization = await authHeader(config);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {Authorization: authorization, Accept: 'application/json'},
    });
  } catch (error) {
    // Network-level failure: message comes from fetch, never from our headers.
    throw new ApiError(0, `could not reach Azure DevOps (${error instanceof Error ? error.message : 'network error'})`);
  }

  // An az token can expire mid-session; drop it so a retry fetches a fresh one.
  if ((response.status === 401 || response.status === 203) && config.auth.mode === 'az-cli') resetAzTokenCache();

  // Azure DevOps answers a rejected token with 203 and a sign-in page, not a 401.
  if (response.status === 203) throw new ApiError(401, describe(401, config));
  if (!response.ok) {
    const explanation = await detail(response);
    const reason = describe(response.status, config);
    throw new ApiError(response.status, explanation ? `${reason} — ${explanation}` : reason);
  }

  // An HTML body with a 200 means the org name resolved to a sign-in page, not an API.
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(response.status, 'Azure DevOps returned a non-JSON response — check the organization name');
  }
}

export function pullRequestWebUrl(org: string, pr: TaggedPullRequest): string {
  return (
    pr._links?.web?.href ??
    `${DEV_HOST}/${encodeURIComponent(org)}/${encodeURIComponent(pr.project)}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`
  );
}

function wantsAllRepos(repos: string[]): boolean {
  return repos.length === 0 || repos.some(r => r.toLowerCase() === 'all');
}

/**
 * Active PRs across every configured project, one request per project.
 * `top` exists so settings validation can ask for a single row.
 */
export async function listActivePullRequests(config: Config, top = 200): Promise<TaggedPullRequest[]> {
  const perProject = await Promise.all(
    config.projects.map(async project => {
      const url =
        `${DEV_HOST}/${encodeURIComponent(config.org)}/${encodeURIComponent(project)}/_apis/git/pullrequests` +
        `?searchCriteria.status=active&$top=${top}&api-version=${API_VERSION}`;
      const body = await apiFetch<{value?: AdoPullRequest[]}>(url, config);
      return (body.value ?? []).map(pr => ({...pr, project}));
    }),
  );

  const all = perProject.flat();
  if (wantsAllRepos(config.repos)) return all;

  const wanted = new Set(config.repos.map(r => r.toLowerCase()));
  return all.filter(pr => wanted.has(pr.repository.name.toLowerCase()));
}

/** Hard cap on entries asked for per diff; anything past this is reported as "N+". */
const CHANGES_TOP = 1000;

interface DiffResponse {
  allChangesIncluded?: boolean;
  changeCounts?: Record<string, number>;
  changes?: Array<{item?: {isFolder?: boolean}}>;
}

export interface FileCount {
  files: number;
  /** The diff was longer than one page; `files` is a floor, not the total. */
  truncated: boolean;
}

function branch(ref: string | undefined): string | undefined {
  return ref?.replace(/^refs\/heads\//, '');
}

/**
 * Number of changed files in a PR. The PR list payload does not carry it, and the
 * iterations/changes route needs two requests per PR, so this uses the commit diff:
 * one request, and `diffCommonCommit` makes it the three-dot diff a PR actually shows.
 * Folder entries are dropped — Azure DevOps lists directories alongside files.
 */
export async function getChangedFileCount(config: Config, pr: TaggedPullRequest): Promise<FileCount> {
  const repository = pr.repository.id ?? pr.repository.name;
  const base = pr.lastMergeTargetCommit?.commitId;
  const target = pr.lastMergeSourceCommit?.commitId;
  const useCommits = Boolean(base && target);

  const params = new URLSearchParams({
    baseVersionType: useCommits ? 'commit' : 'branch',
    baseVersion: (useCommits ? base : branch(pr.targetRefName)) ?? '',
    targetVersionType: useCommits ? 'commit' : 'branch',
    targetVersion: (useCommits ? target : branch(pr.sourceRefName)) ?? '',
    diffCommonCommit: 'true',
    $top: String(CHANGES_TOP),
    'api-version': API_VERSION,
  });

  const url =
    `${DEV_HOST}/${encodeURIComponent(config.org)}/${encodeURIComponent(pr.project)}` +
    `/_apis/git/repositories/${encodeURIComponent(repository)}/diffs/commits?${params.toString()}`;

  const diff = await apiFetch<DiffResponse>(url, config);

  if (diff.changes) {
    const files = diff.changes.filter(change => !change.item?.isFolder).length;
    return {files, truncated: diff.allChangesIncluded === false};
  }

  // No `changes` array (some responses only summarise): fall back to the type counts.
  const files = Object.values(diff.changeCounts ?? {}).reduce((sum, n) => sum + n, 0);
  return {files, truncated: diff.allChangesIncluded === false};
}

let cachedMe: Identity | undefined;

interface ConnectionData {
  authenticatedUser?: {
    id?: string;
    providerDisplayName?: string;
    properties?: {Account?: {$value?: string}};
  };
}

/**
 * The signed-in identity, cached for the process lifetime.
 *
 * Deliberately NOT `app.vssps.visualstudio.com/_apis/profile/profiles/me`: that endpoint
 * needs the User Profile (read) scope, so a Code-only PAT gets a 401 there and the failure
 * reads like a bad token. `connectionData` sits on the same host as the PR calls and needs
 * nothing beyond access to the organization, and its `authenticatedUser.id` is the identity
 * id that PR `createdBy`/`reviewers[]` entries use.
 */
export async function getMe(config: Config): Promise<Identity> {
  if (cachedMe) return cachedMe;
  const data = await apiFetch<ConnectionData>(
    `${DEV_HOST}/${encodeURIComponent(config.org)}/_apis/connectionData?api-version=${CONNECTION_DATA_API_VERSION}`,
    config,
  );
  const user = data.authenticatedUser;
  if (!user?.id) {
    throw new ApiError(0, 'signed in, but Azure DevOps returned no identity for this token');
  }
  cachedMe = {
    id: user.id,
    displayName: user.providerDisplayName ?? '',
    uniqueName: user.properties?.Account?.$value ?? '',
  };
  return cachedMe;
}

/** Test/settings hook: drop the identity cache so a new PAT resolves a new user. */
export function resetIdentityCache(): void {
  cachedMe = undefined;
}
