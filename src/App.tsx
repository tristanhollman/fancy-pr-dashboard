import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useApp, useInput} from 'ink';
import {
  ApiError, getChangedFileCount, getMe, getPullRequestDetails, getReviewRequirements, listActivePullRequests, resetIdentityCache,
  type Identity, type TaggedPullRequest,
} from './api.ts';
import {resetAzTokenCache} from './azcli.ts';
import {classify, isBotAuthor, isMe, type Row} from './classify.ts';
import {saveConfig, type Config} from './config.ts';
import {unknownReviewRequirements, type ReviewRequirements} from './reviews.ts';
import Settings, {type Validator} from './Settings.tsx';
import Workspace, {type WorkspaceFileCount, type WorkspaceSession} from './Workspace.tsx';
import {rowKey, visibleInAnyScope, workspaceRows, type Requirements} from './workspace.ts';
import {setTitle} from './title.ts';

interface Snapshot {
  loading: boolean;
  error?: string;
  prs: TaggedPullRequest[];
  me?: Identity;
  refreshedAt: number;
  requirements: Requirements;
}

export interface AppServices {
  fetch: (config: Config) => Promise<{me: Identity; prs: TaggedPullRequest[]}>;
  requirements: (config: Config, pr: TaggedPullRequest) => Promise<ReviewRequirements>;
  files: (config: Config, pr: TaggedPullRequest) => Promise<WorkspaceFileCount>;
  details: (config: Config, pr: TaggedPullRequest) => Promise<TaggedPullRequest>;
  save: (config: Config) => Promise<void>;
  open: (url: string) => void;
  validateSettings?: Validator;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function fetchPullRequests(config: Config): Promise<{me: Identity; prs: TaggedPullRequest[]}> {
  const [me, prs] = await Promise.all([getMe(config), listActivePullRequests(config)]);
  return {me, prs};
}

function openInBrowser(url: string): void {
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('PR link is not an HTTP URL');
  const command = process.platform === 'win32' ? ['rundll32', 'url.dll,FileProtocolHandler', parsed.href]
    : process.platform === 'darwin' ? ['open', parsed.href] : ['xdg-open', parsed.href];
  Bun.spawn(command, {stdin: 'ignore', stdout: 'ignore', stderr: 'ignore'}).unref();
}

const defaultServices: AppServices = {
  fetch: fetchPullRequests, requirements: getReviewRequirements, files: getChangedFileCount,
  details: getPullRequestDetails, save: saveConfig, open: openInBrowser,
};

function fetchKey(config: Config) {
  // Kept in memory only. Credential changes must invalidate the previous organization's data.
  return JSON.stringify([config.org, config.projects, config.repos, config.auth]);
}

const REQUIREMENTS_WARNING = 'Some review requirements are unavailable; Unknown PRs remain visible. See inspector; r retries.';

function pullRequestKey(pr: TaggedPullRequest): string {
  return rowKey({project: pr.project, repo: pr.repository.name, id: pr.pullRequestId});
}

async function readRequirement(
  services: AppServices,
  config: Config,
  pr: TaggedPullRequest,
  blocked: {reason?: string},
  onFailure: () => void,
): Promise<ReviewRequirements> {
  if (blocked.reason) return unknownReviewRequirements(`Could not load review requirements: ${blocked.reason}`);
  try {
    return await services.requirements(config, pr);
  } catch (error) {
    const reason = message(error);
    if (error instanceof ApiError && [401, 403, 429].includes(error.status)) blocked.reason = reason;
    onFailure();
    return unknownReviewRequirements(`Could not load review requirements: ${reason}`);
  }
}

export default function App({initialConfig, startInSettings, services = defaultServices, columns, height}: {
  initialConfig: Config; startInSettings: boolean; services?: AppServices; columns?: number; height?: number;
}) {
  const {exit} = useApp();
  const [config, setConfig] = useState(initialConfig);
  const configRef = useRef(config);
  configRef.current = config;
  const [screen, setScreen] = useState<'dashboard' | 'settings'>(startInSettings ? 'settings' : 'dashboard');
  const [configured, setConfigured] = useState(!startInSettings);
  const [snapshot, setSnapshot] = useState<Snapshot>({loading: true, prs: [], refreshedAt: 0, requirements: {}});
  const [warning, setWarning] = useState<string>();
  const requirements = snapshot.requirements;
  const [fileCounts, setFileCounts] = useState<Record<string, WorkspaceFileCount | undefined>>({});
  const [metadataWarning, setMetadataWarning] = useState<string>();
  const [selectedKey, setSelectedKey] = useState('');
  const [descriptions, setDescriptions] = useState<Record<string, {text?: string; error?: string} | undefined>>({});
  const pendingDescription = useRef<{key: string; pr: TaggedPullRequest; config: Config; generation: number} | null>(null);
  const descriptionWorker = useRef<Promise<void> | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const selectedRef = useRef('');
  const fileBudget = useRef(0);
  const mounted = useRef(true);
  const pendingSave = useRef<Config | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const workspaceSession = useRef<{connection: string; state: WorkspaceSession} | null>(null);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      void (async () => { await saving.current; exit(); })();
    }
  }, {isActive: screen === 'settings'});

  useEffect(() => () => { mounted.current = false; generation.current++; }, []);

  const persist = (next: Config) => {
    configRef.current = next;
    setConfig(next);
    pendingSave.current = next;
    if (!saving.current) {
      saving.current = (async () => {
        while (pendingSave.current) {
          const value = pendingSave.current;
          pendingSave.current = null;
          try {
            await services.save(value);
            if (mounted.current) setWarning(undefined);
          } catch (error) {
            if (mounted.current) setWarning(`Preferences not saved: ${message(error)}`);
          }
        }
      })().finally(() => { saving.current = null; });
    }
  };

  const load = useCallback(async (clear = false) => {
    if (inFlight.current && !clear) return;
    const id = ++generation.current;
    inFlight.current = true;
    const requestConfig = configRef.current;
    setSnapshot(previous => clear ? {loading: true, prs: [], refreshedAt: 0, requirements: {}}
      : {...previous, loading: true, error: undefined});
    if (clear) { setFileCounts({}); setDescriptions({}); }
    try {
      const result = await services.fetch(requestConfig);
      const current = () => mounted.current && id === generation.current;
      if (!current()) return;
      const nextRequirements: Requirements = {};
      const blocked: {reason?: string} = {};
      let requirementsFailed = false;
      // Publish one consistent snapshot, not an unfiltered list followed by policy results.
      // Recheck eligibility if draft/bot preferences changed while requests were in flight.
      while (current()) {
        const latestConfig = configRef.current;
        const queue = result.prs.filter(pr => visibleInAnyScope({
          isMine: isMe(pr.createdBy, result.me), isDraft: pr.isDraft ?? false,
          isBot: isBotAuthor(pr.createdBy, latestConfig.ui.botAuthors),
        }, latestConfig) && !nextRequirements[pullRequestKey(pr)]);
        if (!queue.length) break;
        await Promise.all(Array.from({length: Math.min(4, queue.length)}, async () => {
          while (queue.length && current()) {
            const preferred = queue.findIndex(pr => pullRequestKey(pr) === selectedRef.current);
            const pr = queue.splice(preferred >= 0 ? preferred : 0, 1)[0]!;
            nextRequirements[pullRequestKey(pr)] = await readRequirement(
              services, requestConfig, pr, blocked, () => { requirementsFailed = true; },
            );
          }
        }));
      }
      if (!current()) return;
      setFileCounts({});
      setDescriptions({});
      fileBudget.current = 0;
      setMetadataWarning(requirementsFailed ? REQUIREMENTS_WARNING : undefined);
      setSnapshot({loading: false, ...result, requirements: nextRequirements, refreshedAt: Date.now()});
    } catch (error) {
      if (!mounted.current || id !== generation.current) return;
      setSnapshot(previous => ({...previous, loading: false, error: message(error)}));
    } finally {
      if (id === generation.current) inFlight.current = false;
    }
  }, [services]);

  const connection = fetchKey(config);
  const previousConnection = useRef('');
  useEffect(() => {
    if (screen !== 'dashboard') return;
    const clear = previousConnection.current !== connection;
    previousConnection.current = connection;
    void load(clear);
  }, [screen, connection, load]);
  useEffect(() => {
    if (screen !== 'dashboard') return;
    const timer = setInterval(() => void load(), config.ui.refreshSeconds * 1000);
    return () => clearInterval(timer);
  }, [screen, config.ui.refreshSeconds, load]);

  const rows = useMemo(() => {
    const me = snapshot.me;
    return me ? snapshot.prs.map(pr => {
      const row = classify(pr, config, me, Date.now());
      return {...row, description: descriptions[rowKey(row)]?.text ?? row.description};
    }) : [];
  }, [snapshot.prs, snapshot.me, config, descriptions]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    if (screen !== 'dashboard' || snapshot.loading || !snapshot.me || !snapshot.prs.length) return;
    let cancelled = false;
    const requestGeneration = generation.current;
    const requestConfig = configRef.current;
    const candidates = snapshot.prs.map((pr, index) => ({pr, row: rowsRef.current[index]!}))
      .filter(({row}) => visibleInAnyScope(row, config));
    const queue = candidates.filter(({row}) => !requirements[rowKey(row)] || (!fileCounts[rowKey(row)] && fileBudget.current < 80));
    const blocked: {reason?: string} = {};
    const current = () => !cancelled && mounted.current && generation.current === requestGeneration;
    const workers = Array.from({length: Math.min(4, queue.length)}, async () => {
      while (queue.length && current()) {
        const preferred = queue.findIndex(item => rowKey(item.row) === selectedRef.current);
        const item = queue.splice(preferred >= 0 ? preferred : 0, 1)[0]!;
        const key = rowKey(item.row);
        if (!requirements[key]) {
          const result = await readRequirement(services, requestConfig, item.pr, blocked, () => {
            if (current()) setMetadataWarning(REQUIREMENTS_WARNING);
          });
          if (!current()) return;
          setSnapshot(previous => ({...previous, requirements: {...previous.requirements, [key]: result}}));
        }
        if (!current()) return;
        if (fileCounts[key] || fileBudget.current >= 80 || blocked.reason) continue;
        fileBudget.current++;
        try {
          const value = await services.files(requestConfig, item.pr);
          if (current()) setFileCounts(previous => ({...previous, [key]: value}));
        } catch (error) {
          if (error instanceof ApiError && [401, 403, 429].includes(error.status)) blocked.reason = message(error);
          if (current()) setMetadataWarning(`Changed-file count unavailable: ${message(error)}. r retries.`);
        }
      }
    });
    void Promise.all(workers);
    return () => { cancelled = true; };
  }, [snapshot.prs, snapshot.loading, screen, config.ui.hideDrafts, config.ui.hideBots,
    config.ui.workspace.hideMyDrafts, config.ui.workspace.hideMyBots, services]);

  useEffect(() => {
    if (screen !== 'dashboard' || snapshot.loading || !selectedKey || descriptions[selectedKey]) {
      pendingDescription.current = null;
      return;
    }
    const pr = snapshot.prs.find(value => pullRequestKey(value) === selectedKey);
    if (!pr) return;
    // Keep at most one detail request in flight and replace queued cursor positions.
    pendingDescription.current = {key: selectedKey, pr, config: configRef.current, generation: generation.current};
    if (descriptionWorker.current) return;
    descriptionWorker.current = (async () => {
      while (pendingDescription.current && mounted.current) {
        const request = pendingDescription.current;
        pendingDescription.current = null;
        try {
          const detail = await services.details(request.config, request.pr);
          if (mounted.current && request.generation === generation.current) {
            setDescriptions(previous => ({...previous, [request.key]: {text: detail.description ?? ''}}));
          }
        } catch (error) {
          if (mounted.current && request.generation === generation.current) {
            setDescriptions(previous => ({...previous, [request.key]: {error: message(error)}}));
          }
        }
      }
    })().finally(() => { descriptionWorker.current = null; });
  }, [selectedKey, snapshot.prs, snapshot.loading, screen, services]);

  useEffect(() => {
    if (screen === 'settings') setTitle('fpr · settings');
    else {
      const data = workspaceRows(rows, config, requirements, 'team');
      setTitle(`fpr · ${data.counts.team} to review · ${data.counts.mine} mine`);
    }
  }, [rows, config, requirements, screen]);

  if (screen === 'settings') {
    return <Settings config={config} columns={columns} height={height} save={services.save}
      validate={services.validateSettings} onSave={next => {
      resetIdentityCache();
      resetAzTokenCache();
      configRef.current = next;
      setConfig(next);
      setConfigured(true);
      setScreen('dashboard');
    }} onCancel={configured ? () => setScreen('dashboard') : undefined} />;
  }
  return <Workspace config={config} rows={rows} requirements={requirements} fileCounts={fileCounts}
    initialSession={workspaceSession.current?.connection === connection ? workspaceSession.current.state : undefined}
    descriptionLoading={Boolean(selectedKey && !descriptions[selectedKey])}
    descriptionError={descriptions[selectedKey]?.error}
    refreshedAt={snapshot.refreshedAt} loading={snapshot.loading} error={snapshot.error} warning={warning ?? metadataWarning}
    columns={columns} height={height}
    onPreferencesChange={workspace => persist({...configRef.current, ui: {...configRef.current.ui, workspace}})}
    onToggleFilter={key => persist({...configRef.current, ui: {...configRef.current.ui, [key]: !configRef.current.ui[key]}})}
    onRefresh={() => void load()} onSelectionChange={(row: Row | undefined) => {
      selectedRef.current = row ? rowKey(row) : '';
      setSelectedKey(selectedRef.current);
    }}
    onSettings={state => {
      workspaceSession.current = {connection, state};
      void (async () => { await saving.current; setScreen('settings'); })();
    }}
    onQuit={() => { void (async () => { await saving.current; exit(); })(); }}
    onOpen={row => {
      try { services.open(row.webUrl); }
      catch (error) { setWarning(`Could not open PR: ${message(error)}`); }
    }} />;
}
