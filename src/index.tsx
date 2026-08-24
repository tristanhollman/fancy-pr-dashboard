#!/usr/bin/env bun
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, render, useApp, useInput, useWindowSize} from 'ink';
import {
  ApiError,
  getChangedFileCount,
  getMe,
  listActivePullRequests,
  resetIdentityCache,
  type Identity,
  type TaggedPullRequest,
} from './api.ts';
import {flattenSections, nextSectionStart, sectionStarts, splitSections} from './classify.ts';
import {loadConfig, saveConfig, type Config} from './config.ts';
import Dashboard, {COLORS, type FileCounts} from './Dashboard.tsx';
import Settings from './Settings.tsx';

interface Snapshot {
  loading: boolean;
  error?: string;
  prs?: TaggedPullRequest[];
  me?: Identity;
  refreshedAt: number;
}

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);
}

async function fetchPullRequests(config: Config): Promise<{me: Identity; prs: TaggedPullRequest[]}> {
  const [me, prs] = await Promise.all([getMe(config), listActivePullRequests(config)]);
  return {me, prs};
}

/** Which settings actually require a new fetch — filters and toggles do not. */
function fetchKeyFor(config: Config): string {
  return JSON.stringify([config.org, config.projects, config.repos, config.auth.mode, config.auth.pat !== null]);
}

type FilterKey = 'hideReviewed' | 'hideDrafts' | 'hideBots';

/**
 * Changed-file counts cost one request per PR, so they are fetched after the list is on
 * screen, only for rows that survived the filters, a few at a time, and never more than
 * this many. Without the cap, showing bot PRs would fire hundreds of requests.
 */
const FILE_COUNT_LIMIT = 80;
const FILE_COUNT_CONCURRENCY = 6;

/** Hand a URL to the OS browser. Detached and ignored — fpr never waits on it. */
function openInBrowser(url: string): void {
  const command =
    process.platform === 'win32'
      ? ['cmd', '/c', 'start', '', url]
      : process.platform === 'darwin'
        ? ['open', url]
        : ['xdg-open', url];
  Bun.spawn(command, {stdin: 'ignore', stdout: 'ignore', stderr: 'ignore'}).unref();
}

