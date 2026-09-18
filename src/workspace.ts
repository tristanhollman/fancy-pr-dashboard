import type {Row} from './classify.ts';
import type {Config, WorkspacePreferences} from './config.ts';
import type {ReviewRequirements} from './reviews.ts';

export type Scope = 'team' | 'assigned' | 'mine' | 'all';
export type Pane = 'repos' | 'queue' | 'details';
export type Requirements = Record<string, ReviewRequirements | undefined>;
export const SCOPES: {key: Scope; label: string}[] = [
  {key: 'team', label: 'Team queue'},
  {key: 'assigned', label: 'Assigned to me'},
  {key: 'mine', label: 'My PRs'},
  {key: 'all', label: 'All open'},
];

export function rowKey(row: Pick<Row, 'project' | 'repo' | 'id'>): string {
  return JSON.stringify([row.project, row.repo, row.id]);
}

export function repositoryKey(row: Pick<Row, 'project' | 'repo'>): string {
  return JSON.stringify([row.project, row.repo]);
}

export function scopeMatches(row: Row, scope: Scope, config: Config): boolean {
  if (scope === 'all') return true;
  if (scope === 'mine') return row.isMine;
  if (row.isMine) return false;
  if (scope === 'assigned') return row.assignedToMe;
  return row.isTeamReviewer && (!config.ui.dedupeAssignedFromTeamSection || row.teamViaOthers);
}

export function scopeFilters(config: Config, scope: Scope): {hideDrafts: boolean; hideBots: boolean} {
  return scope === 'mine'
    ? {hideDrafts: config.ui.workspace.hideMyDrafts, hideBots: config.ui.workspace.hideMyBots}
    : {hideDrafts: config.ui.hideDrafts, hideBots: config.ui.hideBots};
}

function passesFilters(row: Pick<Row, 'isDraft' | 'isBot'>, filters: ReturnType<typeof scopeFilters>): boolean {
  return !(filters.hideDrafts && row.isDraft) && !(filters.hideBots && row.isBot);
}

export function visibleInAnyScope(row: Pick<Row, 'isMine' | 'isDraft' | 'isBot'>, config: Config): boolean {
  return passesFilters(row, scopeFilters(config, 'all')) || (row.isMine && passesFilters(row, scopeFilters(config, 'mine')));
}

export function workspaceRows(rows: Row[], config: Config, requirements: Requirements, scope: Scope, repo = '', query = '') {
  const hidden = {drafts: 0, bots: 0, reviewed: 0, complete: 0};
  const scopeRows = (key: Scope, count = false) => rows.filter(row => {
    if (!scopeMatches(row, key, config)) return false;
    const filters = scopeFilters(config, key);
    if (filters.hideDrafts && row.isDraft) {
      if (count) hidden.drafts++;
      return false;
    }
    if (filters.hideBots && row.isBot) {
      if (count) hidden.bots++;
      return false;
    }
    if (key !== 'team') return true;
    if (config.ui.workspace.hideReviewed && row.personal !== 'none') {
      if (count) hidden.reviewed++;
      return false;
    }
    if (config.ui.workspace.hideComplete && requirements[rowKey(row)]?.status === 'complete') {
      if (count) hidden.complete++;
      return false;
    }
    return true;
  });
  const counts: Record<Scope, number> = {
    team: scopeRows('team').length, assigned: scopeRows('assigned').length,
    mine: scopeRows('mine').length, all: scopeRows('all').length,
  };
  const scoped = scopeRows(scope, true);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = scoped.filter(row => (!repo || repositoryKey(row) === repo)
    && `${row.id} ${row.title} ${row.repo} ${row.project} ${row.author}`.toLocaleLowerCase().includes(needle));
  filtered.sort((a, b) => {
    const byRepo = config.ui.workspace.groupByRepo
      ? a.project.localeCompare(b.project) || a.repo.localeCompare(b.repo)
      : 0;
    return byRepo || (config.ui.workspace.sort === 'oldest' ? b.ageMs - a.ageMs : a.ageMs - b.ageMs)
      || rowKey(a).localeCompare(rowKey(b));
  });
  const repositories = [...new Map(scoped.map(row => [repositoryKey(row), {
    key: repositoryKey(row), name: row.repo, project: row.project,
  }])).values()].sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name));
  return {rows: filtered, repositories, counts, hidden};
}

export interface WorkspaceLayout {
  columns: number;
  height: number;
  compact: boolean;
  short: boolean;
  sidebar: boolean;
  details: boolean;
  repoWidth: number;
  queueWidth: number;
  detailWidth: number;
  queueX: number;
  detailX: number;
}

