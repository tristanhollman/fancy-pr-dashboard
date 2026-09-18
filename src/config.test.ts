import {afterEach, beforeEach, expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {clampRefresh, defaultConfig, defaultWorkspacePreferences, effectivePat, isValid, loadConfig, normalize, saveConfig} from './config.ts';

let dir: string;
let file: string;
const savedEnvPat = process.env.FPR_PAT;

beforeEach(() => {
  dir = path.join(process.cwd(), `.fpr-config-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir);
  file = path.join(dir, 'nested', 'config.json');
  delete process.env.FPR_PAT;
});

afterEach(() => {
  fs.rmSync(dir, {recursive: true, force: true});
  if (savedEnvPat === undefined) delete process.env.FPR_PAT;
  else process.env.FPR_PAT = savedEnvPat;
});

test('save then load round-trips, creating the parent directory', async () => {
  const config = defaultConfig();
  config.org = 'myorg';
  config.projects = ['platform', 'payments'];
  config.auth.pat = 'token-not-real';
  config.team.members = ['alice@co.com'];
  config.ui.hideReviewed = true;

  await saveConfig(config, file);
  const {config: loaded, valid, error} = await loadConfig(file);

  expect(error).toBeUndefined();
  expect(valid).toBe(true);
  expect(loaded).toEqual(config);
  expect(fs.existsSync(`${file}.tmp`)).toBe(false);
});

test('missing file yields defaults, invalid, and no error message', async () => {
  const result = await loadConfig(path.join(dir, 'absent.json'));
  expect(result.config).toEqual(defaultConfig());
  expect(result.valid).toBe(false);
  expect(result.error).toBeUndefined();
});

test('corrupt file yields defaults with an explanatory error', async () => {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, '{ this is not json');
  const result = await loadConfig(file);
  expect(result.config).toEqual(defaultConfig());
  expect(result.valid).toBe(false);
  expect(result.error).toContain('not valid JSON');
});

test('unknown version is not usable', async () => {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({version: 99, org: 'o', projects: ['p'], auth: {mode: 'pat', pat: 'x'}}));
  const result = await loadConfig(file);
  expect(result.valid).toBe(false);
  expect(result.error).toContain('version 99');
});

test('FPR_PAT wins over the stored PAT and is never written to disk', async () => {
  const config = defaultConfig();
  config.org = 'myorg';
  config.projects = ['platform'];
  config.auth.pat = 'stored-token';

  process.env.FPR_PAT = 'env-token';
  expect(effectivePat(config)).toBe('env-token');

  await saveConfig(config, file);
  const contents = fs.readFileSync(file, 'utf8');
  expect(contents).not.toContain('env-token');
  expect(contents).not.toContain('stored-token');
  expect(JSON.parse(contents).auth.pat).toBeNull();
});

test('FPR_PAT alone satisfies the validity gate', () => {
  const config = defaultConfig();
  config.org = 'myorg';
  config.projects = ['platform'];
  expect(isValid(config)).toBe(false);

  process.env.FPR_PAT = 'env-token';
  expect(isValid(config)).toBe(true);
});

test('validity needs org, at least one project, and auth', () => {
  const config = defaultConfig();
  expect(isValid(config)).toBe(false);

  config.org = 'myorg';
  expect(isValid(config)).toBe(false);

  config.projects = ['platform'];
  expect(isValid(config)).toBe(false); // no PAT yet

  config.auth.mode = 'az-cli';
  expect(isValid(config)).toBe(true); // az-cli needs no PAT
});

test('normalize repairs wrong types and drops junk entries', () => {
  const config = normalize({
    version: 1,
    org: '  myorg  ',
    projects: ['platform', '', 42, '  payments '],
    repos: 'nonsense',
    auth: {mode: 'weird', pat: ''},
    team: {mode: 'group', groupDescriptor: 'vssgp.abc', members: [null, 'bob@co.com']},
    ui: {hideReviewed: 'yes', refreshSeconds: 2},
  });

  expect(config.org).toBe('myorg');
  expect(config.projects).toEqual(['platform', 'payments']);
  expect(config.repos).toEqual(['all']);
  expect(config.auth).toEqual({mode: 'pat', pat: null, tenant: null});
  expect(config.team.mode).toBe('group');
  expect(config.team.members).toEqual(['bob@co.com']);
  expect(config.ui.hideReviewed).toBe(false);
  expect(config.ui.refreshSeconds).toBe(15); // floored
  expect(config.ui.dedupeAssignedFromTeamSection).toBe(true);
});

test('the az tenant is trimmed, and a blank one is stored as no tenant at all', () => {
  expect(normalize({auth: {mode: 'az-cli', tenant: '  contoso-tenant-id  '}}).auth.tenant).toBe('contoso-tenant-id');
  expect(normalize({auth: {mode: 'az-cli', tenant: '   '}}).auth.tenant).toBeNull();
  expect(normalize({auth: {mode: 'az-cli', tenant: 42}}).auth.tenant).toBeNull();
  expect(normalize({auth: {mode: 'az-cli'}}).auth.tenant).toBeNull();
});

test('refresh interval floors at 15 seconds', () => {
  expect(clampRefresh(45)).toBe(45);
  expect(clampRefresh(3)).toBe(15);
  expect(clampRefresh(Number.NaN)).toBe(45);
  expect(clampRefresh('30')).toBe(45);
});

test('new workspace preferences are queue-focused without changing legacy JSON defaults', () => {
  const defaults = {
    showRepositories: true, showDetails: true, groupByRepo: true, sort: 'newest',
    hideReviewed: true, hideComplete: true, hideMyDrafts: false, hideMyBots: true,
    repoWidth: 22, listShare: 0.42, mouseEnabled: true,
  } as const;
  expect(defaultWorkspacePreferences()).toEqual(defaults);
  expect(defaultConfig().ui.workspace).toEqual(defaults);
  expect(defaultConfig().ui.hideReviewed).toBe(false);
  expect(normalize({}).ui.workspace).toEqual(defaults);
  expect(normalize({ui: {}}).ui.workspace.hideReviewed).toBe(true);

  const changed = defaultWorkspacePreferences();
  changed.showDetails = false;
  expect(defaultWorkspacePreferences().showDetails).toBe(true);
});

test('legacy reviewed preference migrates only when workspace preference is missing', async () => {
  for (const legacy of [false, true]) {
    await Bun.write(file, JSON.stringify({ui: {hideReviewed: legacy}}));
    const {config} = await loadConfig(file);
    expect(config.ui.workspace.hideReviewed).toBe(legacy);
    expect(config.ui.hideReviewed).toBe(legacy);
    expect(normalize({ui: {hideReviewed: legacy, workspace: {showDetails: false}}}).ui.workspace.hideReviewed).toBe(legacy);
    expect(normalize({ui: {hideReviewed: legacy, workspace: {hideReviewed: !legacy}}}).ui.workspace.hideReviewed).toBe(!legacy);
    await saveConfig(config, file);
    expect((await loadConfig(file)).config.ui.workspace.hideReviewed).toBe(legacy);
  }
});

test('workspace normalization rejects invalid types and bounds finite geometry', () => {
  for (const workspace of [null, [], 'invalid', {
    showRepositories: 0, showDetails: 'false', groupByRepo: null, sort: 'random',
    hideReviewed: 'false', hideComplete: 1, repoWidth: NaN, listShare: Infinity, mouseEnabled: [],
  }]) {
    expect(normalize({ui: {workspace}}).ui.workspace).toEqual(defaultWorkspacePreferences());
  }
  expect(normalize({ui: {hideReviewed: false, workspace: {hideReviewed: 'invalid'}}}).ui.workspace.hideReviewed).toBe(true);
  for (const [repoWidth, listShare, expectedWidth, expectedShare] of [
    [-5, -1, 16, 0.1], [100, 5, 36, 0.9], [23.6, 0.55, 24, 0.55],
  ] as const) {
    const normalized = normalize({ui: {workspace: {repoWidth, listShare}}}).ui.workspace;
    expect(normalized.repoWidth).toBe(expectedWidth);
    expect(normalized.listShare).toBe(expectedShare);
  }
  expect(normalize({ui: {workspace: {repoWidth: '20', listShare: '0.5'}}}).ui.workspace).toEqual(defaultWorkspacePreferences());
});

test('workspace preferences persist independently from legacy filters and clamp on save', async () => {
  const config = defaultConfig();
  config.ui.hideReviewed = false;
  config.ui.workspace = {
    ...defaultWorkspacePreferences(),
    showRepositories: false, showDetails: false, groupByRepo: false, sort: 'oldest',
    hideReviewed: true, hideComplete: false, repoWidth: 99, listShare: -1, mouseEnabled: false,
  };
  await saveConfig(config, file);
  const loaded = (await loadConfig(file)).config;
  expect(loaded.ui.workspace).toEqual({...config.ui.workspace, repoWidth: 36, listShare: 0.1});
  expect(loaded.ui.hideReviewed).toBe(false);
  expect(JSON.parse(await Bun.file(file).text()).ui.workspace).toEqual(loaded.ui.workspace);
});

test('My PRs defaults show drafts even with older shared hide-drafts settings', async () => {
  const old = normalize({ui: {hideDrafts: true, hideBots: false, workspace: {groupByRepo: false}}});
  expect(old.ui.workspace.hideMyDrafts).toBe(false);
  expect(old.ui.workspace.hideMyBots).toBe(true);
  expect(old.ui.hideDrafts).toBe(true);
  expect(old.ui.hideBots).toBe(false);
  old.ui.workspace.hideMyDrafts = true;
  old.ui.workspace.hideMyBots = false;
  await saveConfig(old, file);
  const {config: restored} = await loadConfig(file);
  expect(restored.ui.workspace.hideMyDrafts).toBe(true);
  expect(restored.ui.workspace.hideMyBots).toBe(false);
  expect(restored.ui.hideDrafts).toBe(true);
  expect(restored.ui.hideBots).toBe(false);
  const repaired = normalize({ui: {workspace: {hideMyDrafts: 'true', hideMyBots: 0}}});
  expect(repaired.ui.workspace.hideMyDrafts).toBe(false);
  expect(repaired.ui.workspace.hideMyBots).toBe(true);
});
