import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_VERSION = 1;
export const MIN_REFRESH_SECONDS = 15;

export type AuthMode = 'pat' | 'az-cli';
export type TeamMode = 'manual' | 'group';

export interface Config {
  version: number;
  org: string;
  projects: string[];
  repos: string[];
  auth: {
    mode: AuthMode;
    /** null when there is nothing stored: az-cli mode, or the PAT comes from FPR_PAT. */
    pat: string | null;
    /**
     * az-cli only. Entra tenant id to issue the token for; null lets az use the tenant of
     * the active subscription, which is right unless the organization is backed by a
     * different one (a guest or consultant account).
     */
    tenant: string | null;
  };
  team: {
    mode: TeamMode;
    groupDescriptor: string | null;
    groupDisplayName: string | null;
    members: string[];
  };
  ui: {
    hideReviewed: boolean;
    dedupeAssignedFromTeamSection: boolean;
    refreshSeconds: number;
    /** Draft PRs are rarely what "what needs my review" means. */
    hideDrafts: boolean;
    /** Renovate-style dependency bumps drown out human PRs. */
    hideBots: boolean;
    /**
     * Author names counted as bots; matched as a case-insensitive substring.
     * Empty by default — bot accounts are named differently in every organization,
     * so this is filled in from the settings screen.
     */
    botAuthors: string[];
  };
}

export interface LoadResult {
  config: Config;
  valid: boolean;
  /** Human-readable reason the config could not be used. Absent on a clean first run. */
  error?: string;
}

export function defaultConfig(): Config {
  return {
    version: CONFIG_VERSION,
    org: '',
    projects: [],
    repos: ['all'],
    auth: {mode: 'pat', pat: null, tenant: null},
    team: {mode: 'manual', groupDescriptor: null, groupDisplayName: null, members: []},
    ui: {
      hideReviewed: false,
      dedupeAssignedFromTeamSection: true,
      refreshSeconds: 45,
      hideDrafts: true,
      hideBots: true,
      botAuthors: [],
    },
  };
}

/** `%APPDATA%\fancy-pr-dashboard\config.json` on Windows, `~/.config/...` elsewhere. */
export function configPath(): string {
  const dir =
    process.platform === 'win32' && process.env.APPDATA
      ? path.join(process.env.APPDATA, 'fancy-pr-dashboard')
      : path.join(os.homedir(), '.config', 'fancy-pr-dashboard');
  return path.join(dir, 'config.json');
}

/** The PAT in use: FPR_PAT wins over the stored one so the secret can stay out of the file. */
export function effectivePat(config: Config): string | null {
  return process.env.FPR_PAT || config.auth.pat || null;
}

export function patFromEnv(): boolean {
  return Boolean(process.env.FPR_PAT);
}

export function isValid(config: Config): boolean {
  if (config.version !== CONFIG_VERSION) return false;
  if (!config.org.trim()) return false;
  if (config.projects.length === 0) return false;
  // az-cli carries no stored credential; whether the login works is a live check.
  if (config.auth.mode === 'az-cli') return true;
  return Boolean(effectivePat(config));
}

export async function loadConfig(file: string = configPath()): Promise<LoadResult> {
  let raw: unknown;
  try {
    raw = await Bun.file(file).json();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {config: defaultConfig(), valid: false};
    }
    return {config: defaultConfig(), valid: false, error: 'config file is unreadable or not valid JSON — starting from defaults'};
  }

  const config = normalize(raw);
  if (config.version !== CONFIG_VERSION) {
    return {config, valid: false, error: `config version ${config.version} is not supported (expected ${CONFIG_VERSION})`};
  }
  return {config, valid: isValid(config)};
}

export async function saveConfig(config: Config, file: string = configPath()): Promise<void> {
  const onDisk: Config = {
    ...normalize(config),
    // Never persist a secret that came from the environment.
    auth: {...config.auth, pat: patFromEnv() ? null : config.auth.pat},
  };

  fs.mkdirSync(path.dirname(file), {recursive: true});
  const tmp = `${file}.tmp`;
  await Bun.write(tmp, `${JSON.stringify(onDisk, null, 2)}\n`);
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows has no POSIX modes; a failed chmod must not fail the save.
  }
}

/** Tolerant merge of an arbitrary parsed JSON value onto the defaults. */
export function normalize(raw: unknown): Config {
  const base = defaultConfig();
  if (!isRecord(raw)) return base;

  const auth = isRecord(raw.auth) ? raw.auth : {};
  const team = isRecord(raw.team) ? raw.team : {};
  const ui = isRecord(raw.ui) ? raw.ui : {};

  return {
    version: typeof raw.version === 'number' ? raw.version : base.version,
    org: str(raw.org, base.org),
    projects: strArray(raw.projects, base.projects),
    repos: strArray(raw.repos, base.repos),
    auth: {
      mode: auth.mode === 'az-cli' ? 'az-cli' : 'pat',
      pat: typeof auth.pat === 'string' && auth.pat.length > 0 ? auth.pat : null,
      tenant: typeof auth.tenant === 'string' && auth.tenant.trim().length > 0 ? auth.tenant.trim() : null,
    },
    team: {
      mode: team.mode === 'group' ? 'group' : 'manual',
      groupDescriptor: typeof team.groupDescriptor === 'string' ? team.groupDescriptor : null,
      groupDisplayName: typeof team.groupDisplayName === 'string' ? team.groupDisplayName : null,
      members: strArray(team.members, base.team.members),
    },
    ui: {
      hideReviewed: typeof ui.hideReviewed === 'boolean' ? ui.hideReviewed : base.ui.hideReviewed,
      dedupeAssignedFromTeamSection:
        typeof ui.dedupeAssignedFromTeamSection === 'boolean'
          ? ui.dedupeAssignedFromTeamSection
          : base.ui.dedupeAssignedFromTeamSection,
      refreshSeconds: clampRefresh(ui.refreshSeconds, base.ui.refreshSeconds),
      hideDrafts: typeof ui.hideDrafts === 'boolean' ? ui.hideDrafts : base.ui.hideDrafts,
      hideBots: typeof ui.hideBots === 'boolean' ? ui.hideBots : base.ui.hideBots,
      // An explicitly empty list is a real choice; only a missing/invalid one falls back.
      botAuthors: Array.isArray(ui.botAuthors) ? strArray(ui.botAuthors, base.ui.botAuthors) : base.ui.botAuthors,
    },
  };
}

export function clampRefresh(value: unknown, fallback = 45): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(MIN_REFRESH_SECONDS, Math.round(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function strArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean);
  return items;
}
