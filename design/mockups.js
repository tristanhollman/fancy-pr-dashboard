'use strict';

// Every name, identifier, description, and count in this study is fictional.
const mockReviewers = {
  you: {name: 'You', kind: 'person', required: true, vote: 'pending'},
  platform: {name: 'Platform crew', kind: 'group', required: true, vote: 'approved'},
  morgan: {name: 'Morgan', kind: 'person', required: false, vote: 'approved'},
};

const pullRequests = [
  {
    id: 8124, repo: 'harbor-api', project: 'Services', title: 'Make retry budgets request-scoped',
    author: 'Ari', hours: 2, files: 6, assigned: true, personal: 'pending', branch: 'fix/request-retry-budget',
    reviewers: [mockReviewers.you, mockReviewers.platform, mockReviewers.morgan],
    summary: 'Give each incoming request its own retry budget, so a slow upstream cannot exhaust the allowance for unrelated requests.',
    changes: ['Move budget ownership from the shared client to the request context.', 'Keep the existing backoff schedule and retry limit.', 'Include the remaining budget in diagnostic events.'],
    testing: 'Covered concurrent requests, exhausted budgets, and cancellation during backoff. Existing callers keep the same defaults.',
    reviewNote: 'Please look closely at cancellation propagation. The budget should never outlive its request.',
  },
  {
    id: 8121, repo: 'harbor-api', project: 'Services', title: 'Handle empty inventory responses',
    author: 'Morgan', hours: 7, files: 4, assigned: true, personal: 'approved', branch: 'fix/empty-inventory',
    reviewers: [{...mockReviewers.you, vote: 'approved'}, {name: 'Quality crew', kind: 'group', required: true, vote: 'pending'}],
    summary: 'Return an empty collection when the inventory provider has no records instead of treating an empty response as a transport failure.',
    changes: ['Normalize the empty response at the adapter boundary.', 'Preserve errors for malformed payloads.'],
    testing: 'Added empty-body and empty-array fixtures.', reviewNote: 'Your approval is recorded. The required Quality crew review is still pending.',
  },
  {
    id: 8116, repo: 'harbor-api', project: 'Services', title: 'Validate webhook signing keys',
    author: 'Casey', hours: 30, files: 12, assigned: true, personal: 'pending', branch: 'feat/webhook-key-validation',
    reviewers: [mockReviewers.you, {name: 'Security crew', kind: 'group', required: true, vote: 'changes'}],
    summary: 'Reject webhook configuration with an invalid signing-key format before saving it.',
    changes: ['Validate key format on create and update.', 'Return a field-level error without echoing key material.'],
    testing: 'Added malformed input cases and coverage for key rotation.', reviewNote: 'Security crew requested a clearer migration path for existing configurations.',
  },
  {
    id: 8110, repo: 'harbor-api', project: 'Services', title: 'Prototype cached route discovery',
    author: 'Devon', hours: 72, files: 18, assigned: false, personal: 'pending', draft: true, branch: 'spike/route-cache',
    reviewers: null, summary: 'Explore a bounded cache for route discovery. This draft is not ready for review.',
    changes: ['Add a prototype cache with a short lifetime.'], testing: 'Experiments only; no production behavior is proposed yet.',
    reviewNote: 'Required-reviewer information is unavailable in this demo payload, not zero.',
  },
  {
    id: 8109, repo: 'orbit-web', project: 'Experience', title: 'Keep filters when navigating back',
    author: 'Devon', hours: 22, files: 5, assigned: true, personal: 'pending', branch: 'fix/filter-history',
    reviewers: [mockReviewers.you, mockReviewers.morgan],
    summary: 'Restore the current filter selection when someone returns from an item detail page.',
    changes: ['Store shareable filter values in the URL.', 'Keep transient UI state out of browser history.'],
    testing: 'Covered back, forward, refresh, and direct links.', reviewNote: 'Try a saved URL as well as the back button.',
  },
  {
    id: 8106, repo: 'orbit-web', project: 'Experience', title: 'Add keyboard hints to the command menu',
    author: 'Casey', hours: 49, files: 8, assigned: false, personal: 'pending', branch: 'feat/command-hints',
    reviewers: [{...mockReviewers.morgan, required: true}, {name: 'Ari', kind: 'person', required: true, vote: 'suggestions'}],
    summary: 'Make available shortcuts visible in the command menu without adding noise to the main navigation.',
    changes: ['Show shortcut labels next to commands.', 'Hide unavailable actions from the menu.'],
    testing: 'Exercised keyboard-only navigation and screen-reader labels.', reviewNote: 'Required reviewer entries are satisfied. Branch policies have not been evaluated by this study.',
  },
  {
    id: 8102, repo: 'orbit-web', project: 'Experience', title: 'Improve empty search results',
    author: 'You', hours: 76, files: 3, assigned: false, personal: 'none', mine: true, branch: 'ux/search-empty-state',
    reviewers: [{name: 'Ari', kind: 'person', required: true, vote: 'pending'}],
    summary: 'Explain why a search has no results and make clearing active filters a single action.',
    changes: ['Differentiate a genuinely empty collection from filtered results.', 'Keep the search query visible in the empty state.'],
    testing: 'Covered empty collections, filters, and permission-limited results.', reviewNote: 'This is your PR. You are waiting for a reviewer, not being asked to approve your own change.',
  },
  {
    id: 8097, repo: 'relay-worker', project: 'Services', title: 'Checkpoint long-running exports',
    author: 'Ari', hours: 80, files: 24, assigned: true, personal: 'waiting', branch: 'feat/export-checkpoints',
    reviewers: [{...mockReviewers.you, vote: 'waiting'}, mockReviewers.morgan],
    summary: 'Resume exports from their latest checkpoint after a worker restart instead of processing the entire job again.',
    changes: ['Persist the last completed batch.', 'Make checkpoint writes idempotent.'],
    testing: 'Simulated interruption between processing and checkpoint persistence.', reviewNote: 'You are waiting for the author to clarify how partially committed batches are handled.',
  },
  {
    id: 8092, repo: 'relay-worker', project: 'Services', title: 'Bound event replay concurrency',
    author: 'Morgan', hours: 100, files: null, assigned: false, personal: 'pending', branch: 'fix/replay-concurrency',
    reviewers: null, summary: '',
    changes: [], testing: '', reviewNote: 'The description is absent and required-reviewer data is unavailable. Neither should be invented.',
  },
  {
    id: 8088, repo: 'relay-worker', project: 'Services', title: 'Refresh dependency lockfile',
    author: 'Automation', hours: 120, files: 1, assigned: false, personal: 'pending', bot: true, branch: 'maintenance/lockfile',
    reviewers: [{...mockReviewers.morgan, vote: 'pending', required: true}],
    summary: 'Refresh the dependency lockfile within the currently declared version ranges.',
    changes: ['Update resolved dependency versions.'], testing: 'The demo does not model build or policy status.',
    reviewNote: 'Bot-authored PRs are hidden by default but remain discoverable through the filter.',
  },
  {
    id: 8084, repo: 'toolbox', project: 'Tooling', title: 'Show workspace health in diagnostics',
    author: 'Casey', hours: 122, files: 9, assigned: true, personal: 'pending', branch: 'feat/workspace-health',
    reviewers: [{...mockReviewers.you, required: false}],
    summary: 'Add a short workspace health summary to the existing diagnostics output.',
    changes: ['Report missing local services.', 'Show actionable remediation without exposing environment values.'],
    testing: 'Covered healthy, partially configured, and offline workspaces.', reviewNote: 'You are an optional reviewer. No reviewer entry is marked required; branch policies may still require approvals.',
  },
  {
    id: 8079, repo: 'toolbox', project: 'Tooling', title: 'Document local service overrides',
    author: 'You', hours: 144, files: 2, assigned: false, personal: 'none', mine: true, branch: 'docs/service-overrides',
    reviewers: [{name: 'Ari', kind: 'person', required: true, vote: 'approved'}],
    summary: 'Document how local service overrides interact with the default development configuration.',
    changes: ['Add a short precedence example.', 'Explain how to reset local overrides.'],
    testing: 'Walked through the instructions in a fresh workspace.', reviewNote: 'Required reviewer entries are satisfied. Open the PR to inspect its actual merge policies.',
  },
];

