# Changelog

## 1.0.0

### Review workspace

- Fullscreen repository sidebar, searchable PR queue, and description-first inspector.
  Team queue, Assigned to me, My PRs, and All open offer distinct views.
- Saved pane visibility, widths, grouping, sorting, and filters; responsive layouts
  keep the queue usable in narrow terminals.
- Keyboard navigation and shortcut help cover every action. Mouse selection,
  scrolling, and divider resizing are optional and can be disabled in settings.
- Returning from settings preserves the active tab, repository filter, search,
  selection, pane focus, and scroll positions. Connection changes start a fresh view.
- Long searches use a single-line, cursor-following viewport, including narrow and
  short terminals. Editing respects Unicode graphemes and terminal cell widths.
- Auto-refresh retains the previous snapshot until PRs and review requirements are
  ready together. Failed refreshes leave a stale-data warning instead of clearing
  the queue. Selection follows PR identity across refreshes.

### Review requirements and defaults

- Review completion uses Azure DevOps review policies and required reviewers, not a
  team participation ratio. It does not imply passing builds or merge readiness.
- Unknown or inaccessible review requirements remain visible and never cause
  automatic hiding. The inspector explains unavailable policy information.
- New Team queues hide reviewed and review-complete PRs by default. These filters
  do not affect the other scopes.
- My PRs shows your drafts by default and has independent saved draft/bot filters.
  Other scopes continue sharing their draft/bot filters; non-TTY JSON output keeps
  its existing section/filter behavior.

### Configuration and distribution

- Existing version-1 config files remain compatible. Missing workspace preferences
  receive defaults, and an explicitly saved legacy `ui.hideReviewed` preference
  migrates to the Team queue preference without overriding a saved workspace value.
- All configuration stays in the in-app settings screen and config JSON; no app
  command-line flags are introduced. PAT and Azure CLI authentication remain supported.
- Standalone Linux x64 and Windows x64 binaries have versioned filenames and a
  `SHA256SUMS` manifest. The local `react-devtools-core` build stub remains included
  in source distributions; no real devtools package is required.

### Known limitations

- CI checks native Linux and Windows non-TTY startup with an isolated, empty
  configuration and no inherited credentials. This does not exercise a live Azure
  DevOps connection or interactive terminal behavior.
- Windows still requires a manual interactive smoke test before publishing the
  draft: first-run settings, keyboard input, resize, optional SGR mouse reporting,
  browser opening, and terminal restoration. Headless tests cannot validate raw mode.
- Release automation only creates a **draft** after an explicit matching version tag
  is pushed for a commit already merged into `master`; publishing remains manual.
