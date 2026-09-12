import React, {useMemo, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {getMe, listActivePullRequests, resetIdentityCache, ApiError} from './api.ts';
import {getAzAccessToken, resetAzTokenCache} from './azcli.ts';
import {discoverReviewerGroups, type ReviewerGroup} from './classify.ts';
import {clampRefresh, isValid, patFromEnv, saveConfig, type Config} from './config.ts';
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

type Kind = 'text' | 'secret' | 'toggle' | 'picker';

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
      key: 'ui.hideReviewed',
      group: 'Display',
      label: 'hide reviewed',
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
      hint: 'toggle live with d',
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
      hint: 'toggle live with b',
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
}: SettingsProps) {
  const [draft, setDraft] = useState<Config>(() => clone(config));
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [buffer, setBuffer] = useState('');
  const [failure, setFailure] = useState<ValidationFailure | null>(null);
  const [status, setStatus] = useState<'idle' | 'validating'>('idle');
  const [picker, setPicker] = useState<PickerState | null>(null);

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
    if (!target || target.readOnly || target.kind === 'toggle') return;
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
    const candidate = clone(draft);
    candidate.ui.refreshSeconds = clampRefresh(candidate.ui.refreshSeconds);

    if (!isValid(candidate)) {
      setFailure({message: 'organization, at least one project and auth are all required'});
      return;
    }

    setStatus('validating');
    try {
      const result = await validate(candidate);
      if (result) {
        setFailure(result);
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
        else if (input === 'j' || key.downArrow) setPicker({...picker, index: Math.min(picker.index + 1, picker.groups.length - 1)});
        else if (input === 'k' || key.upArrow) setPicker({...picker, index: Math.max(picker.index - 1, 0)});
        else if (key.return) choose(picker.groups[picker.index]);
        return;
      }

      if (key.escape) {
        onCancel?.();
        return;
      }
      if (key.ctrl && input === 's') {
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
        if (target?.kind === 'toggle' && target.toggle) commit(d => target.toggle?.(d));
        else if (target?.kind === 'picker') void openPicker();
        else startEdit();
      }
    },
    {isActive: !editing},
  );

  let lastGroup = '';

  if (picker) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Text color={COLORS.blue} bold>
            reviewer group
          </Text>
          <Text color={COLORS.dim}> · groups already reviewing pull requests in your projects</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          {picker.loading ? <Text color={COLORS.amber}>looking through open pull requests…</Text> : null}
          {picker.error ? <Text color={COLORS.red}>{picker.error}</Text> : null}
          {!picker.loading && !picker.error && picker.groups.length === 0 ? (
            <Text color={COLORS.dim} italic>
              no group is a reviewer on any open PR — check the projects, or use manual mode with a member list
            </Text>
          ) : null}
          {picker.groups.map((group, i) => (
            <Box key={group.descriptor}>
              <Text color={COLORS.blue}>{i === picker.index ? '› ' : '  '}</Text>
              <Box width={40}>
                <Text color={i === picker.index ? COLORS.bright : COLORS.text}>{group.displayName}</Text>
              </Box>
              <Text color={COLORS.dim}>{`reviewer on ${group.prCount} open PR${group.prCount === 1 ? '' : 's'}`}</Text>
            </Box>
          ))}
        </Box>

        <Box marginTop={1}>
          <Text color={COLORS.dim}>j/k move · enter pick · esc back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color={COLORS.blue} bold>
          settings
        </Text>
        <Text color={COLORS.dim}> · the only way to configure fpr</Text>
      </Box>

      {fields.map((f, i) => {
        const header = f.group === lastGroup ? null : f.group;
        lastGroup = f.group;
        const selected = i === index;
        const fieldError = failure?.field === f.key ? failure.message : undefined;

        return (
          <Box key={f.key} flexDirection="column">
            {header ? (
              <Box marginTop={1}>
                <Text color={COLORS.bright} bold>
                  {header.toUpperCase()}
                </Text>
              </Box>
            ) : null}
            <Box>
              <Text color={COLORS.blue}>{selected ? '› ' : '  '}</Text>
              <Box width={26}>
                <Text color={selected ? COLORS.bright : COLORS.text}>{f.label}</Text>
              </Box>
              <Box>
                {selected && editing ? (
                  <TextInput value={buffer} onChange={setBuffer} onSubmit={finishEdit} focus mask={f.kind === 'secret' ? '*' : undefined} />
                ) : (
                  <Text color={f.readOnly ? COLORS.dim : COLORS.amber}>{displayValue(f)}</Text>
                )}
              </Box>
              {f.hint && selected && !editing ? <Text color={COLORS.dim}> {f.hint}</Text> : null}
            </Box>
            {fieldError ? <Text color={COLORS.red}> {fieldError}</Text> : null}
          </Box>
        );
      })}

      <Box marginTop={1} flexDirection="column">
        {status === 'validating' ? <Text color={COLORS.amber}>validating against Azure DevOps…</Text> : null}
        {failure && !failure.field ? <Text color={COLORS.red}>{failure.message}</Text> : null}
        <Text color={COLORS.dim}>
          j/k move · enter edit/toggle · tab next group · ctrl+s save{onCancel ? ' · esc cancel' : ''}
        </Text>
      </Box>
    </Box>
  );
}

function displayValue(field: Field): string {
  if (field.kind !== 'secret') return field.value.length > 0 ? field.value : '—';
  if (field.readOnly) return 'set from environment';
  return field.value.length > 0 ? '•'.repeat(8) : '—';
}