const concepts = {
  hybrid: {
    label: 'Review Workspace', title: 'The team-selected combination.',
    strength: 'Workbench supplies the compact queue. Focus Inbox supplies the readable, description-first inspector. Group PRs by repository or switch to a flat list sorted globally by creation date, with the repository named on every row.',
    tradeoffTitle: 'Your space, your priority.',
    tradeoff: 'Drag either divider to resize the panes. Hiding repositories keeps the list width steady and gives the reclaimed space to details. Minimum widths protect the review count and action. Your sidebar preference and divider positions are remembered in this browser.',
    terminalTitle: 'Mouse optional. Layout remembered.',
    terminal: 'Press u to toggle grouping, h to hide your reviewed PRs from Team queue, and c to hide those whose required reviews are complete. These saved queue filters do not affect other tabs. Press t for repositories, s for settings, and [ / ] to resize. At 80 columns, p swaps queue and details.',
  },
  workbench: {
    label: 'Workbench', title: 'A home base for daily review.',
    strength: 'Closest to the Docker Sandboxes reference: a stable repository rail, a tightly aligned queue, and a live inspector. Repo headers stop names getting lost inside PR titles. Two-line rows keep the next action visible without a screen-wide scan.',
    tradeoffTitle: 'Density needs a hierarchy.',
    tradeoff: 'Three panes shine on a wide terminal, but not on a small laptop. The title and required count get priority; authors and file counts yield space first. A single selected PR drives the inspector, with no duplicated items across scope tabs.',
    terminalTitle: 'Three panes, then two, then one.',
    terminal: 'At wide widths, show all three panes. Around 120 columns, replace the rail with a repo selector. At 80 columns, keep the queue full-width and use p to open an inspector in its place. Enter still opens the PR in your browser.',
  },
  radar: {
    label: 'Repo Radar', title: 'The team, at a glance.',
    strength: 'The btop direction: bounded repository panels, compact queue rows, and a shared detail strip. Each repo meter means something concrete: the portion of its visible PRs needing your review. No decorative CPU-style charts or invented activity.',
    tradeoffTitle: 'Great overview; less linear.',
    tradeoff: 'Four active repos are easy to compare, but a large repo fleet adds panel scrolling. A shared j/k sequence follows repos in reading order. The shallow detail strip is for triage; expand it when you want the complete description.',
    terminalTitle: 'A grid that degrades gracefully.',
    terminal: 'Use a two-column grid on a wide terminal, a vertical panel stack when narrow, and a separate detail view at 80 columns. Keep borders and summary counters fixed while lists scroll. Extra repos extend the grid, not the terminal width.',
  },
  focus: {
    label: 'Focus Inbox', title: 'Read before you context-switch.',
    strength: 'A deliberate, reader-first layout. Compact PR cards are grouped by repo on the left; the larger right pane gives descriptions, review requests, and reviewer identities enough room to be useful. Best when you spend time deciding what to review.',
    tradeoffTitle: 'Calmer, but fewer PRs per screen.',
    tradeoff: 'Card spacing and readable descriptions trade raw density for context. A large queue needs more scrolling than Workbench. This is not a second code-review client: commenting, diff review, and merge actions still belong in Azure DevOps.',
    terminalTitle: 'An inbox, not a web page.',
    terminal: 'The visual ingredients are terminal-native: flat colors, box borders, text, and a strong selection edge. Use the right pane for wrapped, sanitized description text. At 80 columns, p switches between the inbox and the selected PR.',
  },
};

function initialState() {
  return {
    concept: 'hybrid', width: 'wide', scenario: 'populated', scope: 'team', repo: 'all',
    query: '', sort: 'newest', hideDrafts: true, hideBots: true, hideReviewed: true,
    selected: 8124, details: true, compactDetails: false, expanded: false, refreshed: false,
  };
}
let state = initialState();
let toastTimer;
let lastRenderedSelection;
const app = document.getElementById('app');
const terminal = document.getElementById('terminal');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const repoKey = pr => `${pr.project}/${pr.repo}`;
const approved = reviewer => reviewer.vote === 'approved' || reviewer.vote === 'suggestions';
const age = pr => pr.hours < 24 ? `${pr.hours}h` : `${Math.floor(pr.hours / 24)}d`;
const files = pr => pr.files === null ? 'Files unknown' : `${pr.files} files`;
const needsMe = pr => !pr.mine && !pr.draft && pr.personal === 'pending';
const scopeMatches = (pr, scope) => scope === 'all' || (scope === 'team' && !pr.mine) || (scope === 'assigned' && pr.assigned && !pr.mine) || (scope === 'mine' && pr.mine);
const isCompact = () => terminal.clientWidth <= 760;
const layoutKey = 'fpr-design-workspace-layout-v1';
const defaultLayout = () => ({version: 1, sidebar: true, repoWidth: 180, queueShare: 0.42, groupByRepo: true, hideQueueReviewed: true, hideQueueComplete: true});
let layout = defaultLayout();
let storageIssue = '';
let drag = null;
const layoutDialog = document.getElementById('layout-settings');
const sidebarVisible = () => layout.sidebar && terminal.clientWidth > 1100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function storageFailure(message) {
  storageIssue = message;
  document.getElementById('layout-storage-note').textContent = message;
  document.getElementById('layout-storage-note').classList.add('storage-error');
  notify(message);
}