function App({initialConfig, startInSettings}: {initialConfig: Config; startInSettings: boolean}) {
  const {exit} = useApp();
  const size = useWindowSize();
  const [config, setConfig] = useState(initialConfig);
  const [screen, setScreen] = useState<'dashboard' | 'settings'>(startInSettings ? 'settings' : 'dashboard');
  const [configured, setConfigured] = useState(!startInSettings);
  const [snapshot, setSnapshot] = useState<Snapshot>({loading: true, refreshedAt: Date.now()});
  const [warning, setWarning] = useState<string>();
  // Row cursor, deliberately kept across refreshes so a refresh does not move your place.
  const [selection, setSelection] = useState(0);

  // The fetch reads the newest config without being a dependency of the effect: a filter
  // toggle changes `config`, and re-fetching every open PR to hide a draft would be absurd.
  const configRef = useRef(config);
  configRef.current = config;

  const load = useCallback(async () => {
    setSnapshot(previous => ({...previous, loading: true, error: undefined}));
    try {
      const {me, prs} = await fetchPullRequests(configRef.current);
      setSnapshot({loading: false, me, prs, refreshedAt: Date.now()});
    } catch (error) {
      setSnapshot({loading: false, error: message(error), refreshedAt: Date.now()});
    }
  }, []);

  const fetchKey = fetchKeyFor(config);
  useEffect(() => {
    if (screen === 'dashboard') void load();
  }, [screen, fetchKey, load]);

  // Filters are applied here, so toggling one is instant — no request, no cursor reset.
  const sections = useMemo(
    () => (snapshot.prs && snapshot.me ? splitSections(snapshot.prs, config, snapshot.me) : undefined),
    [snapshot.prs, snapshot.me, config],
  );

  const toggle = (key: FilterKey) => {
    const next: Config = {...config, ui: {...config.ui, [key]: !config.ui[key]}};
    setConfig(next);
    setWarning(undefined);
    // Write-through: the dashboard and the config file must not drift.
    void saveConfig(next).catch((error: unknown) => setWarning(`filter not saved: ${message(error)}`));
  };

  const rows = sections ? flattenSections(sections) : [];
  const selected = rows.length === 0 ? 0 : Math.max(0, Math.min(selection, rows.length - 1));

  // Keyed by PR id and kept across refreshes; a PR whose diff has not moved keeps its count.
  const [fileCounts, setFileCounts] = useState<FileCounts>({});
  const visibleIds = rows.map(row => row.id).join(',');

  useEffect(() => {
    if (screen !== 'dashboard' || !snapshot.prs) return;
    let cancelled = false;

    const wanted = new Set(rows.map(row => row.id));
    const pending = snapshot.prs.filter(pr => wanted.has(pr.pullRequestId) && !fileCounts[pr.pullRequestId]).slice(0, FILE_COUNT_LIMIT);
    if (pending.length === 0) return;

    void (async () => {
      for (let i = 0; i < pending.length; i += FILE_COUNT_CONCURRENCY) {
        if (cancelled) return;
        const batch = pending.slice(i, i + FILE_COUNT_CONCURRENCY);
        const counted = await Promise.all(
          batch.map(async pr => {
            try {
              return [pr.pullRequestId, await getChangedFileCount(configRef.current, pr)] as const;
              // A single diff failing must not disturb the dashboard; that row keeps its placeholder.
            } catch {
              return undefined;
            }
          }),
        );
        if (cancelled) return;
        setFileCounts(previous => {
          const next = {...previous};
          for (const entry of counted) if (entry) next[entry[0]] = entry[1];
          return next;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // `visibleIds` stands in for the row list; re-running on every render would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, snapshot.prs, visibleIds]);

  useInput(
    (input, key) => {
      if (input === 'q') exit();
      else if (input === 's') setScreen('settings');
      else if (input === 'r') void load();
      else if (input === 'h') toggle('hideReviewed');
      else if (input === 'd') toggle('hideDrafts');
      else if (input === 'b') toggle('hideBots');
      else if (input === 'j' || key.downArrow) setSelection(Math.min(selected + 1, Math.max(0, rows.length - 1)));
      else if (input === 'k' || key.upArrow) setSelection(Math.max(selected - 1, 0));
      else if (input === 'g') setSelection(0);
      else if (input === 'G') setSelection(Math.max(0, rows.length - 1));
      else if (key.tab && sections) setSelection(nextSectionStart(sectionStarts(sections), selected));
      else if (key.return) {
        const row = rows[selected];
        if (row) openInBrowser(row.webUrl);
      }
    },
    {isActive: screen === 'dashboard'},
  );

  if (screen === 'settings') {
    return (
      <Settings
        config={config}
        onSave={next => {
          resetIdentityCache();
          setConfig(next);
          setConfigured(true);
          setScreen('dashboard');
        }}
        onCancel={configured ? () => setScreen('dashboard') : undefined}
      />
    );
  }

  if (snapshot.error) {
    return (
      <Box flexDirection="column" height={size.rows} paddingX={1}>
        <Text color={COLORS.red}>{snapshot.error}</Text>
        <Text color={COLORS.dim}>r retry · s settings · q quit</Text>
      </Box>
    );
  }

  if (!sections) {
    return (
      <Box height={size.rows} paddingX={1}>
        <Text color={COLORS.dim}>loading pull requests…</Text>
      </Box>
    );
  }

  return (
    <Dashboard
      config={config}
      sections={sections}
      refreshedAt={snapshot.refreshedAt}
      selected={selected}
      fileCounts={fileCounts}
      warning={warning}
    />
  );
}

const {config, valid, error} = await loadConfig();

if (process.stdout.isTTY) {
  // Alternate screen: fullscreen at any content size, and the terminal's scrollback is
  // handed back untouched on exit — same mechanism vim and htop use.
  render(<App initialConfig={config} startInSettings={!valid} />, {alternateScreen: true});
} else {
  // Piped or redirected: no Ink, no raw mode. Dump JSON instead.
  if (!valid) {
    console.error(error ?? 'no usable config — run fpr in a terminal to set it up');
    process.exit(1);
  }
  try {
    const {me, prs} = await fetchPullRequests(config);
    const sections = splitSections(prs, config, me);
    console.log(JSON.stringify({org: config.org, projects: config.projects, refreshedAt: new Date().toISOString(), ...sections}, null, 2));
  } catch (failure) {
    console.error(message(failure));
    process.exit(1);
  }
}
