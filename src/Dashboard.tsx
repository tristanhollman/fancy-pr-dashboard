import React, {useState} from 'react';
import {Box, Text, useWindowSize} from 'ink';
import {awaitsAuthor, flattenSections, type Row, type Sections} from './classify.ts';
import type {Config} from './config.ts';

/** Colour roles from adopr-mockup.html. */
export const COLORS = {
  text: '#c7cbd4',
  dim: '#5c6270',
  bright: '#f2f4f8',
  green: '#6fcf8f',
  amber: '#e5b567',
  red: '#e0707a',
  blue: '#6ea8e0',
  violet: '#b58ce0',
} as const;

/** Below this many columns the author, pills and repo tag are dropped. */
const NARROW_COLUMNS = 80;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatAge(ms: number): string {
  if (ms < MINUTE) return `${Math.max(0, Math.floor(ms / 1000))}s`;
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}

/**
 * OSC 8 hyperlink. Windows Terminal, WezTerm, iTerm2 and friends make the text clickable;
 * terminals without support just print the label, and Ink's width measurement strips the
 * escapes, so the column layout is unaffected either way. Cheaper than mouse handling.
 */
export function hyperlink(label: string, url: string): string {
  const OSC = '\u001b]8;;';
  const BEL = '\u0007';
  return `${OSC}${url}${BEL}${label}${OSC}${BEL}`;
}

function ageColor(row: Row): string {
  if (row.staleness === 'fresh') return COLORS.green;
  if (row.staleness === 'stale') return COLORS.red;
  return COLORS.dim;
}

const CURSOR_WIDTH = 2;
const AGE_WIDTH = 5;
const ID_WIDTH = 7;
const FILES_WIDTH = 6;
const AUTHOR_WIDTH = 16;
const PILLS_WIDTH = 26;

/** Changed-file counts, keyed by PR id. Absent = not fetched yet. */
export type FileCounts = Record<number, {files: number; truncated: boolean} | undefined>;

interface RowProps {
  row: Row;
  columns: number;
  /** "Created by You" rows show review progress instead of my own vote. */
  mine?: boolean;
  accent?: string;
  selected?: boolean;
  files?: {files: number; truncated: boolean};
}

/** Big diffs are the ones worth noticing before you open them. */
function filesColor(files: number): string {
  if (files >= 20) return COLORS.red;
  if (files >= 8) return COLORS.amber;
  return COLORS.dim;
}

/**
 * At most 5 characters, always. The viewport slices the list assuming one line per row, so a
 * cell that wraps would silently shift every row below it.
 */
export function formatFileCount({files, truncated}: {files: number; truncated: boolean}): string {
  const capped = Math.min(files, 999);
  return `${capped}${truncated || files > capped ? '+' : ''}f`;
}

function PullRequestRow({row, columns, mine = false, accent, selected = false, files}: RowProps) {
  const narrow = columns < NARROW_COLUMNS;
  const reviewed = row.personal === 'approved';
  const fixed = CURSOR_WIDTH + AGE_WIDTH + ID_WIDTH + (narrow ? 0 : FILES_WIDTH + AUTHOR_WIDTH + PILLS_WIDTH);
  const titleWidth = Math.max(16, columns - fixed - 2);

  return (
    <Box>
      <Box width={CURSOR_WIDTH} flexShrink={0}>
        <Text color={selected ? COLORS.blue : (accent ?? COLORS.blue)} bold={selected}>
          {selected ? '›' : accent ? '▏' : ' '}
        </Text>
      </Box>
      <Box width={AGE_WIDTH} flexShrink={0}>
        <Text color={ageColor(row)} dimColor={reviewed}>
          {formatAge(row.ageMs)}
        </Text>
      </Box>
      <Box width={ID_WIDTH} flexShrink={0}>
        <Text color={COLORS.blue}>{hyperlink(`!${row.id}`, row.webUrl)}</Text>
      </Box>
      <Box width={titleWidth} flexShrink={1}>
        <Text color={reviewed ? COLORS.dim : COLORS.bright} bold={selected} wrap="truncate-end">
          {row.isDraft ? <Text color={COLORS.amber}>draft </Text> : ''}
          {row.title}
          {narrow ? '' : ` `}
          {narrow ? '' : <Text color={COLORS.dim}>{row.repo}</Text>}
        </Text>
      </Box>
      {narrow ? null : (
        <>
          <Box width={FILES_WIDTH} flexShrink={0}>
            <Text color={files ? filesColor(files.files) : COLORS.dim} wrap="truncate-end">
              {files ? formatFileCount(files) : '·'}
            </Text>
          </Box>
          <Box width={AUTHOR_WIDTH} flexShrink={0}>
            <Text color={COLORS.dim} wrap="truncate-end">
              {mine ? 'you' : `@${row.author}`}
            </Text>
          </Box>
          <Box width={PILLS_WIDTH} flexShrink={0}>
            <Pills row={row} mine={mine} />
          </Box>
        </>
      )}
    </Box>
  );
}