function loadLayout() {
  let saved;
  try {
    saved = localStorage.getItem(layoutKey);
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'SecurityError') throw error;
    storageFailure('Browser storage is unavailable. Layout changes work for this visit only.');
    return;
  }
  if (!saved) return;
  let parsed;
  try {
    parsed = JSON.parse(saved);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    storageFailure('Saved layout is unreadable. Using defaults; reset layout to replace it.');
    return;
  }
  if (!parsed || parsed.version !== 1 || typeof parsed.sidebar !== 'boolean'
      || !Number.isFinite(parsed.repoWidth) || parsed.repoWidth < 145 || parsed.repoWidth > 300
      || !Number.isFinite(parsed.queueShare) || parsed.queueShare < 0.05 || parsed.queueShare > 0.95
      || ['groupByRepo', 'hideQueueReviewed', 'hideQueueComplete'].some(key => parsed[key] !== undefined && typeof parsed[key] !== 'boolean')) {
    storageFailure('Saved layout is invalid. Using defaults; reset layout to replace it.');
    return;
  }
  layout = {
    version: 1, sidebar: parsed.sidebar, repoWidth: parsed.repoWidth, queueShare: parsed.queueShare,
    groupByRepo: parsed.groupByRepo ?? true,
    hideQueueReviewed: parsed.hideQueueReviewed ?? true,
    hideQueueComplete: parsed.hideQueueComplete ?? true,
  };
}

function saveLayout() {
  try {
    localStorage.setItem(layoutKey, JSON.stringify(layout));
  } catch (error) {
    if (!(error instanceof DOMException) || !['SecurityError', 'QuotaExceededError'].includes(error.name)) throw error;
    storageFailure('Layout could not be saved in this browser. Changes work for this visit only.');
    return;
  }
  storageIssue = '';
  document.getElementById('layout-storage-note').textContent = 'Layout preferences are saved in this browser, not the app config.';
  document.getElementById('layout-storage-note').classList.remove('storage-error');
}

function workspaceMetrics() {
  const board = app.querySelector('.board.hybrid');
  if (!board?.querySelector('.queue-panel') || isCompact()) return null;
  const width = board.clientWidth;
  const repo = sidebarVisible() ? clamp(layout.repoWidth, 145, 300) : 0;
  const available = width - (repo ? repo + 12 : 0) - (state.details ? 12 : 0);
  const min = 320;
  const max = available - 320;
  return {width, repo, min, max, queue: state.details ? clamp(width * layout.queueShare, min, max) : available};
}

function splitterHtml(kind) {
  return `<div class="splitter" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize ${kind === 'repo' ? 'repository sidebar' : 'PR list and details'}" aria-controls="${kind === 'repo' ? 'workspace-repos' : 'workspace-queue'}" data-splitter="${kind}" data-focus="splitter-${kind}" title="Drag to resize; Left/Right to adjust; Home/End for limits"></div>`;
}

function applyWorkspaceLayout() {
  const board = app.querySelector('.board.hybrid');
  if (!board) return;
  if (isCompact() || !board.querySelector('.queue-panel')) {
    board.style.gridTemplateColumns = 'minmax(0, 1fr)';
    return;
  }
  const metrics = workspaceMetrics();
  const columns = metrics.repo ? [`${metrics.repo}px`, '12px'] : [];
  columns.push(state.details ? `${metrics.queue}px` : 'minmax(0, 1fr)');
  if (state.details) columns.push('12px', 'minmax(0, 1fr)');
  board.style.gridTemplateColumns = columns.join(' ');
  for (const divider of board.querySelectorAll('[data-splitter]')) {
    const repo = divider.dataset.splitter === 'repo';
    const current = Math.round(repo ? metrics.repo : metrics.queue);
    divider.setAttribute('aria-valuemin', String(repo ? 145 : metrics.min));
    divider.setAttribute('aria-valuemax', String(Math.round(repo ? 300 : metrics.max)));
    divider.setAttribute('aria-valuenow', String(current));
    divider.setAttribute('aria-valuetext', `${current} pixels ${repo ? 'repository sidebar' : 'PR list'}`);
  }
}

function resizePane(kind, value) {
  const metrics = workspaceMetrics();
  if (!metrics || (kind === 'queue' && !state.details)) return;
  if (kind === 'repo') layout.repoWidth = clamp(value, 145, 300);
  else layout.queueShare = clamp(value, metrics.min, metrics.max) / metrics.width;
  applyWorkspaceLayout();
}

function resizeWithKey(kind, key) {
  const metrics = workspaceMetrics();
  if (!metrics || (kind === 'queue' && !state.details)) {
    notify('Resize panes in a wider preview with the details pane open.');
    return;
  }
  const current = kind === 'repo' ? metrics.repo : metrics.queue;
  const min = kind === 'repo' ? 145 : metrics.min;
  const max = kind === 'repo' ? 300 : metrics.max;
  resizePane(kind, key === 'Home' ? min : key === 'End' ? max : current + (key === 'ArrowLeft' ? -24 : 24));
  saveLayout();
}

function toggleSidebar() {
  layout.sidebar = !layout.sidebar;
  saveLayout();
  render();
  if (layout.sidebar && !sidebarVisible()) notify('Sidebar enabled for wide windows. The dropdown stays available at this width.');
}

function openLayoutSettings() {
  layoutDialog.showModal();
}

function toggleQueueOption(key) {
  layout[key] = !layout[key];
  saveLayout();
  render();
  if (key !== 'groupByRepo' && state.scope !== 'team' && !storageIssue) {
    notify('Team queue preference saved. This tab is unchanged.');
  }
}

function workspaceHtml(scoped, rows, selected) {
  const rail = sidebarVisible();
  return `${rail ? railHtml(scoped) + splitterHtml('repo') : ''}${queueHtml(rows)}${state.details || isCompact() ? `${isCompact() ? '' : splitterHtml('queue')}${inspectorHtml(selected)}` : ''}`;
}

function requirement(pr) {
  if (pr.reviewers === null) return {label: 'Unknown', detail: 'Required data unavailable', style: 'unknown', total: null, done: null};
  const required = pr.reviewers.filter(reviewer => reviewer.required);
  if (!required.length) return {label: 'None', detail: 'No required entries', style: 'none', total: 0, done: 0};
  const done = required.filter(approved).length;
  const blocked = required.some(reviewer => reviewer.vote === 'changes');
  return {label: `${done}/${required.length}`, detail: 'required approved', style: blocked ? 'blocked' : done === required.length ? 'complete' : '', total: required.length, done};
}

function action(pr) {
  if (pr.draft) return {text: 'Draft', style: 'author'};
  if (pr.personal === 'approved') return {text: 'You: approved', style: 'approved'};
  if (pr.personal === 'waiting') return {text: 'Author turn', style: 'author'};
  if (pr.reviewers?.some(reviewer => reviewer.vote === 'changes')) return {text: 'Changes requested', style: 'changes'};
  if (pr.mine) return {text: requirement(pr).style === 'complete' ? 'Required met' : 'Awaiting review', style: requirement(pr).style === 'complete' ? 'approved' : 'author'};
  return {text: pr.assigned ? 'You: pending' : 'Team review', style: ''};
}

