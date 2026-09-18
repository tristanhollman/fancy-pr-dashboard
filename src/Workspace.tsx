import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';
import SearchInput from './SearchInput.tsx';
import type {Row} from './classify.ts';
import type {Config, WorkspacePreferences} from './config.ts';
import {COLORS, formatAge} from './Dashboard.tsx';
import {useTerminalMouse, isMouseInput, type TerminalMouseEvent} from './terminalMouse.ts';
import {
  clip, keepRowVisible, queueLines, repositoryKey, reviewLabel, rowMetadata, rowKey, scopeFilters, SCOPES,
  workspaceLayout, workspaceRows, wrapText,
  type Pane, type Requirements, type Scope,
} from './workspace.ts';

export interface WorkspaceFileCount {files: number; truncated: boolean}
export interface WorkspaceSession {
  scope: Scope;
  repo: string;
  query: string;
  pane: Pane;
  compactDetails: boolean;
  selection: string;
  queueOffset: number;
  detailScroll: {key: string; offset: number};
  repoCursor: number;
}

export interface WorkspaceProps {
  config: Config;
  rows: Row[];
  requirements: Requirements;
  fileCounts?: Record<string, WorkspaceFileCount | undefined>;
  refreshedAt: number;
  loading?: boolean;
  error?: string;
  warning?: string;
  descriptionLoading?: boolean;
  descriptionError?: string;
  onPreferencesChange: (preferences: WorkspacePreferences) => void;
  onToggleFilter: (key: 'hideDrafts' | 'hideBots') => void;
  onRefresh: () => void;
  onSettings: (session: WorkspaceSession) => void;
  onQuit: () => void;
  onOpen: (row: Row) => void;
  onSelectionChange?: (row: Row | undefined) => void;
  initialSession?: WorkspaceSession;
  columns?: number;
  height?: number;
}

interface DisplayLine {text: string; color?: string; bold?: boolean}
interface FooterItem {key: string; label: string}
const HELP = '1-4 switch scope · Tab cycle panes · j/k or arrows navigate · g/G first/last · Enter open PR (or select repo) · / search, Esc clears · f repository picker · o sort date · p details · t repositories · u grouping · [/] resize list (or sidebar when repositories are focused) · h hide my reviewed in queue · c hide required-complete in queue · d drafts · b bots · r refresh · s settings · q quit. Mouse: drag dividers, click rows, wheel scroll. Unknown requirements never count as complete.\n\nScopes: Team queue = your team is a reviewer, excluding your own PRs; reviewed/required-complete filters apply here. Assigned = you are individually listed as reviewer. My PRs = authored by you, with separate draft/bot preferences. All open = every open PR in configured projects/repos, subject to the shared draft/bot filters. Scopes overlap; their totals do not add up. Tab totals are before search/repository filtering.\n\nIn My PRs, d/b change only your own tab. Drafts are shown there by default. In other scopes, d/b use the shared preferences.';

function footerRows(items: FooterItem[], width: number, maxLines: number) {
  const lines: {text: string; items: {key: string; start: number; end: number}[]}[] = [{text: '', items: []}];
  for (const item of items) {
    const text = `${item.key} ${item.label}`;
    let line = lines.at(-1)!;
    if (line.text && Bun.stringWidth(`${line.text}  ${text}`) > width) {
      if (lines.length >= maxLines) break;
      line = {text: '', items: []};
      lines.push(line);
    }
    const start = Bun.stringWidth(line.text) + (line.text ? 2 : 0);
    line.text += `${line.text ? '  ' : ''}${clip(text, width)}`;
    line.items.push({key: item.key, start, end: Bun.stringWidth(line.text)});
  }
  return lines;
}

function Panel({title, width, height, active, children, footer}: {
  title: string; width: number; height: number; active: boolean; children: React.ReactNode; footer?: string;
}) {
  return (
    <Box flexDirection="column" width={width} height={height} borderStyle="round"
      borderColor={active ? COLORS.green : COLORS.dim} paddingX={1} flexShrink={0}>
      <Text bold color={active ? COLORS.green : COLORS.text} wrap="truncate-end">{clip(title, width - 4)}</Text>
      <Box flexDirection="column" height={Math.max(0, height - 4)} overflow="hidden">{children}</Box>
      <Text color={COLORS.dim} wrap="truncate-end">{clip(footer ?? '', width - 4)}</Text>
    </Box>
  );
}

