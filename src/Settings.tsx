import React, {useMemo, useRef, useState} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';
import TextInput from 'ink-text-input';
import {getMe, listActivePullRequests, resetIdentityCache, ApiError} from './api.ts';
import {getAzAccessToken, resetAzTokenCache} from './azcli.ts';
import {discoverReviewerGroups, type ReviewerGroup} from './classify.ts';
import {defaultWorkspacePreferences, isValid, normalize, patFromEnv, saveConfig, type Config} from './config.ts';
import {COLORS} from './Dashboard.tsx';

/** A validation failure, optionally pinned to the field that caused it. */
export interface ValidationFailure {
  field?: string;
  message: string;
}

export type Validator = (config: Config) => Promise<ValidationFailure | null>;

/** The real check: resolve the identity, then ask each project for a single PR. */
export const validateLive: Validator = async config => {
  resetIdentityCache();

  if (config.auth.mode === 'az-cli') {
    // Probed first so "az is missing" / "run az login" lands on the mode field rather
    // than reading as a rejected credential.
    resetAzTokenCache();
    try {
      await getAzAccessToken(config.auth.tenant);
    } catch (error) {
      return {field: 'auth.mode', message: error instanceof ApiError ? error.message : String(error)};
    }
  }

  try {
    await getMe(config);
  } catch (error) {
    // A 404 here is the organization, not the token — connectionData needs no extra scope.
    const field = error instanceof ApiError && error.status === 404 ? 'org' : credentialField(config);
    return {field, message: error instanceof ApiError ? error.message : String(error)};
  }
  try {
    await listActivePullRequests(config, 1);
  } catch (error) {
    return {field: 'projects', message: error instanceof ApiError ? error.message : String(error)};
  }
  return null;
};

/** The field an authentication failure belongs to, which differs per auth mode. */
function credentialField(config: Config): string {
  return config.auth.mode === 'az-cli' ? 'auth.mode' : 'auth.pat';
}

export type GroupFinder = (config: Config) => Promise<ReviewerGroup[]>;

/** The groups already acting as container reviewers on the configured projects' PRs. */
export const findGroupsLive: GroupFinder = async config => discoverReviewerGroups(await listActivePullRequests(config));

type Kind = 'text' | 'secret' | 'toggle' | 'picker' | 'action';

interface Field {
  key: string;
  group: string;
  label: string;
  kind: Kind;
  value: string;
  hint?: string;
  readOnly?: boolean;
  set?: (draft: Config, next: string) => void;
  toggle?: (draft: Config) => void;
}

function list(values: string[]): string {
  return values.join(', ');
}