function rowsInScope(visible, scope) {
  const hidden = {reviewed: 0, complete: 0};
  const rows = visible.filter(pr => {
    if (!scopeMatches(pr, scope)) return false;
    if (state.concept !== 'hybrid' || scope !== 'team') return true;
    if (layout.hideQueueReviewed && ['approved', 'waiting', 'rejected'].includes(pr.personal)) {
      hidden.reviewed++;
      return false;
    }
    if (layout.hideQueueComplete && requirement(pr).style === 'complete') {
      hidden.complete++;
      return false;
    }
    return true;
  });
  return {rows, hidden};
}

function filteredData() {
  const hidden = {drafts: 0, bots: 0, reviewed: 0};
  const source = state.scenario === 'empty' || state.scenario === 'loading' ? [] : pullRequests;
  const visible = source.filter(pr => {
    if (state.hideDrafts && pr.draft) { hidden.drafts++; return false; }
    if (state.hideBots && pr.bot) { hidden.bots++; return false; }
    if (state.concept !== 'hybrid' && state.hideReviewed && pr.personal === 'approved') { hidden.reviewed++; return false; }
    return true;
  });
  const {rows: scoped, hidden: queueHidden} = rowsInScope(visible, state.scope);
  const query = state.query.trim().toLowerCase();
  const rows = scoped.filter(pr => (state.repo === 'all' || repoKey(pr) === state.repo)
    && `${pr.id} ${pr.title} ${pr.repo} ${pr.project} ${pr.author}`.toLowerCase().includes(query))
    .sort((a, b) => state.sort === 'newest' ? a.hours - b.hours : b.hours - a.hours);
  return {visible, scoped, rows, hidden, queueHidden};
}

function groupRows(rows) {
  const groups = new Map();
  for (const pr of rows) {
    const key = repoKey(pr);
    if (!groups.has(key)) groups.set(key, {key, repo: pr.repo, project: pr.project, rows: []});
    groups.get(key).rows.push(pr);
  }
  // Keep repository positions stable as sorting and scopes change.
  return [...groups.values()].sort((a, b) => {
    const order = ['harbor-api', 'orbit-web', 'relay-worker', 'toolbox'];
    return order.indexOf(a.repo) - order.indexOf(b.repo);
  });
}

const groupingEnabled = () => state.concept !== 'hybrid' || layout.groupByRepo;
const orderedRows = rows => groupingEnabled() ? groupRows(rows).flatMap(group => group.rows) : rows;
const navigationRows = () => orderedRows(filteredData().rows);

function requiredCell(pr, long = false) {
  const r = requirement(pr);
  return `<span class="required-cell ${r.style}" aria-label="${escapeHtml(r.label)} ${escapeHtml(r.detail)}">${r.label}${long ? `<small>${r.total ? 'required' : r.detail}</small>` : ''}</span>`;
}

function rowHtml(pr, card = false) {
  const status = action(pr);
  return `<button class="pr-row ${pr.id === state.selected ? 'selected' : ''}" data-action="select" data-id="${pr.id}" data-focus="pr-${pr.id}" aria-pressed="${pr.id === state.selected}" tabindex="${pr.id === state.selected ? '0' : '-1'}" aria-label="${escapeHtml(`${pr.repo}, !${pr.id}, ${pr.title}, ${status.text}, ${requirement(pr).label} ${requirement(pr).detail}`)}">
    <span class="pr-main"><span class="pr-title">${escapeHtml(pr.title)}</span>
      ${groupingEnabled() ? '' : `<span class="pr-repository">${escapeHtml(pr.project)} / ${escapeHtml(pr.repo)}</span>`}
      <span class="pr-meta"><span class="pr-id">!${pr.id}</span><span class="pr-author">${escapeHtml(pr.author)}</span><span class="pr-action ${status.style}">${status.text}</span><span class="pr-files">${files(pr)}</span>${card ? `<span>${age(pr)}</span>` : ''}</span>
    </span>${requiredCell(pr, card)}<span class="row-age ${pr.hours > 72 ? 'old' : ''}">${age(pr)}</span>
  </button>`;
}

function reviewerHtml(reviewer) {
  const votes = {approved: '+ Approved', suggestions: '+ Approved with suggestions', pending: '- Pending', waiting: '~ Waiting for author', changes: '! Changes requested'};
  return `<div class="reviewer"><span class="reviewer-name">${escapeHtml(reviewer.name)}<small>${reviewer.required ? 'required' : 'optional'} ${reviewer.kind === 'group' ? 'group' : 'person'}</small></span><span class="vote ${approved(reviewer) ? 'approved' : reviewer.vote}">${votes[reviewer.vote]}</span></div>`;
}

function participation(pr) {
  if (pr.reviewers === null) return 'Individual review data unavailable.';
  const people = pr.reviewers.filter(reviewer => reviewer.kind === 'person');
  return `${people.filter(approved).length}/${people.length} individual reviewers approved; groups excluded.`;
}

function descriptionHtml(pr) {
  if (!pr.summary) return '<p>No description provided.</p>';
  return `<p>${escapeHtml(pr.summary)}</p><h4>What changed</h4><ul>${pr.changes.map(change => `<li>${escapeHtml(change)}</li>`).join('')}</ul><h4>Testing notes from the author</h4><p>${escapeHtml(pr.testing)}</p><h4>Review focus</h4><p>${escapeHtml(pr.reviewNote)}</p>`;
}

function inspectorHtml(pr) {
  const description = `<h3 class="section-label">Description</h3><div class="description">${descriptionHtml(pr)}</div>`;
  const reviewers = `<h3 class="section-label">Reviewers</h3>${pr.reviewers === null ? '<div class="description">Required-reviewer information is unavailable.</div>' : pr.reviewers.map(reviewerHtml).join('')}<div class="description"><p>${participation(pr)}</p></div>`;
  return `<aside class="panel inspector" aria-label="Selected PR details">
    <h2 class="panel-heading"><span>PR inspector</span><button class="back-button" data-action="back" data-focus="back">[p] Back to queue</button><small>!${pr.id}</small></h2>
    <div class="scroll" tabindex="0" data-scroll="inspector" aria-label="Scrollable PR description and reviewers">
      <div class="inspector-location">${escapeHtml(pr.project)} / ${escapeHtml(pr.repo)} / !${pr.id}</div>
      <h2>${escapeHtml(pr.title)}</h2>
      <p class="inspector-byline">${escapeHtml(pr.author)} opened ${age(pr)} ago · ${files(pr)}${pr.draft ? ' · Draft' : ''}</p>
      <div class="branch-line"><b>${escapeHtml(pr.branch)}</b> &rarr; main</div>
      <div class="review-summary"><div>${requiredCell(pr, true)}<p>${action(pr).text}</p></div><p>Branch policies: not evaluated</p></div>
      ${description}${reviewers}
    </div>
    <div class="inspector-bottom"><button class="open-button" data-action="open" data-focus="open">[enter] Open in browser</button><span>demo action</span></div>
  </aside>`;
}