function textLines(lines: DisplayLine[], width: number) {
  return lines.flatMap(line => wrapText(line.text, width).map(text => ({...line, text})));
}

export default function Workspace(props: WorkspaceProps) {
  const size = useWindowSize();
  const columns = Math.max(1, props.columns ?? size.columns ?? 100);
  const height = Math.max(1, props.height ?? size.rows ?? 24);
  const preferences = props.config.ui.workspace;
  const session = props.initialSession;
  const [scope, setScope] = useState<Scope>(session?.scope ?? 'team');
  const [repo, setRepo] = useState(session?.repo ?? '');
  const [query, setQuery] = useState(session?.query ?? '');
  const [searching, setSearching] = useState(false);
  const [picker, setPicker] = useState(false);
  const [help, setHelp] = useState(false);
  const [helpOffset, setHelpOffset] = useState(0);
  const [pane, setPane] = useState<Pane>(session?.pane ?? 'queue');
  const [compactDetails, setCompactDetails] = useState(session?.compactDetails ?? false);
  const [selection, setSelection] = useState(session?.selection ?? '');
  const [queueOffset, setQueueOffset] = useState(session?.queueOffset ?? 0);
  const [detailScroll, setDetailScroll] = useState(session?.detailScroll ?? {key: '', offset: 0});
  const [repoCursor, setRepoCursor] = useState(session?.repoCursor ?? 0);
  const [notice, setNotice] = useState('');
  const [drag, setDragState] = useState<'repo' | 'list' | null>(null);
  const dragRef = useRef<typeof drag>(null);
  const setDrag = (value: typeof drag) => {
    dragRef.current = value;
    setDragState(value);
  };
  const data = useMemo(() => workspaceRows(props.rows, props.config, props.requirements, scope, repo, query),
    [props.rows, props.config, props.requirements, scope, repo, query]);
  const selected = data.rows.find(row => rowKey(row) === selection) ?? data.rows[0];
  const selectedKey = selected ? rowKey(selected) : '';
  const layout = workspaceLayout(columns, height, preferences, compactDetails);
  const filters = scopeFilters(props.config, scope);
  const focus: Pane = pane === 'repos' && !layout.sidebar ? 'queue'
    : pane === 'details' && !layout.details ? 'queue' : pane;
  const repositoryOptions = [{key: '', name: 'All repositories', project: ''}, ...data.repositories];
  const activeRepo = repositoryOptions.find(item => item.key === repo);
  const selectedRepoCursor = Math.min(repoCursor, repositoryOptions.length - 1);
  const requirement = props.requirements[selectedKey];
  const count = props.fileCounts?.[selectedKey];

  useEffect(() => {
    if (selection !== selectedKey) setSelection(selectedKey);
    props.onSelectionChange?.(selected);
  }, [selectedKey, selected]);
  useEffect(() => {
    setDrag(null);
  }, [columns, height, preferences.showRepositories, preferences.showDetails]);

  const update = (next: Partial<WorkspacePreferences>) => props.onPreferencesChange({...preferences, ...next});
  const toggle = (key: 'showRepositories' | 'showDetails' | 'groupByRepo' | 'hideReviewed' | 'hideComplete') => update({[key]: !preferences[key]});
  const open = () => {
    if (selected) props.onOpen(selected);
    else setNotice('No pull request selected.');
  };
  const move = (delta: number) => {
    setSelection(previous => {
      const index = data.rows.findIndex(row => rowKey(row) === (previous || selectedKey));
      const next = data.rows[Math.max(0, Math.min(data.rows.length - 1, index + delta))];
      return next ? rowKey(next) : previous;
    });
  };
  const resize = (delta: number) => {
    if (focus === 'repos' && layout.sidebar) {
      update({repoWidth: Math.max(16, Math.min(36, preferences.repoWidth + delta))});
      return;
    }
    if (layout.compact || !layout.details) { setNotice('Open details in a wider window to resize.'); return; }
    update({listShare: Math.max(40, Math.min(columns - layout.queueX - 37, layout.queueWidth + delta)) / columns});
  };
  const changeRepo = (index: number) => {
    const option = repositoryOptions[index];
    if (!option) return;
    setRepo(option.key);
    setPicker(false);
    setPane('queue');
  };
  const showDetails = () => {
    if (layout.compact) {
      setCompactDetails(!compactDetails);
      setPane(compactDetails ? 'queue' : 'details');
    } else {
      toggle('showDetails');
      setPane(layout.details ? 'queue' : 'details');
    }
  };
  const items: FooterItem[] = [
    {key: 'j/k', label: 'move'}, {key: 'Tab', label: 'pane'}, {key: 'Enter', label: 'open'}, {key: '?', label: 'help'},
    {key: 'q', label: 'quit'}, {key: 'p', label: `details:${layout.details ? 'on' : 'off'}`},
    {key: 't', label: `repos:${preferences.showRepositories ? layout.sidebar ? 'on' : 'auto' : 'off'}`},
    {key: 'u', label: preferences.groupByRepo ? 'grouped' : 'flat'}, {key: 's', label: 'settings'}, {key: 'r', label: 'refresh'},
    {key: '/', label: 'find'}, {key: 'f', label: 'repo'}, {key: 'o', label: preferences.sort},
    {key: '[', label: focus === 'repos' ? 'repos-' : 'list-'}, {key: ']', label: focus === 'repos' ? 'repos+' : 'list+'},
    {key: 'd', label: `${scope === 'mine' ? 'my drafts' : 'drafts'}:${filters.hideDrafts ? 'hidden' : 'shown'}`},
    {key: 'b', label: `${scope === 'mine' ? 'my bots' : 'bots'}:${filters.hideBots ? 'hidden' : 'shown'}`},
    ...(scope === 'team' ? [{key: 'h', label: `reviewed:${preferences.hideReviewed ? 'hidden' : 'shown'}`},
      {key: 'c', label: `req.met:${preferences.hideComplete ? 'hidden' : 'shown'}`}] : []),
  ];
  const footer = footerRows(items, columns, layout.short ? 1 : columns < 96 ? 4 : 3);
  const headerHeight = height < 12 ? 2 : 4;
  const bodyHeight = Math.max(4, height - headerHeight - footer.length);
  const contentHeight = Math.max(1, bodyHeight - 4);
  const helpLines = wrapText(HELP, columns - 4);
  const helpStart = Math.min(helpOffset, Math.max(0, helpLines.length - contentHeight));
  const lines = queueLines(data.rows, preferences.groupByRepo);
  const start = keepRowVisible(queueOffset, selectedKey, lines, contentHeight);
  useEffect(() => { if (start !== queueOffset) setQueueOffset(start); }, [start, queueOffset]);
  const repoStart = Math.max(0, selectedRepoCursor - contentHeight + 1);

  const detailLines = textLines(selected ? [
    {text: `${selected.project} / ${selected.repo} / !${selected.id}`, color: COLORS.blue},
    {text: selected.title, bold: true, color: COLORS.bright},
    {text: `${selected.author} · ${formatAge(selected.ageMs)} · ${count ? `${count.files}${count.truncated ? '+' : ''} files` : 'files pending'}`, color: COLORS.dim},
    {text: `${selected.sourceBranch || '?'} -> ${selected.targetBranch || '?'}`, color: COLORS.violet},
    {text: ''},
    {text: `Review requirements: ${reviewLabel(requirement)} (${requirement?.status ?? 'loading'})`, color: requirement?.status === 'complete' ? COLORS.green : COLORS.amber},
    ...(requirement?.minimum ? [{text: `Minimum approvals: ${requirement.minimum.approved}/${requirement.minimum.required}`}] : []),
    {text: `Required people/groups: ${requirement ? `${requirement.requiredReviewers.approved}/${requirement.requiredReviewers.total}` : 'unknown'}`},
    {text: 'Build / merge readiness is separate.', color: COLORS.dim},
    ...(requirement?.notes.map(text => ({text, color: COLORS.dim})) ?? []),
    {text: ''}, {text: `DESCRIPTION${props.descriptionLoading ? ' (loading full text...)' : ''}`, color: COLORS.blue, bold: true},
    ...(props.descriptionError ? [{text: `Full description unavailable: ${props.descriptionError}. List preview may be truncated; r retries.`, color: COLORS.amber}] : []),
    {text: selected.description || 'No description provided.'},
    {text: ''}, {text: 'REVIEWERS', color: COLORS.blue, bold: true},
    ...selected.reviewers.map(reviewer => ({
      text: `${reviewer.vote >= 5 ? '+' : reviewer.vote < 0 ? '!' : '-'} ${reviewer.displayName || reviewer.uniqueName || '(unnamed)'} (${reviewer.isContainer ? 'group' : 'person'}${reviewer.isRequired ? ', required' : ''}): ${reviewer.vote >= 5 ? 'approved' : reviewer.vote === -5 ? 'waiting for author' : reviewer.vote === -10 ? 'changes requested' : 'pending'}`,
      color: reviewer.vote >= 5 ? COLORS.green : reviewer.vote < 0 ? COLORS.red : COLORS.amber,
    })),
  ] : [{text: 'Select a pull request to read its description.'}], Math.max(1, layout.detailWidth - 4));
  const detailOffset = Math.min(detailScroll.key === selectedKey ? detailScroll.offset : 0, Math.max(0, detailLines.length - contentHeight));
  const scrollDetail = (delta: number) => setDetailScroll(previous => ({key: selectedKey,
    offset: Math.max(0, Math.min(detailLines.length - contentHeight, (previous.key === selectedKey ? previous.offset : 0) + delta))}));

  const command = (input: string) => {
    setNotice('');
    if (input === 'q') { props.onQuit(); return; }
    if (input === 's') {
      props.onSettings({scope, repo, query, pane: focus, compactDetails, selection: selectedKey,
        queueOffset: start, detailScroll: {key: selectedKey, offset: detailOffset}, repoCursor: selectedRepoCursor});
      return;
    }
    if (input === 'r') { props.onRefresh(); return; }
    if (input === '?') { setHelp(!help); setHelpOffset(0); return; }
    if (input === 'escape') {
      setDrag(null);
      setHelp(false); setPicker(false); setSearching(false); setCompactDetails(false); setPane('queue');
      return;
    }
    if (help) {
      const delta = input === 'g' ? -helpLines.length : input === 'G' ? helpLines.length : input === 'k' ? -1 : input === 'j' ? 1 : 0;
      setHelpOffset(Math.max(0, Math.min(helpLines.length - contentHeight, helpStart + delta)));
      return;
    }
    if (input === 'f') { setPicker(!picker); setRepoCursor(Math.max(0, repositoryOptions.findIndex(item => item.key === repo))); return; }
    if (input === '/') { setSearching(true); return; }
    if (input === 'Tab') {
      const panes: Pane[] = [...(layout.sidebar ? ['repos' as const] : []), 'queue', ...(layout.details ? ['details' as const] : [])];
      setPane(panes[(panes.indexOf(focus) + 1) % panes.length]!);
      return;
    }
    if (input === 'j' || input === 'k' || input === 'j/k') {
      const delta = input === 'k' ? -1 : 1;
      if (picker || focus === 'repos') setRepoCursor(Math.max(0, Math.min(repositoryOptions.length - 1, selectedRepoCursor + delta)));
      else if (focus === 'details' || (layout.compact && layout.details)) scrollDetail(delta);
      else move(delta);
      return;
    }
    if (input === 'Enter') {
      if (picker || focus === 'repos') changeRepo(selectedRepoCursor);
      else open();
      return;
    }
    const nextScope = SCOPES[Number(input) - 1];
    if (nextScope && /^[1-4]$/.test(input)) { setScope(nextScope.key); setPane('queue'); setCompactDetails(false); return; }
    if (input === 'p') showDetails();
    else if (input === 't') toggle('showRepositories');
    else if (input === 'u') toggle('groupByRepo');
    else if (input === 'h' || input === 'c') {
      toggle(input === 'h' ? 'hideReviewed' : 'hideComplete');
      if (scope !== 'team') setNotice('Filter applies to Team queue only.');
    } else if (input === 'o') update({sort: preferences.sort === 'newest' ? 'oldest' : 'newest'});
    else if (input === 'd' || input === 'b') {
      if (scope === 'mine') {
        const key = input === 'd' ? 'hideMyDrafts' : 'hideMyBots';
        update({[key]: !preferences[key]});
      } else props.onToggleFilter(input === 'd' ? 'hideDrafts' : 'hideBots');
    }
    else if (input === '[' || input === ']') resize(input === '[' ? -3 : 3);
    else if (input === 'g' || input === 'G') {
      if (focus === 'details') scrollDetail(input === 'g' ? -detailLines.length : detailLines.length);
      else {
        const row = input === 'g' ? data.rows[0] : data.rows.at(-1);
        if (row) setSelection(rowKey(row));
      }
    }
  };

  useInput((input, key) => {
    if (isMouseInput(input)) return;
    if (key.ctrl && input === 'c') { props.onQuit(); return; }
    if ((columns < 40 || height < 8) && input !== 'q' && input !== 's') return;
    if (searching) {
      if (key.escape) { setQuery(''); setSearching(false); }
      return;
    }
    command(key.escape ? 'escape' : key.tab ? 'Tab' : key.return ? 'Enter'
      : key.downArrow ? 'j' : key.upArrow ? 'k' : key.pageDown ? 'G' : key.pageUp ? 'g' : input);
  });

  const mouse = (event: TerminalMouseEvent) => {
    if (searching || help || picker) return;
    const {x, y} = event;
    if (event.kind === 'release') { setDrag(null); return; }
    if (event.kind === 'move' && dragRef.current) {
      if (dragRef.current === 'repo') update({repoWidth: Math.max(16, Math.min(36, x))});
      else update({listShare: Math.max(40, Math.min(columns - layout.queueX - 37, x - layout.queueX)) / columns});
      return;
    }
    if (event.kind === 'press' && event.button === 0) {
      const footerLine = footer[y - (height - footer.length)];
      if (footerLine) {
        const hit = footerLine.items.find(item => x >= item.start && x < item.end);
        if (hit) command(hit.key);
        return;
      }
      if (y === 1) {
        const next = SCOPES[Math.min(3, Math.floor(x / Math.max(1, Math.floor(columns / 4))))];
        if (next) { setScope(next.key); setCompactDetails(false); setPane('queue'); }
        return;
      }
      if (y < headerHeight || y >= headerHeight + bodyHeight) return;
      if (layout.sidebar && Math.abs(x - layout.repoWidth) <= 1) { setDrag('repo'); return; }
      if (!layout.compact && layout.details && Math.abs(x - (layout.detailX - 1)) <= 1) { setDrag('list'); return; }
      if (layout.sidebar && x < layout.repoWidth) {
        const index = repoStart + y - headerHeight - 2;
        if (index >= 0) { setRepoCursor(index); changeRepo(index); }
      } else if (layout.details && x >= layout.detailX) setPane('details');
      else {
        setPane('queue');
        const line = lines[start + y - headerHeight - 2];
        if (line && 'row' in line) setSelection(rowKey(line.row));
      }
    } else if (event.kind === 'wheel' && event.direction) {
      if (layout.details && x >= layout.detailX) scrollDetail(event.direction === 'up' ? -3 : 3);
      else move(event.direction === 'up' ? -3 : 3);
    }
  };
  useTerminalMouse(mouse, preferences.mouseEnabled);

  if (columns < 40 || height < 8) {
    return <Box height={height} width={columns} flexDirection="column"><Text wrap="truncate-end">Window too small (min 40x8).</Text><Text wrap="truncate-end">s settings / q quit</Text></Box>;
  }
  const status = props.error ? `Refresh failed - cached data: ${props.error}`
    : props.warning || notice || `${data.rows.length} visible of ${data.counts[scope]} in scope; ${data.hidden.drafts} drafts, ${data.hidden.bots} bots hidden${scope === 'team' ? `; queue hides ${data.hidden.reviewed} reviewed + ${data.hidden.complete} required met` : ''}`;
  const repoLabel = repo ? activeRepo ? `${activeRepo.project}/${activeRepo.name}` : 'filtered repository' : 'All repositories';
  const empty = props.loading && props.rows.length === 0 ? 'Loading pull requests...'
    : props.error && props.rows.length === 0 ? props.error
    : !data.rows.length ? query || repo ? 'No matching PRs. Clear search/repo, or use h/c/d/b to show hidden PRs.'
      : scope === 'team' && !props.config.team.members.length && props.config.team.mode === 'manual'
        ? 'No team configured. Press s to configure your team.'
        : 'Nothing waiting here. Other scopes and hidden filters may contain PRs.'
      : '';
  const divider = (active: boolean) => <Box width={1} flexShrink={0} flexDirection="column">{Array.from({length: bodyHeight}, (_, index) =>
    <Text key={index} color={active ? COLORS.green : COLORS.dim}>{index === Math.floor(bodyHeight / 2) ? ':' : '│'}</Text>)}</Box>;
  const headerScopeWidth = Math.floor(columns / 4);
  const renderQueue = () => <Panel title={`${SCOPES.find(item => item.key === scope)?.label} · ${data.rows.length}`} width={layout.queueWidth} height={bodyHeight} active={focus === 'queue'}
    footer={`${data.rows.findIndex(row => rowKey(row) === selectedKey) + 1}/${data.rows.length} selected · ${preferences.groupByRepo ? 'grouped' : preferences.sort} · ${Math.max(0, lines.length - start - contentHeight)} more`}>
    {empty ? wrapText(empty, layout.queueWidth - 4).slice(0, contentHeight).map((text, i) => <Text key={i} color={COLORS.dim}>{text}</Text>)
      : lines.slice(start, start + contentHeight).map((line, i) => {
        if (line.kind === 'repo') return <Text key={i} color={COLORS.blue} bold wrap="truncate-end">{clip(line.text, layout.queueWidth - 4)}</Text>;
        if (line.kind === 'spacer') return <Text key={i}> </Text>;
        const row = line.row;
        const active = rowKey(row) === selectedKey;
        const width = layout.queueWidth - 4;
        const summary = props.requirements[rowKey(row)];
        if (line.kind === 'title') {
          const progress = reviewLabel(summary);
          const progressWidth = Math.min(13, width - 12);
          return <Box key={i}><Box width={width - progressWidth} flexShrink={0}><Text bold={active} color={active ? COLORS.bright : COLORS.text} backgroundColor={active ? '#233c41' : undefined} wrap="truncate-end">{clip(`${active ? '>' : ' '} ${row.title}`, width - progressWidth)}</Text></Box>
            <Box width={progressWidth}><Text color={summary?.status === 'complete' ? COLORS.green : COLORS.amber} wrap="truncate-end">{clip(progress, progressWidth)}</Text></Box></Box>;
        }
        const file = props.fileCounts?.[rowKey(row)];
        const text = line.kind === 'repository' ? `  ${row.project}/${row.repo}`
          : rowMetadata(row, formatAge(row.ageMs), file, width);
        return <Text key={i} color={line.kind === 'repository' ? COLORS.blue : active ? COLORS.amber : COLORS.dim} wrap="truncate-end">{clip(text, width)}</Text>;
      })}
  </Panel>;
  return (
    <Box width={columns} height={height} flexDirection="column">
      {searching && headerHeight === 2 ? <Box height={1}><Text color={COLORS.blue}>/ </Text><SearchInput initialValue={query} width={columns - 2} onChange={setQuery} onSubmit={() => setSearching(false)} /></Box>
        : <Text bold color={COLORS.green} wrap="truncate-end">{clip(`fpr · ${props.config.org} / ${props.config.projects.join(', ')} · ${props.loading ? 'refreshing...' : props.refreshedAt ? `refreshed ${formatAge(Date.now() - props.refreshedAt)} ago` : 'not loaded'}`, columns)}</Text>}
      <Box height={1}>{SCOPES.map((item, index) => <Box key={item.key} width={index === 3 ? columns - headerScopeWidth * 3 : headerScopeWidth}><Text color={scope === item.key ? COLORS.green : COLORS.dim} bold={scope === item.key} wrap="truncate-end">{clip(`${index + 1} ${columns < 100 ? ['Queue', 'Assigned', 'Mine', 'All'][index] : item.label} ${props.loading && !props.rows.length ? '--' : data.counts[item.key]}`, headerScopeWidth)}</Text></Box>)}</Box>
      {headerHeight > 2 && <>
        {searching ? <Box height={1}><Text color={COLORS.blue}>/ </Text><SearchInput initialValue={query} width={columns - 2} onChange={setQuery} onSubmit={() => setSearching(false)} /></Box>
          : <Text color={COLORS.dim} wrap="truncate-end">{clip(`/ ${query || 'Search PRs'}   f Repo: ${repoLabel}   o ${preferences.sort}`, columns)}</Text>}
        <Text color={props.error ? COLORS.red : props.warning || notice ? COLORS.amber : COLORS.dim} wrap="truncate-end">{clip(status, columns)}</Text>
      </>}
      <Box height={bodyHeight}>
        {help ? <Panel title="Keyboard help · Esc closes" width={columns} height={bodyHeight} active footer="j/k scroll · g/G first/last · Esc close">
          {helpLines.slice(helpStart, helpStart + contentHeight).map((text, i) => <Text key={i}>{text}</Text>)}
        </Panel> : picker ? <Panel title="Repository filter · Enter selects · Esc cancels" width={columns} height={bodyHeight} active footer={`${selectedRepoCursor + 1}/${repositoryOptions.length}`}>
          {repositoryOptions.slice(repoStart, repoStart + contentHeight).map((item, i) => <Text key={item.key} color={repoStart + i === selectedRepoCursor ? COLORS.green : COLORS.text} wrap="truncate-end">{clip(`${repoStart + i === selectedRepoCursor ? '>' : ' '} ${item.project ? `${item.project}/` : ''}${item.name}`, columns - 4)}</Text>)}
        </Panel> : <>
          {layout.sidebar && <>
            <Panel title="Repositories" width={layout.repoWidth} height={bodyHeight} active={focus === 'repos'} footer="Tab focus · Enter filter">
              {repositoryOptions.slice(repoStart, repoStart + contentHeight).map((item, i) => <Text key={item.key} color={repo === item.key ? COLORS.green : COLORS.dim} bold={repoStart + i === selectedRepoCursor && focus === 'repos'} wrap="truncate-end">{clip(`${repo === item.key ? '>' : ' '} ${item.project ? `${item.project}/` : ''}${item.name}`, layout.repoWidth - 4)}</Text>)}
            </Panel>{divider(drag === 'repo')}
          </>}
          {layout.queueWidth > 0 && renderQueue()}
          {!layout.compact && layout.details && divider(drag === 'list')}
          {layout.details && <Panel title="PR inspector" width={layout.detailWidth} height={bodyHeight} active={focus === 'details'} footer={`${detailOffset + 1}/${detailLines.length} · ${layout.compact ? 'p back' : 'Tab focus'} · j/k scroll`}>
            {detailLines.slice(detailOffset, detailOffset + contentHeight).map((line, i) => <Text key={i} color={line.color ?? COLORS.text} bold={line.bold}>{line.text || ' '}</Text>)}
          </Panel>}
        </>}
      </Box>
      {footer.map((line, index) => <Text key={index} color={COLORS.dim} wrap="truncate-end">{clip(line.text, columns)}</Text>)}
    </Box>
  );
}
