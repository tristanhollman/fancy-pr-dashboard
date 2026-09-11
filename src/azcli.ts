import {$} from 'bun';
import {ApiError} from './errors.ts';

/**
 * Azure DevOps' resource id in Entra ID. It is a fixed, well-known GUID — the same in
 * every tenant — so there is nothing to configure here.
 */
const ADO_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';

/**
 * Renew this far ahead of the stated expiry. An az token lives about an hour, and a
 * refresh cycle that starts seconds before expiry would send a token that dies in flight.
 */
const RENEW_EARLY_MS = 5 * 60_000;

/** Used only when az reports no expiry at all; comfortably inside the usual ~60 minutes. */
const ASSUMED_LIFETIME_MS = 50 * 60_000;

export interface AzResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type AzRunner = (resource: string, tenant: string | null) => Promise<AzResult>;

/**
 * `.quiet()` is load-bearing, not tidiness: without it Bun streams az's stdout — the
 * access token — straight to the terminal Ink is drawing on.
 *
 * The tenant array interpolates as separate, escaped arguments, and disappears entirely
 * when empty — so an unset tenant leaves az on its own default.
 */
const runAz: AzRunner = async (resource, tenant) => {
  const scope = tenant ? ['--tenant', tenant] : [];
  const result = await $`az account get-access-token --resource ${resource} ${scope} --output json`.nothrow().quiet();
  return {exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString()};
};

let runner: AzRunner = runAz;

/** Test hook: swap the process launch for a canned result. Pass nothing to restore az. */
export function setAzRunner(next?: AzRunner): void {
  runner = next ?? runAz;
}

interface CachedToken {
  token: string;
  /** Epoch ms at which the token should stop being reused. */
  renewAt: number;
  /** The tenant it was issued for; a different one needs a different token. */
  tenant: string | null;
}

let cached: CachedToken | undefined;

/** Drop the cached token so the next call shells out again (after `az login`, or a 401). */
export function resetAzTokenCache(): void {
  cached = undefined;
}

interface AzTokenPayload {
  accessToken?: string;
  /** Epoch seconds. Present on modern az; the only expiry field that carries a timezone. */
  expires_on?: number;
  /** Local time, no offset: "2026-09-11 14:32:01.000000". Parsed as local time. */
  expiresOn?: string;
  tokenType?: string;
}

/**
 * az reports failure in prose on stderr. The two cases worth naming are "az is not
 * installed" and "nobody is logged in"; everything else is passed through so the user
 * sees az's own words rather than our guess at them.
 */
function explain(result: AzResult, tenant: string | null): string {
  const stderr = result.stderr.replace(/\s+/g, ' ').trim();
  const lower = stderr.toLowerCase();

  if (lower.includes('command not found') || lower.includes('not recognized') || lower.includes('enoent')) {
    return 'the az CLI is not installed or not on PATH — install it, or switch auth mode to pat';
  }
  if (lower.includes('az login') || lower.includes('not logged in') || lower.includes('no subscription')) {
    return tenant
      ? `not signed in to the az CLI for tenant ${tenant} — run \`az login --tenant ${tenant}\`, then try again`
      : 'not signed in to the az CLI — run `az login`, then try again';
  }
  const trimmed = stderr.length > 300 ? `${stderr.slice(0, 300)}…` : stderr;
  return trimmed ? `az could not issue a token — ${trimmed}` : `az exited with code ${result.exitCode} and said nothing`;
}

function expiryOf(payload: AzTokenPayload, now: number): number {
  if (typeof payload.expires_on === 'number' && Number.isFinite(payload.expires_on)) {
    return payload.expires_on * 1000;
  }
  if (typeof payload.expiresOn === 'string') {
    const parsed = Date.parse(payload.expiresOn);
    if (Number.isFinite(parsed)) return parsed;
  }
  return now + ASSUMED_LIFETIME_MS;
}

/**
 * An Entra access token for Azure DevOps, taken from the signed-in az CLI and cached
 * until shortly before it expires. Unlike a PAT this is short-lived, so every caller
 * goes through here rather than holding onto the string.
 *
 * `tenant` is normally null: az issues the token for whichever tenant the active
 * subscription belongs to. It matters when the organization is backed by a different
 * Entra tenant than that default — a guest or consultant account — where az would
 * otherwise hand back a perfectly valid token that Azure DevOps answers with a 401.
 */
export async function getAzAccessToken(tenant: string | null = null): Promise<string> {
  const now = Date.now();
  if (cached && cached.tenant === tenant && now < cached.renewAt) return cached.token;

  let result: AzResult;
  try {
    result = await runner(ADO_RESOURCE, tenant);
  } catch (error) {
    // Bun.$ still throws if the process cannot be spawned at all.
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiError(0, explain({exitCode: 1, stdout: '', stderr: message}, tenant));
  }

  if (result.exitCode !== 0) throw new ApiError(0, explain(result, tenant));

  let payload: AzTokenPayload;
  try {
    payload = JSON.parse(result.stdout) as AzTokenPayload;
  } catch {
    // Never include stdout in the message — on a partial success it holds the token.
    throw new ApiError(0, 'az returned something that is not JSON — check `az account get-access-token` by hand');
  }

  const token = payload.accessToken?.trim();
  if (!token) throw new ApiError(0, 'az returned no access token — check `az account get-access-token` by hand');

  const renewAt = Math.max(now, expiryOf(payload, now) - RENEW_EARLY_MS);
  cached = {token, renewAt, tenant};
  return token;
}