function railHtml(scoped) {
  const groups = groupRows(scoped);
  const projects = [...new Set(groups.map(group => group.project))];
  return `<aside class="panel repo-rail" id="workspace-repos" aria-label="Repository filter">
    <h2 class="panel-heading"><span>Repositories</span></h2>
    <div class="scroll" data-scroll="repos"><button class="repo-button ${state.repo === 'all' ? 'active' : ''}" data-action="repo" data-repo="all" data-focus="repo-all" aria-pressed="${state.repo === 'all'}"><span>All repositories</span><span class="repo-count">${scoped.length}</span></button>
    ${projects.map(project => `<div class="repo-heading">${escapeHtml(project)}</div>${groups.filter(group => group.project === project).map(group => `<button class="repo-button ${state.repo === group.key ? 'active' : ''}" data-action="repo" data-repo="${escapeHtml(group.key)}" data-focus="repo-${escapeHtml(group.key)}" aria-pressed="${state.repo === group.key}"><span>${escapeHtml(group.repo)}</span><span class="repo-count">${group.rows.length}</span></button>`).join('')}`).join('')}</div>
    <div class="rail-note"><strong>${scoped.filter(needsMe).length}</strong>need your review<br>across this scope</div>
  </aside>`;
}

function queueHtml(rows) {
  const card = state.concept === 'focus';
  const scopes = {team: 'Team queue', assigned: 'Assigned to me', mine: 'My pull requests', all: 'All open'};
  const ordered = orderedRows(rows);
  return `<section class="panel queue-panel ${groupingEnabled() ? '' : 'ungrouped'}" id="workspace-queue" aria-label="Pull request queue">
    <h2 class="panel-heading"><span class="queue-heading-label"><span>${card ? 'Review inbox' : scopes[state.scope]}</span>${card ? '<small>Pick a change. Get the context.</small>' : ''}</span><small>${rows.length} ${state.concept === 'hybrid' ? 'visible' : 'open'}</small></h2>
    ${card ? '' : '<div class="queue-columns"><span>PULL REQUEST / YOUR ACTION</span><span>REQUIRED</span><span>AGE</span></div>'}
    <div class="scroll" data-scroll="queue">${groupingEnabled() ? groupRows(rows).map(group => `<section aria-label="${escapeHtml(group.key)}"><h3 class="repo-group-title"><span>${escapeHtml(group.repo)} <small>${group.rows.length}</small></span><small>${escapeHtml(group.project)}</small></h3>${group.rows.map(pr => rowHtml(pr, card)).join('')}</section>`).join('') : ordered.map(pr => rowHtml(pr)).join('')}</div>
    <div class="queue-bottom"><span><strong>${ordered.findIndex(pr => pr.id === state.selected) + 1}</strong> / ${rows.length} selected</span><span>${!groupingEnabled() ? `${state.sort === 'newest' ? 'newest' : 'oldest'} first across repos` : card ? 'required = approved entries' : 'grouped by repo · scroll for more'}</span></div>
  </section>`;
}

function radarHtml(rows, selected) {
  const groups = groupRows(rows);
  return `<div class="radar-grid ${groups.length === 1 ? 'single-repo' : ''}" data-scroll="radar-grid">
    ${groups.map(group => `<section class="panel radar-panel" aria-label="${escapeHtml(group.key)}">
      <h2 class="panel-heading"><span>${escapeHtml(group.repo)}</span><small>${escapeHtml(group.project)}</small></h2>
      <div class="radar-summary"><span>${group.rows.length} open</span><b>${group.rows.filter(needsMe).length} need you</b><span>req. approved</span><span class="mini-meter" aria-hidden="true">${group.rows.map(pr => `<i class="${needsMe(pr) ? 'filled' : ''}"></i>`).join('')}</span></div>
      <div class="scroll" data-scroll="radar-${escapeHtml(group.key)}">${group.rows.map(pr => rowHtml(pr)).join('')}</div>
    </section>`).join('')}
  </div>${state.details ? `<section class="radar-detail" aria-label="Selected PR details">
    <div data-scroll="radar-meta"><button class="back-button" data-action="back">[p] Back to queue</button><div class="inspector-location">${escapeHtml(selected.repo)} / !${selected.id}</div><h2>${escapeHtml(selected.title)}</h2><p>${escapeHtml(selected.author)} · ${age(selected)} · ${files(selected)}</p><p>${action(selected).text}</p><button class="open-button" data-action="open" data-focus="open">[enter] Open in browser</button></div>
    <div tabindex="0" data-scroll="radar-description" aria-label="Scrollable PR description"><h3 class="section-label">Description</h3><div class="description">${state.expanded || isCompact() ? descriptionHtml(selected) : `<p>${escapeHtml(selected.summary || 'No description provided.')}</p>`}</div><button class="read-more" data-action="expand" data-focus="expand">${state.expanded || isCompact() ? '[-] Return to overview' : '[+] Read full description'}</button></div>
    <div tabindex="0" data-scroll="radar-reviewers" aria-label="Scrollable reviewers">${requiredCell(selected, true)}${selected.reviewers?.filter(reviewer => reviewer.required).map(reviewerHtml).join('') || `<p>${selected.reviewers === null ? 'Required-reviewer data unavailable.' : 'No required reviewer entries.'}</p>`}<p>Branch policies: not evaluated</p></div>
  </section>` : ''}`;
}

function emptyHtml(loading = false) {
  if (loading) return `<section class="empty-panel" aria-label="Loading preview"><span class="empty-symbol">[ ... ]</span><h2>Gathering your review queue</h2><p>First-load preview. Counts stay unknown until PR data is available; this is not an empty queue.</p><div class="loading-lines" aria-hidden="true"><span></span><span></span><span></span></div><button data-action="loaded" data-focus="loaded">Show loaded preview</button></section>`;
  const scoped = state.query || state.repo !== 'all';
  return `<section class="empty-panel" aria-label="Empty queue"><span class="empty-symbol">[ ${scoped ? '/' : '+'} ]</span><h2>${scoped ? 'No matching pull requests' : 'Nothing waiting here'}</h2><p>${scoped ? 'Try a different search or repository. Your other queues are still available.' : 'There are no visible open PRs in this scope. Hidden filters and other scopes may still contain work.'}</p><button data-action="${state.scenario === 'empty' ? 'loaded' : 'clear'}" data-focus="empty-action">${state.scenario === 'empty' ? 'Return to populated preview' : 'Clear search, repo, and hidden filters'}</button></section>`;
}

function overviewHtml(rows) {
  const loading = state.scenario === 'loading';
  const stats = [
    [rows.length, 'Visible open', 'in this view', ''],
    [rows.filter(needsMe).length, 'Need your review', 'personal vote pending', 'attention'],
    [rows.filter(pr => pr.personal === 'waiting').length, 'Author turn', 'you are waiting', 'author'],
    [rows.filter(pr => requirement(pr).style === 'complete').length, 'Required met', 'not merge readiness', ''],
  ];
  return `<div class="overview-strip" aria-label="Queue summary">${stats.map(([value, label, hint, style]) => `<div class="overview-stat ${style}"><strong>${loading ? '--' : value}</strong><span>${label}<small>${hint}</small></span></div>`).join('')}</div>`;
}