function parseList(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function fieldsFor(draft: Config): Field[] {
  const fields: Field[] = [
    {
      key: 'org',
      group: 'Connection',
      label: 'organization',
      kind: 'text',
      value: draft.org,
      hint: 'dev.azure.com/<org>',
      set: (d, next) => {
        d.org = next.trim();
      },
    },
    {
      key: 'projects',
      group: 'Connection',
      label: 'projects',
      kind: 'text',
      value: list(draft.projects),
      hint: 'comma separated',
      set: (d, next) => {
        d.projects = parseList(next);
      },
    },
    {
      key: 'repos',
      group: 'Connection',
      label: 'repos',
      kind: 'text',
      value: list(draft.repos),
      hint: '"all" or a comma list of repo names',
      set: (d, next) => {
        const parsed = parseList(next);
        d.repos = parsed.length > 0 ? parsed : ['all'];
      },
    },
    {
      key: 'auth.mode',
      group: 'Auth',
      label: 'mode',
      kind: 'toggle',
      value: draft.auth.mode,
      hint: draft.auth.mode === 'az-cli' ? 'pat | az-cli · uses your `az login`' : 'pat | az-cli',
      toggle: d => {
        d.auth.mode = d.auth.mode === 'pat' ? 'az-cli' : 'pat';
      },
    },
  ];

  // In az-cli mode there is no token to type; any stored PAT is kept for a switch back.
  if (draft.auth.mode === 'pat') {
    fields.push({
      key: 'auth.pat',
      group: 'Auth',
      label: 'personal access token',
      kind: 'secret',
      value: draft.auth.pat ?? '',
      readOnly: patFromEnv(),
      hint: patFromEnv() ? 'from environment (FPR_PAT) — read-only' : 'needs the Code: Read scope',
      set: (d, next) => {
        d.auth.pat = next.length > 0 ? next : null;
      },
    });
  } else {
    fields.push({
      key: 'auth.tenant',
      group: 'Auth',
      label: 'tenant',
      kind: 'text',
      value: draft.auth.tenant ?? '',
      hint: 'optional; only if this org lives in another Entra tenant than your default az subscription',
      set: (d, next) => {
        const trimmed = next.trim();
        d.auth.tenant = trimmed.length > 0 ? trimmed : null;
      },
    });
  }

  fields.push(
    {
      key: 'team.mode',
      group: 'Team',
      label: 'mode',
      kind: 'toggle',
      value: draft.team.mode,
      hint: 'manual | group',
      toggle: d => {
        d.team.mode = d.team.mode === 'manual' ? 'group' : 'manual';
      },
    },
  );

  if (draft.team.mode === 'manual') {
    fields.push({
      key: 'team.members',
      group: 'Team',
      label: 'members',
      kind: 'text',
      value: list(draft.team.members),
      hint: 'comma separated emails',
      set: (d, next) => {
        d.team.members = parseList(next);
      },
    });
  } else {
    fields.push({
      key: 'team.groupDescriptor',
      group: 'Team',
      label: 'reviewer group',
      kind: 'picker',
      value: draft.team.groupDisplayName ?? draft.team.groupDescriptor ?? 'any group',
      hint: 'enter to pick from the groups reviewing your PRs',
    });
  }

  fields.push(
    {
      key: 'ui.workspace.showRepositories',
      group: 'Workspace',
      label: 'show repositories',
      kind: 'toggle',
      value: draft.ui.workspace.showRepositories ? 'on' : 'off',
      toggle: d => {
        d.ui.workspace.showRepositories = !d.ui.workspace.showRepositories;
      },
    },
    {
      key: 'ui.workspace.showDetails',
      group: 'Workspace',
      label: 'show details',
      kind: 'toggle',
      value: draft.ui.workspace.showDetails ? 'on' : 'off',
      toggle: d => {
        d.ui.workspace.showDetails = !d.ui.workspace.showDetails;
      },
    },
    {
      key: 'ui.workspace.groupByRepo',
      group: 'Workspace',
      label: 'group by repository',
      kind: 'toggle',
      value: draft.ui.workspace.groupByRepo ? 'on' : 'off',
      toggle: d => {
        d.ui.workspace.groupByRepo = !d.ui.workspace.groupByRepo;
      },
    },
    {
      key: 'ui.workspace.sort',
      group: 'Workspace',
      label: 'sort by date',
      kind: 'toggle',
      value: draft.ui.workspace.sort,
      hint: 'newest | oldest',
      toggle: d => {
        d.ui.workspace.sort = d.ui.workspace.sort === 'newest' ? 'oldest' : 'newest';
      },
    },
    {
      key: 'ui.workspace.hideReviewed',
      group: 'Workspace',
      label: 'hide my reviewed (queue)',
      kind: 'toggle',
      value: draft.ui.workspace.hideReviewed ? 'on' : 'off',
      hint: 'review queue only; all other scopes keep reviewed PRs',
      toggle: d => {
        d.ui.workspace.hideReviewed = !d.ui.workspace.hideReviewed;
      },
    },
    {
      key: 'ui.workspace.hideComplete',
      group: 'Workspace',
      label: 'hide required-complete',
      kind: 'toggle',
      value: draft.ui.workspace.hideComplete ? 'on' : 'off',
      hint: 'review queue only; unknown requirements stay visible',
      toggle: d => {
        d.ui.workspace.hideComplete = !d.ui.workspace.hideComplete;
      },
    },
    {
      key: 'ui.workspace.mouseEnabled',
      group: 'Workspace',
      label: 'mouse input',
      kind: 'toggle',
      value: draft.ui.workspace.mouseEnabled ? 'on' : 'off',
      hint: 'click, scroll and drag workspace dividers',
      toggle: d => {
        d.ui.workspace.mouseEnabled = !d.ui.workspace.mouseEnabled;
      },
    },
    {
      key: 'ui.workspace.resetGeometry',
      group: 'Workspace',
      label: 'reset pane geometry',
      kind: 'action',
      value: `${draft.ui.workspace.repoWidth} cols · ${Math.round(draft.ui.workspace.listShare * 100)}% list`,
      hint: 'enter resets widths only, not panes or filters',
      toggle: d => {
        const defaults = defaultWorkspacePreferences();
        d.ui.workspace.repoWidth = defaults.repoWidth;
        d.ui.workspace.listShare = defaults.listShare;
      },
    },
    {
      key: 'ui.workspace.hideMyDrafts',
      group: 'My PRs',
      label: 'hide my drafts',
      kind: 'toggle',
      value: draft.ui.workspace.hideMyDrafts ? 'on' : 'off',
      hint: 'My PRs only; d in that tab does not affect other scopes',
      toggle: d => {
        d.ui.workspace.hideMyDrafts = !d.ui.workspace.hideMyDrafts;
      },
    },
    {
      key: 'ui.workspace.hideMyBots',
      group: 'My PRs',
      label: 'hide my bot-authored PRs',
      kind: 'toggle',
      value: draft.ui.workspace.hideMyBots ? 'on' : 'off',
      hint: 'My PRs only; b in that tab does not affect other scopes',
      toggle: d => {
        d.ui.workspace.hideMyBots = !d.ui.workspace.hideMyBots;
      },
    },
    {
      key: 'ui.hideReviewed',
      group: 'Display',
      label: 'JSON-only hide reviewed',
      kind: 'toggle',
      value: draft.ui.hideReviewed ? 'on' : 'off',
      toggle: d => {
        d.ui.hideReviewed = !d.ui.hideReviewed;
      },
    },
    {
      key: 'ui.dedupeAssignedFromTeamSection',
      group: 'Display',
      label: 'dedupe assigned from team',
      kind: 'toggle',
      value: draft.ui.dedupeAssignedFromTeamSection ? 'on' : 'off',
      hint: 'exclude assignments matching only you from Team queue; also applies to JSON',
      toggle: d => {
        d.ui.dedupeAssignedFromTeamSection = !d.ui.dedupeAssignedFromTeamSection;
      },
    },
    {
      key: 'ui.hideDrafts',
      group: 'Display',
      label: 'hide drafts',
      kind: 'toggle',
      value: draft.ui.hideDrafts ? 'on' : 'off',
      hint: 'd outside My PRs; that tab has its own preference',
      toggle: d => {
        d.ui.hideDrafts = !d.ui.hideDrafts;
      },
    },
    {
      key: 'ui.hideBots',
      group: 'Display',
      label: 'hide bot authors',
      kind: 'toggle',
      value: draft.ui.hideBots ? 'on' : 'off',
      hint: 'b outside My PRs; that tab has its own preference',
      toggle: d => {
        d.ui.hideBots = !d.ui.hideBots;
      },
    },
    {
      key: 'ui.botAuthors',
      group: 'Display',
      label: 'bot authors',
      kind: 'text',
      value: list(draft.ui.botAuthors),
      hint: 'comma separated; matched as a substring of the author name',
      set: (d, next) => {
        d.ui.botAuthors = parseList(next);
      },
    },
    {
      key: 'ui.refreshSeconds',
      group: 'Display',
      label: 'refresh seconds',
      kind: 'text',
      value: String(draft.ui.refreshSeconds),
      hint: 'floor 15',
      set: (d, next) => {
        const digits = next.replace(/\D/g, '');
        d.ui.refreshSeconds = digits.length > 0 ? Number(digits) : 0;
      },
    },
  );

  return fields;
}

function clone(config: Config): Config {
  return structuredClone(config);
}

export interface SettingsProps {
  config: Config;
  onSave: (config: Config) => void;
  /** Absent when there is no usable config to go back to. */
  onCancel?: () => void;
  validate?: Validator;
  /** Injected in tests so the screen never touches the real config file. */
  save?: (config: Config) => Promise<void>;
  findGroups?: GroupFinder;
  columns?: number;
  height?: number;
}

interface PickerState {
  loading: boolean;
  groups: ReviewerGroup[];
  index: number;
  error?: string;
}

export default function Settings({
  config,
  onSave,
  onCancel,
  validate = validateLive,
  save = c => saveConfig(c),
  findGroups = findGroupsLive,
  columns,
  height,
}: SettingsProps) {
  const size = useWindowSize();
  const width = Math.max(1, Math.floor(columns ?? size.columns ?? 100));
  const rows = Math.max(1, Math.floor(height ?? size.rows ?? 24));
  const [draft, setDraft] = useState<Config>(() => normalize(config));
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [buffer, setBuffer] = useState('');
  const [failure, setFailure] = useState<ValidationFailure | null>(null);
  const [status, setStatus] = useState<'idle' | 'validating'>('idle');
  const [picker, setPicker] = useState<PickerState | null>(null);
  const viewportStart = useRef(0);

  const fields = useMemo(() => fieldsFor(draft), [draft]);
  const index = Math.min(cursor, fields.length - 1);
  const field = fields[index];

  // Keystrokes can arrive faster than React re-renders, so navigation reads the
  // cursor from a ref: a stale render closure would swallow every move but the first.
  const cursorRef = useRef(index);
  cursorRef.current = index;

  const moveTo = (next: number) => {
    const clamped = Math.max(0, Math.min(next, fields.length - 1));
    cursorRef.current = clamped;
    setCursor(clamped);
  };

  const commit = (mutate: (d: Config) => void) => {
    setDraft(previous => {
      const next = clone(previous);
      mutate(next);
      return next;
    });
    setFailure(null);
  };

  const startEdit = () => {
    const target = fields[cursorRef.current];
    if (!target || target.readOnly || (target.kind !== 'text' && target.kind !== 'secret')) return;
    setBuffer(target.value);
    setEditing(true);
  };

  const openPicker = async () => {
    setPicker({loading: true, groups: [], index: 0});
    try {
      const groups = await findGroups(draft);
      setPicker({loading: false, groups, index: 0});
    } catch (error) {
      setPicker({loading: false, groups: [], index: 0, error: error instanceof ApiError ? error.message : String(error)});
    }
  };

  const choose = (group: ReviewerGroup | undefined) => {
    if (group) {
      commit(d => {
        d.team.groupDescriptor = group.descriptor;
        d.team.groupDisplayName = group.displayName;
      });
    }
    setPicker(null);
  };

  const finishEdit = () => {
    const target = fields[cursorRef.current];
    if (target?.set) commit(d => target.set?.(d, buffer));
    setEditing(false);
  };

  const attemptSave = async () => {
    const candidate = normalize(draft);

    if (!isValid(candidate)) {
      setFailure({message: 'organization, at least one project and auth are all required'});
      return;
    }

    setStatus('validating');
    try {
      const result = await validate(candidate);
      if (result) {
        setFailure(result);
        const failedIndex = fields.findIndex(f => f.key === result.field);
        if (failedIndex >= 0) moveTo(failedIndex);
        return;
      }

      await save(candidate);
      onSave(candidate);
    } catch (error) {
      // Neither `validate` nor `save` is expected to throw, but if either does — a disk
      // write failing, say — it must land on screen. Silently swallowing it here left the
      // draft change unsaved with no explanation, and reopening settings showed the old
      // config again as if nothing had been typed.
      setFailure({message: error instanceof Error ? error.message : String(error)});
    } finally {
      setStatus('idle');
    }
  };

  useInput(
    (input, key) => {
      if (status === 'validating') return;

      // The picker owns the keyboard while it is open.
      if (picker) {
        if (key.escape) setPicker(null);
        else if (picker.loading) return;
        else if (input === 'j' || key.downArrow) setPicker(previous => previous && ({
          ...previous, index: Math.min(previous.index + 1, Math.max(0, previous.groups.length - 1)),
        }));
        else if (input === 'k' || key.upArrow) setPicker(previous => previous && ({
          ...previous, index: Math.max(previous.index - 1, 0),
        }));
        else if (key.return) choose(picker.groups[picker.index]);
        return;
      }

      if (key.escape) {
        onCancel?.();
        return;
      }
      // ctrl+s alone is not reliable everywhere: classic Windows console hosts (conhost,
      // not modern Windows Terminal) treat it as a pause-output signal before the app
      // ever sees it, eating the keystroke entirely. Plain `s` works the same as ctrl+s
      // (input is 's' either way) and is never intercepted like that; this handler is
      // only active while not editing a field (see `isActive` below), so it can't
      // collide with typing a value.
      if (input === 's') {
        void attemptSave();
        return;
      }
      if (input === 'j' || key.downArrow) {
        moveTo(cursorRef.current + 1);
        return;
      }
      if (input === 'k' || key.upArrow) {
        moveTo(cursorRef.current - 1);
        return;
      }
      if (key.tab) {
        // Jump to the first field of the next group.
        const here = cursorRef.current;
        const group = fields[here]?.group;
        const next = fields.findIndex((f, i) => i > here && f.group !== group);
        moveTo(next === -1 ? 0 : next);
        return;
      }
      if (key.return) {
        const target = fields[cursorRef.current];
        if ((target?.kind === 'toggle' || target?.kind === 'action') && target.toggle) commit(d => target.toggle?.(d));
        else if (target?.kind === 'picker') void openPicker();
        else startEdit();
      }
    },
    {isActive: !editing},
  );

  const headerRows = rows >= 2 ? 1 : 0;
  const footerRows = rows >= 5 ? 2 : rows >= 3 ? 1 : 0;
  const bodyRows = rows - headerRows - footerRows;
  const padding = width >= 20 ? 1 : 0;
  const contentWidth = width - padding * 2;

  if (picker) {
    const start = Math.max(0, picker.index - bodyRows + 1);
    return (
      <Box flexDirection="column" width={width} height={rows} paddingX={padding} overflow="hidden">
        {headerRows > 0 ? (
          <Box height={1} flexShrink={0}>
            <Text color={COLORS.blue} bold wrap="truncate-end">
              reviewer group · groups already reviewing pull requests in your projects
            </Text>
          </Box>
        ) : null}

        <Box height={bodyRows} flexShrink={0} flexDirection="column" overflow="hidden">
          {picker.loading ? <Text color={COLORS.amber} wrap="truncate-end">looking through open pull requests…</Text> : null}
          {picker.error ? <Text color={COLORS.red} wrap="truncate-end">{picker.error}</Text> : null}
          {!picker.loading && !picker.error && picker.groups.length === 0 ? (
            <Text color={COLORS.dim} italic wrap="truncate-end">
              no group is a reviewer on any open PR — check the projects, or use manual mode with a member list
            </Text>
          ) : null}
          {picker.groups.slice(start, start + bodyRows).map((group, i) => (
            <Box key={group.descriptor} height={1} flexShrink={0}>
              <Text wrap="truncate-end">
                <Text color={COLORS.blue}>{start + i === picker.index ? '› ' : '  '}</Text>
                <Text color={start + i === picker.index ? COLORS.bright : COLORS.text}>{group.displayName}</Text>
                <Text color={COLORS.dim}>{` · reviewer on ${group.prCount} open PR${group.prCount === 1 ? '' : 's'}`}</Text>
              </Text>
            </Box>
          ))}
        </Box>

        {footerRows > 1 ? (
          <Text color={COLORS.dim} wrap="truncate-end">
            {picker.groups.length > 0 ? `${picker.index + 1}/${picker.groups.length} groups` : 'reviewer groups'}
          </Text>
        ) : null}
        {footerRows > 0 ? <Text color={COLORS.dim} wrap="truncate-end">j/k move · enter pick · esc back</Text> : null}
      </Box>
    );
  }

  type Line =
    | {kind: 'header'; key: string; group: string}
    | {kind: 'field'; key: string; field: Field; index: number}
    | {kind: 'error'; key: string; message: string};
  const lines: Line[] = [];
  let lastGroup = '';
  for (const [i, f] of fields.entries()) {
    if (f.group !== lastGroup) {
      lines.push({kind: 'header', key: f.group, group: f.group});
      lastGroup = f.group;
    }
    lines.push({kind: 'field', key: f.key, field: f, index: i});
    if (failure?.field === f.key) lines.push({kind: 'error', key: `${f.key}.error`, message: failure.message});
  }
  const selectedLine = lines.findIndex(line => line.kind === 'field' && line.index === index);
  const selectedEnd = bodyRows > 1 && lines[selectedLine + 1]?.kind === 'error' ? selectedLine + 1 : selectedLine;
  let start = Math.min(viewportStart.current, Math.max(0, lines.length - bodyRows));
  if (selectedLine < start) {
    start = Math.max(0, selectedLine - (bodyRows > 1 && lines[selectedLine - 1]?.kind === 'header' ? 1 : 0));
  }
  if (selectedEnd >= start + bodyRows) start = selectedEnd - bodyRows + 1;
  viewportStart.current = start;

  const labelWidth = Math.min(26, Math.max(1, contentWidth - 12));
  const footerMessage = status === 'validating' ? 'validating against Azure DevOps…'
    : failure?.message ?? `${index + 1}/${fields.length} · ${field?.group}${field?.hint ? ` · ${field.hint}` : ''}`;
  const footerColor = failure ? COLORS.red : status === 'validating' ? COLORS.amber : COLORS.dim;

  return (
    <Box flexDirection="column" width={width} height={rows} paddingX={padding} overflow="hidden">
      {headerRows > 0 ? (
        <Box height={1} flexShrink={0}>
          <Text wrap="truncate-end">
            <Text color={COLORS.blue} bold>settings</Text>
            <Text color={COLORS.dim}> · the only way to configure fpr</Text>
          </Text>
        </Box>
      ) : null}

      <Box height={bodyRows} flexShrink={0} flexDirection="column" overflow="hidden">
        {lines.slice(start, start + bodyRows).map(line => {
          if (line.kind === 'header') {
            return <Text key={line.key} color={COLORS.bright} bold wrap="truncate-end">{line.group.toUpperCase()}</Text>;
          }
          if (line.kind === 'error') {
            return <Text key={line.key} color={COLORS.red} wrap="truncate-end"> {line.message}</Text>;
          }
          const f = line.field;
          const selected = line.index === index;
          return (
            <Box key={line.key} height={1} flexShrink={0} overflow="hidden">
              <Box width={Math.min(2, contentWidth)} flexShrink={0}>
                <Text color={COLORS.blue} wrap="truncate-end">{selected ? '› ' : '  '}</Text>
              </Box>
              <Box width={labelWidth} flexShrink={0}>
                <Text color={selected ? COLORS.bright : COLORS.text} wrap="truncate-end">{f.label}</Text>
              </Box>
              <Box flexGrow={1} minWidth={0}>
                <Text wrap="truncate-end">
                  {selected && editing ? (
                    <TextInput value={buffer} onChange={setBuffer} onSubmit={finishEdit} focus mask={f.kind === 'secret' ? '*' : undefined} />
                  ) : (
                    <Text color={f.readOnly ? COLORS.dim : COLORS.amber}>{displayValue(f)}</Text>
                  )}
                  {f.hint && selected && !editing ? <Text color={COLORS.dim}> {f.hint}</Text> : null}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      {footerRows > 0 ? (
        <Box height={footerRows} flexShrink={0} flexDirection="column" overflow="hidden">
          {footerRows > 1 ? <Text color={footerColor} wrap="truncate-end">{footerMessage}</Text> : null}
          <Box height={1} flexShrink={0}>
            <Text color={COLORS.dim} wrap="truncate-end">
              {width < 70 ? `j/k move · enter edit · tab group · s save${onCancel ? ' · esc back' : ''}`
                : `j/k move · enter edit/toggle · tab next group · s save${onCancel ? ' · esc cancel' : ''}`}
            </Text>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

function displayValue(field: Field): string {
  if (field.kind !== 'secret') return field.value.length > 0 ? field.value : '—';
  if (field.readOnly) return 'set from environment';
  return field.value.length > 0 ? '•'.repeat(8) : '—';
}
