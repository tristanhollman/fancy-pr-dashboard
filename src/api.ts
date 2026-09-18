import {getAzAccessToken, resetAzTokenCache} from './azcli.ts';
import {effectivePat, type Config} from './config.ts';
import {ApiError} from './errors.ts';
import {summarizeReviewRequirements, unknownReviewRequirements, type AdoPolicyEvaluation, type ReviewRequirements} from './reviews.ts';

export {ApiError} from './errors.ts';
export type {ReviewRequirements} from './reviews.ts';

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
  isRequired?: boolean;
}

export interface AdoPullRequest {
  pullRequestId: number;
  title: string;
  description?: string;
  creationDate: string;
  createdBy: AdoIdentityRef;
  isDraft?: boolean;
  sourceRefName?: string;
  targetRefName?: string;
  lastMergeSourceCommit?: {commitId?: string};
  lastMergeTargetCommit?: {commitId?: string};
  repository: {id?: string; name: string; project?: {id?: string; name?: string}};
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

/**
 * A PAT hits the network directly, unlike az-cli which fails fast locally when there is
 * no login — so a wrong org, a firewall, or a VPN that is not up would otherwise hang
 * the request (and, since settings blocks input while validating, the whole screen)
 * forever with no feedback at all.
 */
const REQUEST_TIMEOUT_MS = 15_000;

async function apiFetch<T>(url: string, config: Config): Promise<T> {
  // Resolved outside the try so an auth failure is not reported as a network failure.
  const authorization = await authHeader(config);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {Authorization: authorization, Accept: 'application/json'},
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new ApiError(0, `Azure DevOps did not respond within ${REQUEST_TIMEOUT_MS / 1000}s — check the organization name and your network/VPN`);
    }
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
 * Active PRs across every configured project, including subsequent pages.
 * `top=1` keeps settings validation to one request per project. Other values set
 * the page size; pass `allPages` explicitly to override that validation shortcut.
 */
export async function listActivePullRequests(config: Config, top = 200, allPages = top !== 1): Promise<TaggedPullRequest[]> {
  if (!Number.isSafeInteger(top) || top < 1) throw new ApiError(0, 'pull request page size must be a positive integer');
  const perProject = await Promise.all(
    config.projects.map(async project => {
      const prs = await fetchPages<AdoPullRequest>(
        skip =>
          `${DEV_HOST}/${encodeURIComponent(config.org)}/${encodeURIComponent(project)}/_apis/git/pullrequests` +
          `?searchCriteria.status=active&$top=${top}&$skip=${skip}&api-version=${API_VERSION}`,
        config,
        top,
        allPages,
      );
      return prs.map(pr => ({...pr, project}));
    }),
  );

  const all = perProject.flat();
  if (wantsAllRepos(config.repos)) return all;

  const wanted = new Set(config.repos.map(r => r.toLowerCase()));
  return all.filter(pr => wanted.has(pr.repository.name.toLowerCase()));
}

/**
 * The list API truncates descriptions to 400 characters; this endpoint returns
 * the individual PR, including its full description. The caller owns caching.
 * https://learn.microsoft.com/rest/api/azure/devops/git/pull-requests/get-pull-request
 */
export async function getPullRequestDetails(config: Config, pr: TaggedPullRequest): Promise<TaggedPullRequest> {
  if (!Number.isSafeInteger(pr.pullRequestId) || pr.pullRequestId < 1) {
    throw new ApiError(0, 'the pull request has no valid ID');
  }
  const project = pr.repository.project?.id || pr.project;
  const repository = pr.repository.id || pr.repository.name;
  const url =
    `${DEV_HOST}/${encodeURIComponent(config.org)}/${encodeURIComponent(project)}` +
    `/_apis/git/repositories/${encodeURIComponent(repository)}/pullrequests/${pr.pullRequestId}?api-version=${API_VERSION}`;
  const details = await apiFetch<AdoPullRequest | null>(url, config);
  if (!details || details.pullRequestId !== pr.pullRequestId ||
      typeof details.title !== 'string' || typeof details.creationDate !== 'string' ||
      typeof details.createdBy?.id !== 'string' || typeof details.repository?.name !== 'string' ||
      (details.description != null && typeof details.description !== 'string')) {
    throw new ApiError(0, 'Azure DevOps returned invalid pull request details');
  }
  return {...details, project: pr.project};
}

async function fetchPages<T>(url: (skip: number) => string, config: Config, top: number, allPages = true): Promise<T[]> {
  const values: T[] = [];
  const seen = new Set<string>();
  for (;;) {
    const body = await apiFetch<{value?: T[]} | null>(url(values.length), config);
    if (!Array.isArray(body?.value)) {
      throw new ApiError(0, 'Azure DevOps returned an invalid list response — expected a value array');
    }
    const page = body.value;
    if (page.length === 0) return values;
    const signature = JSON.stringify(page);
    if (seen.has(signature)) throw new ApiError(0, 'Azure DevOps repeated a page — the complete result could not be read');
    seen.add(signature);
    values.push(...page);
    if (!allPages || page.length < top) return values;
  }
}

/**
 * Applicable, blocking review policies only; this is not overall merge readiness.
 * Evaluations use a project GUID in the artifact, not the configured project name.
 * https://learn.microsoft.com/rest/api/azure/devops/policy/evaluations/list
 */
export async function getReviewRequirements(config: Config, pr: TaggedPullRequest): Promise<ReviewRequirements> {
  const projectId = pr.repository.project?.id;
  if (!projectId || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(projectId)) {
    return unknownReviewRequirements('The pull request has no project GUID; review policies could not be read.');
  }
  if (!Number.isSafeInteger(pr.pullRequestId) || pr.pullRequestId < 1) {
    return unknownReviewRequirements('The pull request has no valid ID; review policies could not be read.');
  }
  const top = 100;
  const evaluations = await fetchPages<AdoPolicyEvaluation>(
    skip => {
      const params = new URLSearchParams({
        artifactId: `vstfs:///CodeReview/CodeReviewId/${projectId}/${pr.pullRequestId}`,
        includeNotApplicable: 'true',
        $top: String(top),
        $skip: String(skip),
        'api-version': '7.1-preview.1',
      });
      return `${DEV_HOST}/${encodeURIComponent(config.org)}/${encodeURIComponent(projectId)}/_apis/policy/evaluations?${params}`;
    },
    config,
    top,
  );
  return summarizeReviewRequirements(pr, evaluations);
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