function footerHtml(showSidebar) {
  const navigation = '<span><kbd>j k</kbd> move</span><span><kbd>1-4</kbd> scope</span><span><kbd>/</kbd> find</span><span><kbd>enter</kbd> browser</span>';
  if (state.concept !== 'hybrid') {
    return `<footer class="terminal-footer">${navigation}<span><kbd>p</kbd> details</span><span><kbd>r</kbd> refresh</span><span class="footer-right">required = approved entries / total required</span></footer>`;
  }
  const detailsVisible = isCompact() ? state.compactDetails : state.details;
  const filter = (key, prop, label, queueOnly = false) => {
    const hidden = queueOnly ? layout[prop] : state[prop];
    return `<button data-action="${queueOnly ? 'queue-option' : 'filter'}" ${queueOnly ? 'data-option' : 'data-filter'}="${prop}" data-focus="${prop}" aria-pressed="${hidden}" title="${queueOnly ? 'Team queue only: ' : ''}toggle hiding ${label}"><kbd>${key}</kbd> ${label}:<span class="footer-state">${hidden ? 'hidden' : 'shown'}</span></button>`;
  };
  return `<footer class="terminal-footer workspace-footer" aria-label="Keyboard shortcuts and display options">
    <div class="footer-line">
      ${navigation}
      <button data-action="details" data-focus="details" aria-pressed="${detailsVisible}"><kbd>p</kbd> details:<span class="footer-state">${detailsVisible ? 'on' : 'off'}</span></button>
      <button data-action="sidebar" data-focus="sidebar" aria-pressed="${layout.sidebar}" title="Toggle the saved repository sidebar preference"><kbd>t</kbd> repos:<span class="footer-state">${layout.sidebar ? showSidebar ? 'on' : 'auto' : 'off'}</span></button>
      <button data-action="queue-option" data-option="groupByRepo" data-focus="groupByRepo" aria-pressed="${layout.groupByRepo}" title="Toggle repository grouping"><kbd>u</kbd> <span class="footer-state">${layout.groupByRepo ? 'grouped' : 'flat'}</span></button>
      <button data-action="resize-left" data-focus="resize-left" title="Shrink PR list; give space to details"><kbd>[</kbd> list-</button>
      <button data-action="resize-right" data-focus="resize-right" title="Grow PR list; give less space to details"><kbd>]</kbd> list+</button>
      <button data-action="layout-settings" data-focus="layout-settings"><kbd>s</kbd> settings</button>
      <button data-action="refresh" data-focus="refresh"><kbd>r</kbd> refresh</button>
    </div>
    <div class="footer-line">
      ${filter('d', 'hideDrafts', 'drafts')}${filter('b', 'hideBots', 'bots')}
      ${state.scope === 'team' ? `<span class="footer-queue-label">Queue only:</span>${filter('h', 'hideQueueReviewed', 'my reviewed', true)}${filter('c', 'hideQueueComplete', 'required met', true)}` : ''}
    </div>
    ${storageIssue ? `<span class="footer-storage" role="status">${escapeHtml(storageIssue)}</span>` : ''}
  </footer>`;
}

function render() {
  finishDrag();
  const focused = document.activeElement?.dataset.focus;
  const inputStart = document.activeElement?.id === 'search' ? document.activeElement.selectionStart : null;
  const inputEnd = document.activeElement?.id === 'search' ? document.activeElement.selectionEnd : null;
  const scrolls = new Map([...app.querySelectorAll('[data-scroll]')].map(el => [el.dataset.scroll, el.scrollTop]));
  const {visible, scoped, rows, hidden, queueHidden} = filteredData();
  const ordered = orderedRows(rows);
  if (!rows.some(pr => pr.id === state.selected)) state.selected = ordered[0]?.id ?? null;
  const selectionChanged = lastRenderedSelection !== state.selected;
  lastRenderedSelection = state.selected;
  const selected = rows.find(pr => pr.id === state.selected);
  const showSidebar = sidebarVisible() && Boolean(selected);
  const loading = state.scenario === 'loading';
  const scopeNames = [['team', 'Team queue'], ['assigned', 'Assigned to me'], ['mine', 'My PRs'], ['all', 'All open']];
  const groups = groupRows(visible);
  if (state.repo !== 'all' && !groups.some(group => group.key === state.repo)) {
    const pr = pullRequests.find(pr => repoKey(pr) === state.repo);
    if (pr) groups.push({key: repoKey(pr), repo: pr.repo, project: pr.project, rows: []});
  }
  const filterButton = (key, prop, label) => `<button class="filter-button" data-action="filter" data-filter="${prop}" data-focus="${prop}" aria-pressed="${state[prop]}" title="Toggle hiding ${label.toLowerCase()}"><span class="filter-key">[${key}] </span>${label} ${state[prop] ? 'hidden' : 'shown'}</button>`;
  app.innerHTML = `
    <header class="app-header"><span class="wordmark">fpr<span style="color:var(--muted)">.</span></span><div class="app-context"><strong>paperplane / 3 projects</strong><br><span>Platform crew <span style="color:var(--mint)">/</span> pull request workspace</span></div><div class="connection"><strong>${loading ? 'Connecting (preview)' : state.scenario === 'error' ? 'Cached demo data' : 'Demo snapshot'}</strong>${loading ? 'No snapshot yet' : state.refreshed ? 'just refreshed (simulated)' : state.scenario === 'error' ? 'last successful refresh: 8m ago' : 'last refreshed: 24s ago'}</div></header>
    <nav class="scope-bar" aria-label="Queue scope">${scopeNames.map(([key, label], index) => `<button class="scope ${state.scope === key ? 'active' : ''}" data-action="scope" data-scope="${key}" data-focus="scope-${key}" aria-pressed="${state.scope === key}" title="${index + 1}: ${label}">${label}<span class="count">${loading ? '--' : rowsInScope(visible, key).rows.length}</span></button>`).join('')}</nav>
    <div class="queue-tools">
      <label class="search-box"><span>/</span><input id="search" data-focus="search" type="search" placeholder="Find PR, repo, or author..." value="${escapeHtml(state.query)}" aria-label="Search pull requests" autocomplete="off" spellcheck="false"></label>
      <select class="repo-select" data-focus="repo-select" id="repo-select" aria-label="Repository filter" ${state.concept === 'hybrid' ? `style="display:${showSidebar ? 'none' : 'block'}"` : state.concept !== 'workbench' ? 'style="display:block"' : ''}><option value="all">All repositories</option>${groups.map(group => `<option value="${escapeHtml(group.key)}" ${state.repo === group.key ? 'selected' : ''}>${escapeHtml(group.project)} / ${escapeHtml(group.repo)}</option>`).join('')}</select>
      <select class="sort-select" data-focus="sort" id="sort" aria-label="Sort pull requests ${groupingEnabled() ? 'within each repository' : 'across all repositories'} by creation date"><option value="newest" ${state.sort === 'newest' ? 'selected' : ''}>Newest first</option><option value="oldest" ${state.sort === 'oldest' ? 'selected' : ''}>Oldest first</option></select>
      ${state.concept === 'hybrid' ? '' : `<div class="filter-buttons">${filterButton('d', 'hideDrafts', 'Drafts')}${filterButton('b', 'hideBots', 'Bots')}${filterButton('h', 'hideReviewed', 'Reviewed')}</div><button class="detail-toggle" data-action="details" data-focus="details" aria-pressed="${isCompact() ? state.compactDetails : state.details}">[p] Details</button>`}
    </div>
    <div class="filter-status"><span>${loading ? 'Waiting for data' : `<strong>${rows.length} visible</strong> · ${hidden.drafts} draft / ${hidden.bots} bot${state.concept === 'hybrid' ? '' : ` / ${hidden.reviewed} reviewed`} hidden across scopes${state.concept === 'hybrid' && state.scope === 'team' ? `<span class="queue-hidden-note">Queue: ${queueHidden.reviewed} reviewed by you + ${queueHidden.complete} required met hidden (no duplicates)</span>` : ''}`}</span><span class="selection-count">${selected ? `${ordered.findIndex(pr => pr.id === selected.id) + 1} / ${rows.length} selected` : ''}</span></div>
    ${state.scenario === 'error' ? '<div class="error-banner"><span>! Refresh failed. Cached PRs may be out of date; do not treat these counts as current.</span><button data-action="refresh" data-focus="retry">[r] Retry demo</button></div>' : ''}
    ${state.concept === 'radar' ? overviewHtml(rows) : ''}
    <div class="board ${state.concept} ${state.details ? '' : 'no-inspector'} ${state.compactDetails && selected ? 'inspector-open' : ''} ${state.expanded ? 'expanded' : ''}">
      ${loading || !selected ? emptyHtml(loading) : state.concept === 'hybrid' ? workspaceHtml(scoped, rows, selected) : state.concept === 'radar' ? radarHtml(rows, selected) : `${state.concept === 'workbench' ? railHtml(scoped) : ''}${queueHtml(rows)}${state.details ? inspectorHtml(selected) : ''}`}
    </div>
    ${footerHtml(showSidebar)}`;
  for (const el of app.querySelectorAll('[data-scroll]')) {
    const detailPane = ['inspector', 'radar-meta', 'radar-description', 'radar-reviewers'].includes(el.dataset.scroll);
    el.scrollTop = selectionChanged && detailPane ? 0 : scrolls.get(el.dataset.scroll) ?? 0;
  }
  if (focused) {
    const target = [...app.querySelectorAll('[data-focus]')].find(el => el.dataset.focus === focused);
    target?.focus({preventScroll: true});
    if (target?.id === 'search' && inputStart !== null) target.setSelectionRange(inputStart, inputEnd);
  }
  updateGallery();
  applyWorkspaceLayout();
  document.getElementById('sidebar-setting').checked = layout.sidebar;
  for (const key of ['groupByRepo', 'hideQueueReviewed', 'hideQueueComplete']) {
    document.querySelector(`[data-queue-setting="${key}"]`).checked = layout[key];
  }
  document.getElementById('sidebar-setting-note').textContent = layout.sidebar && !sidebarVisible()
    ? 'Enabled, but temporarily hidden at this width. Your wide-screen preference is preserved.'
    : 'When hidden, the repository dropdown uses the same active filter.';
  keepSelectionVisible();
}