function Pills({row, mine}: {row: Row; mine: boolean}) {
  if (mine) {
    return awaitsAuthor(row) ? (
      <Text color={COLORS.dim} italic>
        – waiting on author
      </Text>
    ) : (
      <Progress progress={row.reviewProgress} noun="reviewed" />
    );
  }

  return (
    <Box>
      <Box width={12}>
        <PersonalPill row={row} />
      </Box>
      {row.isTeamReviewer ? <Progress progress={row.teamProgress} noun="team" /> : null}
    </Box>
  );
}

function PersonalPill({row}: {row: Row}) {
  if (row.personal === 'approved') return <Text color={COLORS.green}>✓ you</Text>;
  if (row.personal === 'rejected') return <Text color={COLORS.red}>✗ you</Text>;
  if (row.personal === 'waiting')
    return (
      <Text color={COLORS.dim} italic>
        – waiting
      </Text>
    );
  return <Text color={COLORS.amber}>○ you</Text>;
}

function Progress({progress, noun}: {progress: {voted: number; total: number}; noun: string}) {
  return (
    <Text color={COLORS.dim}>
      <Text color={progress.voted > 0 ? COLORS.green : COLORS.dim} bold>
        {progress.voted}
      </Text>
      {`/${progress.total} ${noun}`}
    </Text>
  );
}

/**
 * The list is flattened to one line per item so the viewport can slice it exactly: with a
 * fixed-height frame, "scroll the list but not the chrome" is a windowing problem, and
 * windowing needs a unit. Every item below renders as exactly one terminal line.
 */
type Item =
  | {kind: 'header'; title: string; tag: string; count: number; accent?: string}
  | {kind: 'row'; row: Row; index: number; mine: boolean; accent?: string}
  | {kind: 'empty'; text: string}
  | {kind: 'spacer'};

function buildItems(config: Config, sections: Sections): Item[] {
  const items: Item[] = [];
  let index = 0;

  const specs = [
    {
      title: 'To Review',
      tag: 'TEAM',
      rows: sections.toReview,
      mine: false,
      accent: undefined,
      empty: teamConfigured(config) ? 'nothing waiting on the team' : 'no team configured — press s and fill in Team',
    },
    {
      title: 'Assigned to You',
      tag: 'PERSONAL',
      rows: sections.assignedToYou,
      mine: false,
      accent: COLORS.violet,
      empty: 'nothing assigned to you',
    },
    {title: 'Created by You', tag: 'MINE', rows: sections.createdByYou, mine: true, accent: undefined, empty: 'you have no open pull requests'},
  ];

  for (const [position, spec] of specs.entries()) {
    if (position > 0) items.push({kind: 'spacer'});
    items.push({kind: 'header', title: spec.title, tag: spec.tag, count: spec.rows.length, accent: spec.accent});
    if (spec.rows.length === 0) items.push({kind: 'empty', text: spec.empty});
    for (const row of spec.rows) {
      items.push({kind: 'row', row, index, mine: spec.mine, accent: spec.accent});
      index += 1;
    }
  }

  return items;
}

/** The footer states each filter's current position, so a toggle is visibly a toggle. */
function onOff(hidden: boolean): string {
  return hidden ? 'hidden' : 'shown';
}

/**
 * A filter that silently swallows rows is a bug report waiting to happen, so say what is
 * hidden and how much. Nothing is reported when a filter is on but caught nothing.
 */
export function filterNote(sections: Sections): string {
  const {drafts, bots, reviewed} = sections.filtered;
  const parts: string[] = [];
  if (drafts > 0) parts.push(`${drafts} draft`);
  if (bots > 0) parts.push(`${bots} bot`);
  if (reviewed > 0) parts.push(`${reviewed} reviewed`);
  return parts.length > 0 ? `${parts.join(' + ')} hidden` : '';
}

/**
 * Scroll by the minimum needed to keep the cursor in view, rather than re-centring on every
 * keypress: the list should sit still while the selection moves inside it, and only move
 * when the selection would otherwise leave the window.
 */
export function scrollOffset(previous: number, selectedItem: number, itemCount: number, listHeight: number): number {
  const max = Math.max(0, itemCount - listHeight);
  let next = Math.min(Math.max(0, previous), max);
  if (selectedItem >= 0) {
    if (selectedItem < next) next = selectedItem;
    else if (selectedItem >= next + listHeight) next = selectedItem - listHeight + 1;
  }
  return next;
}