export function workspaceLayout(columns: number, height: number, preferences: WorkspacePreferences, compactDetails = false): WorkspaceLayout {
  const width = Math.max(1, Math.floor(columns));
  const short = height < 16;
  const compact = width < 96 || short;
  const sidebar = !compact && width >= 132 && preferences.showRepositories;
  const details = compact ? compactDetails : preferences.showDetails;
  const repoWidth = sidebar ? Math.max(16, Math.min(36, preferences.repoWidth)) : 0;
  const queueX = sidebar ? repoWidth + 1 : 0;
  const available = width - queueX;
  const queueWidth = compact ? (details ? 0 : width)
    : details ? Math.max(40, Math.min(available - 37, Math.floor(width * preferences.listShare))) : available;
  const detailX = compact ? 0 : queueX + queueWidth + 1;
  return {columns: width, height, compact, short, sidebar, details, repoWidth, queueWidth, queueX, detailX,
    detailWidth: details ? compact ? width : width - detailX : 0};
}

export type QueueLine =
  | {kind: 'repo'; text: string}
  | {kind: 'spacer'}
  | {kind: 'title' | 'meta' | 'repository'; row: Row};

export function queueLines(rows: Row[], grouped: boolean): QueueLine[] {
  const lines: QueueLine[] = [];
  let lastRepo = '';
  for (const row of rows) {
    if (lines.length > 0) lines.push({kind: 'spacer'});
    const key = repositoryKey(row);
    if (grouped && key !== lastRepo) lines.push({kind: 'repo', text: `${row.project} / ${row.repo}`});
    lines.push({kind: 'title', row});
    if (!grouped) lines.push({kind: 'repository', row});
    lines.push({kind: 'meta', row});
    lastRepo = key;
  }
  return lines;
}

export function keepRowVisible(previous: number, selectedKey: string, lines: QueueLine[], height: number): number {
  const first = lines.findIndex(line => 'row' in line && rowKey(line.row) === selectedKey);
  const last = lines.findLastIndex(line => 'row' in line && rowKey(line.row) === selectedKey);
  const max = Math.max(0, lines.length - height);
  let next = Math.max(0, Math.min(previous, max));
  if (first >= 0 && first < next) next = first;
  else if (last >= next + height) next = Math.min(first, last - height + 1);
  return Math.max(0, Math.min(max, next));
}

/** Terminal data must never be interpreted as an escape sequence or cursor command. */
export function terminalText(value: string, multiline = false): string {
  const withoutEscapes = value
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[PX^_][\s\S]*?(?:\x1b\\|$)/g, '');
  return withoutEscapes.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
    .replace(multiline ? /[\x00-\x09\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g
      : /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '');
}

export function clip(value: string, width: number): string {
  if (width <= 0) return '';
  let result = '';
  for (const char of terminalText(value)) {
    if (Bun.stringWidth(result + char) > width) break;
    result += char;
  }
  return result;
}

export function wrapText(value: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const result: string[] = [];
  for (const paragraph of terminalText(value, true).split('\n')) {
    if (!paragraph) { result.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/ +/)) {
      if (line && Bun.stringWidth(`${line} ${word}`) <= safeWidth) { line += ` ${word}`; continue; }
      if (line) result.push(line);
      line = '';
      for (const char of word) {
        if (Bun.stringWidth(line + char) > safeWidth) {
          if (line) result.push(line);
          line = '';
        }
        if (Bun.stringWidth(char) <= safeWidth) line += char;
      }
    }
    if (line) result.push(line);
  }
  return result;
}

export function reviewLabel(requirement: ReviewRequirements | undefined): string {
  if (!requirement || requirement.status === 'unknown') return 'Unknown';
  if (requirement.status === 'none') return 'None';
  if (requirement.minimum) {
    const {approved, required} = requirement.minimum;
    return `${approved}/${required}${requirement.requiredReviewers.total ? ' +req' : ''}`;
  }
  return `${requirement.requiredReviewers.approved}/${requirement.requiredReviewers.total} req`;
}

export function rowAction(row: Row): string {
  if (row.isDraft) return 'Draft';
  if (row.isMine) return 'Your PR';
  if (row.personal === 'approved') return 'You approved';
  if (row.personal === 'waiting') return 'Author turn';
  if (row.personal === 'rejected') return 'You requested changes';
  return row.assignedToMe ? 'Your review' : '';
}

export function rowMetadata(row: Row, age: string, file: {files: number; truncated: boolean} | undefined, width: number): string {
  const prefix = `  !${row.id} ${age} `;
  const action = rowAction(row);
  const suffix = `${file ? ` · ${file.files}${file.truncated ? '+' : ''}f` : ''}${action ? ` · ${action}` : ''}`;
  const author = `@${row.isMine ? 'you' : terminalText(row.author).trim() || '(unknown)'}`;
  // Author identity takes priority over trailing status text on narrow panes.
  const authorWidth = Math.max(10, width - Bun.stringWidth(prefix + suffix));
  const label = Bun.stringWidth(author) > authorWidth ? `${clip(author, authorWidth - 1)}…` : author;
  return clip(`${prefix}${label}${suffix}`, width);
}