function keepSelectionVisible() {
  const row = app.querySelector('.pr-row.selected');
  if (!row?.getClientRects().length) return;
  for (let parent = row.parentElement; parent && parent !== app; parent = parent.parentElement) {
    if (!parent.hasAttribute('data-scroll')) continue;
    const rowRect = row.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    if (rowRect.top < parentRect.top) parent.scrollTop -= parentRect.top - rowRect.top;
    else if (rowRect.bottom > parentRect.bottom) parent.scrollTop += rowRect.bottom - parentRect.bottom;
  }
}

function updateGallery() {
  const concept = concepts[state.concept];
  terminal.dataset.width = state.width;
  document.getElementById('window-label').textContent = concept.label;
  for (const button of document.querySelectorAll('[data-concept]')) {
    button.classList.toggle('active', button.dataset.concept === state.concept);
    button.setAttribute('aria-pressed', String(button.dataset.concept === state.concept));
  }
  for (const button of document.querySelectorAll('[data-width]')) {
    if (button.tagName === 'BUTTON') button.setAttribute('aria-pressed', String(button.dataset.width === state.width));
  }
  document.getElementById('scenario').value = state.scenario;
  for (const [id, value] of Object.entries({
    'note-title': concept.title, 'note-strength': concept.strength,
    'note-tradeoff-title': concept.tradeoffTitle, 'note-tradeoff': concept.tradeoff,
    'note-terminal-title': concept.terminalTitle, 'note-terminal': concept.terminal,
  })) document.getElementById(id).textContent = value;
}

function notify(message) {
  clearTimeout(toastTimer);
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4500);
}

function selectPr(id, focusRow = false) {
  state.selected = id;
  render();
  const row = app.querySelector(`.pr-row[data-id="${id}"]`);
  if (focusRow) row?.focus({preventScroll: true});
}

function moveSelection(delta) {
  if (isCompact() && state.compactDetails) return;
  const rows = navigationRows();
  if (!rows.length) return;
  const index = rows.findIndex(pr => pr.id === state.selected);
  const next = Math.max(0, Math.min(rows.length - 1, index + delta));
  selectPr(rows[next].id, true);
}

function toggleDetails() {
  if (!filteredData().rows.length) return;
  if (isCompact()) {
    state.compactDetails = !state.compactDetails;
    state.details = true;
  } else {
    state.details = !state.details;
    state.compactDetails = false;
  }
  state.expanded = false;
  render();
  if (isCompact()) {
    const target = state.compactDetails
      ? app.querySelector('.inspector [data-scroll], .radar-detail [tabindex="0"]')
      : app.querySelector('.pr-row.selected');
    target?.focus({preventScroll: true});
  }
}

function openDemo() {
  const pr = filteredData().rows.find(pr => pr.id === state.selected);
  if (pr) notify(`Demo only: Enter would open ${pr.project} / ${pr.repo} / !${pr.id} in Azure DevOps.`);
}