/** Without a roster (or a group container to match), To Review can never fill up. */
function teamConfigured(config: Config): boolean {
  return config.team.mode === 'group' || config.team.members.length > 0;
}

export interface DashboardProps {
  config: Config;
  sections: Sections;
  refreshedAt: number;
  /** Index into `flattenSections(sections)`; the viewport follows it. */
  selected: number;
  /** Changed-file counts as they arrive; rows without one show a placeholder. */
  fileCounts?: FileCounts;
  now?: number;
  /** A non-fatal problem (e.g. the config file could not be written). */
  warning?: string;
  /** Overrides for tests, which have no real terminal. */
  columns?: number;
  rows?: number;
}

export default function Dashboard({
  config,
  sections,
  refreshedAt,
  selected,
  fileCounts = {},
  now = Date.now(),
  warning,
  columns,
  rows,
}: DashboardProps) {
  const size = useWindowSize();
  const width = columns ?? size.columns ?? 100;
  const height = rows ?? size.rows ?? 24;

  const items = buildItems(config, sections);
  const rowCount = flattenSections(sections).length;
  const cursor = rowCount === 0 ? -1 : Math.max(0, Math.min(selected, rowCount - 1));
  const selectedItem = items.findIndex(item => item.kind === 'row' && item.index === cursor);

  // Chrome is the top bar, the footer, and the warning line when there is one. The rest of
  // the terminal belongs to the list — that is what makes the frame fullscreen at any size.
  const chrome = warning ? 3 : 2;
  const listHeight = Math.max(1, height - chrome);

  // Derived during render, not in an effect: an effect would paint one stale frame first,
  // which is visible as a jump every time the cursor leaves the window.
  const [previousOffset, setPreviousOffset] = useState(0);
  const start = scrollOffset(previousOffset, selectedItem, items.length, listHeight);
  if (start !== previousOffset) setPreviousOffset(start);

  const visible = items.slice(start, start + listHeight);
  const more = items.length - (start + visible.length);
  const note = filterNote(sections);
  const teamLabel =
    config.team.mode === 'group' ? (config.team.groupDisplayName ?? 'group') : `manual (${config.team.members.length})`;

  return (
    <Box flexDirection="column" height={height}>
      <Box paddingX={1}>
        <Text color={COLORS.blue} bold>
          fpr
        </Text>
        <Text color={COLORS.dim}>{` · ${config.org}/${config.projects.join(',')} · team: `}</Text>
        <Text color={COLORS.text}>{teamLabel}</Text>
        <Text color={COLORS.dim}>{` · refreshed ${formatAge(Math.max(0, now - refreshedAt))} ago`}</Text>
        {note ? <Text color={COLORS.amber}>{` · ${note}`}</Text> : null}
      </Box>

      <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingX={1}>
        {visible.map((item, i) => (
          <ItemLine key={`${start + i}`} item={item} columns={width} cursor={cursor} fileCounts={fileCounts} />
        ))}
      </Box>

      {warning ? (
        <Box paddingX={1}>
          <Text color={COLORS.red} wrap="truncate-end">
            {warning}
          </Text>
        </Box>
      ) : null}

      <Box paddingX={1}>
        <Text color={COLORS.dim} wrap="truncate-end">
          {/* The scroll counter leads: the footer is truncated on narrow terminals, and
              "there is more below" is the one hint you cannot infer from the frame. */}
          {more > 0 ? <Text color={COLORS.amber}>{`↓ ${more} more · `}</Text> : ''}
          {`j/k move · tab section · enter open · h reviewed ${onOff(config.ui.hideReviewed)} · d drafts ${onOff(config.ui.hideDrafts)} · b bots ${onOff(config.ui.hideBots)} · r refresh · s settings · q quit`}
        </Text>
      </Box>
    </Box>
  );
}

function ItemLine({item, columns, cursor, fileCounts}: {item: Item; columns: number; cursor: number; fileCounts: FileCounts}) {
  if (item.kind === 'spacer') return <Text> </Text>;

  if (item.kind === 'header') {
    return (
      <Box>
        <Text color={item.accent ?? COLORS.dim}>{`[${item.tag}] `}</Text>
        <Text color={COLORS.bright} bold>
          {item.title.toUpperCase()}
        </Text>
        <Text color={COLORS.dim}>{`  ${item.count} open`}</Text>
      </Box>
    );
  }

  if (item.kind === 'empty') {
    return (
      <Text color={COLORS.dim} italic>
        {`  ${item.text}`}
      </Text>
    );
  }

  return (
    <PullRequestRow
      row={item.row}
      columns={columns}
      mine={item.mine}
      accent={item.accent}
      selected={item.index === cursor}
      files={fileCounts[item.row.id]}
    />
  );
}