function refreshDemo() {
  state.scenario = 'populated';
  state.refreshed = true;
  render();
  notify('Demo snapshot refreshed. No request was sent to Azure DevOps.');
}

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.concept) {
    state.concept = button.dataset.concept;
    state.expanded = false;
    render();
    return;
  }
  if (button.dataset.width) {
    state.width = button.dataset.width;
    state.compactDetails = false;
    state.expanded = false;
    terminal.dataset.width = state.width;
    render();
    return;
  }
  if (button.id === 'reset') {
    state = initialState();
    layout = defaultLayout();
    saveLayout();
    terminal.dataset.width = state.width;
    render();
    if (!storageIssue) notify('Study reset to Review Workspace, with default layout and fictional data.');
    return;
  }
  switch (button.dataset.action) {
    case 'select': selectPr(Number(button.dataset.id)); break;
    case 'scope': state.scope = button.dataset.scope; state.compactDetails = false; render(); break;
    case 'repo': state.repo = button.dataset.repo; render(); break;
    case 'filter': state[button.dataset.filter] = !state[button.dataset.filter]; render(); break;
    case 'details': toggleDetails(); break;
    case 'resize-left': resizeWithKey('queue', 'ArrowLeft'); break;
    case 'resize-right': resizeWithKey('queue', 'ArrowRight'); break;
    case 'sidebar': toggleSidebar(); break;
    case 'queue-option': toggleQueueOption(button.dataset.option); break;
    case 'layout-settings': openLayoutSettings(); break;
    case 'reset-layout': {
      const {sidebar, repoWidth, queueShare} = defaultLayout();
      Object.assign(layout, {sidebar, repoWidth, queueShare});
      saveLayout();
      render();
      break;
    }
    case 'back': state.compactDetails = false; state.expanded = false; render(); break;
    case 'open': openDemo(); break;
    case 'expand':
      if (isCompact()) state.compactDetails = false;
      else state.expanded = !state.expanded;
      render();
      break;
    case 'refresh': refreshDemo(); break;
    case 'loaded': state.scenario = 'populated'; render(); break;
    case 'clear':
      state.query = ''; state.repo = 'all'; state.hideDrafts = false; state.hideBots = false; state.hideReviewed = false;
      if (state.concept === 'hybrid' && state.scope === 'team') {
        layout.hideQueueReviewed = false;
        layout.hideQueueComplete = false;
        saveLayout();
      }
      render();
      break;
  }
});

document.addEventListener('input', event => {
  if (event.target.id === 'search') {
    state.query = event.target.value;
    state.compactDetails = false;
    render();
  }
});

document.addEventListener('change', event => {
  if (event.target.dataset.queueSetting) {
    toggleQueueOption(event.target.dataset.queueSetting);
    return;
  } else if (event.target.id === 'sidebar-setting') {
    toggleSidebar();
    return;
  } else if (event.target.id === 'scenario') {
    state.scenario = event.target.value;
    state.compactDetails = false;
    state.expanded = false;
    state.refreshed = false;
  } else if (event.target.id === 'repo-select') {
    state.repo = event.target.value;
  } else if (event.target.id === 'sort') {
    state.sort = event.target.value;
  } else return;
  render();
});

document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (layoutDialog.open) return;
  const divider = event.target.closest('[data-splitter]');
  if (divider && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    resizeWithKey(divider.dataset.splitter, event.key);
    event.preventDefault();
    return;
  }
  const editable = event.target.matches('input, select, textarea');
  if (editable) {
    if (event.key === 'Escape' && event.target.id === 'search') {
      state.query = '';
      render();
      app.querySelector('.pr-row.selected')?.focus({preventScroll: true});
      event.preventDefault();
    }
    return;
  }
  if (state.concept === 'hybrid' && ['t', 's', '[', ']', 'u', 'h', 'c'].includes(event.key)) {
    if (event.key === 't') toggleSidebar();
    else if (event.key === 's') openLayoutSettings();
    else if (event.key === 'u') toggleQueueOption('groupByRepo');
    else if (event.key === 'h') toggleQueueOption('hideQueueReviewed');
    else if (event.key === 'c') toggleQueueOption('hideQueueComplete');
    else resizeWithKey('queue', event.key === '[' ? 'ArrowLeft' : 'ArrowRight');
    event.preventDefault();
    return;
  }
  const detailScroll = event.target.closest('[data-scroll="inspector"], [data-scroll="radar-description"], [data-scroll="radar-reviewers"]');
  if (detailScroll && ['j', 'k', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
    detailScroll.scrollBy({top: event.key === 'j' || event.key === 'ArrowDown' ? 40 : -40});
    event.preventDefault();
    return;
  }
  // Leave native Enter/arrow behavior intact on gallery controls and app buttons.
  const nativeButton = event.target.closest('button') && !event.target.closest('.pr-row');
  if (nativeButton && ['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const scopes = {'1': 'team', '2': 'assigned', '3': 'mine', '4': 'all'};
  const filters = {d: 'hideDrafts', b: 'hideBots', h: 'hideReviewed'};
  if (scopes[event.key]) {
    state.scope = scopes[event.key];
    state.compactDetails = false;
    render();
  } else if (filters[event.key]) {
    state[filters[event.key]] = !state[filters[event.key]];
    render();
  } else {
    switch (event.key) {
      case 'j': case 'ArrowDown': moveSelection(1); break;
      case 'k': case 'ArrowUp': moveSelection(-1); break;
      case 'g': if (navigationRows().length) selectPr(navigationRows()[0].id, true); break;
      case 'G': if (navigationRows().length) selectPr(navigationRows().at(-1).id, true); break;
      case '/': document.getElementById('search').focus(); break;
      case 'p': toggleDetails(); break;
      case 'Enter': openDemo(); break;
      case 'r': refreshDemo(); break;
      case 'Escape': state.compactDetails = false; state.expanded = false; render(); break;
      default: return;
    }
  }
  event.preventDefault();
});

function finishDrag(event) {
  if (!drag || (event && event.pointerId !== drag.pointerId)) return;
  const {element, pointerId} = drag;
  drag = null;
  element.classList.remove('dragging');
  document.body.classList.remove('resizing');
  if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  saveLayout();
}

app.addEventListener('pointerdown', event => {
  const divider = event.target.closest('[data-splitter]');
  if (!divider || event.button !== 0 || drag) return;
  const metrics = workspaceMetrics();
  if (!metrics) return;
  divider.focus({preventScroll: true});
  divider.setPointerCapture(event.pointerId);
  drag = {element: divider, pointerId: event.pointerId, kind: divider.dataset.splitter, x: event.clientX, width: divider.dataset.splitter === 'repo' ? metrics.repo : metrics.queue};
  divider.classList.add('dragging');
  document.body.classList.add('resizing');
  event.preventDefault();
});
app.addEventListener('pointermove', event => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  resizePane(drag.kind, drag.width + event.clientX - drag.x);
});
app.addEventListener('pointerup', finishDrag);
app.addEventListener('pointercancel', finishDrag);
app.addEventListener('lostpointercapture', finishDrag);
window.addEventListener('blur', () => finishDrag());

let lastCompact = isCompact();
let lastSidebar = sidebarVisible();
new ResizeObserver(() => {
  const compact = isCompact();
  const sidebar = sidebarVisible();
  if (compact !== lastCompact || sidebar !== lastSidebar) {
    lastCompact = compact;
    lastSidebar = sidebar;
    state.compactDetails = false;
    state.expanded = false;
    render();
  } else applyWorkspaceLayout();
}).observe(terminal);

loadLayout();
render();
