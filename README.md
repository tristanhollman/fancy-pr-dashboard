# FancyPRDashboard

> [!NOTE]
> **Vibe coded.** Built with AI assistance and shaped by real-world use and feedback.

A fullscreen terminal dashboard for open Azure DevOps pull requests. It answers one
question fast: *what needs my review right now?*

Four scopes: **Team queue** (PRs where your team is a reviewer), **Assigned to me**,
**My PRs**, and **All open**. A repository sidebar, a grouped or globally sorted PR
list, and a description-first inspector share the terminal.

The terminal tab is renamed to the live counts (`fpr · 5 to review · 1 mine`) and put
back the way it was on exit.

> **Status: usable.** The workspace supports keyboard navigation, search, repository
> filters, saved layouts, review requirements, auto-refresh, and mouse resizing in
> terminals supporting SGR mouse reporting.

## Install

### With Bun

If you already have [Bun](https://bun.sh), install straight from GitHub — no registry to
configure and nothing to download from a release:

```sh
bun install -g github:tristanhollman/fancy-pr-dashboard
```

That puts `fpr` on your `PATH` and runs the TypeScript directly, so it pulls a few MB of
source and dependencies instead of the 115 MB binary. Re-run the same command to update —
add `--force` if Bun hands back its cached copy.

### Without Bun

Grab the binary for your platform from a release and put it somewhere on your `PATH`:
rename `fpr-v1.0.0-linux-x64` to `fpr` (and run `chmod +x fpr`), or rename
`fpr-v1.0.0-windows-x64.exe` to `fpr.exe`. Releases include `SHA256SUMS` for verification.
No runtime to install — the Bun runtime is baked in (which is also why it is ~115 MB).

### Building it yourself

```sh
bun install
bun run build            # ./fpr (or ./fpr.exe on Windows) for the machine you are on
bun run build:windows    # cross-compile ./fpr.exe
bun run build:linux      # cross-compile ./fpr-linux-x64
```

## Usage

```sh
fpr
```

That is the whole CLI. There are no flags — everything is configured from inside the
UI and persisted to a config file. On first run you land in the settings screen; fill
in your org, projects and auth, and press `ctrl+s`.

### Keys

Dashboard:

| Key | Action |
| --- | --- |
| `j` / `k` | Navigate the focused pane (arrows work too); scroll the inspector |
| `g` / `G` | Jump to the first / last PR, or the beginning / end of the inspector |
| `1` / `2` / `3` / `4` | Team queue / Assigned to me / My PRs / All open |
| `tab` | Focus the next visible pane |
| `enter` | Open the selected PR in your browser |
| `/` | Search PR title, id, repository, project, or author; Enter applies, Escape clears |
| `f` | Open the repository picker; Enter selects, Escape cancels |
| `o` | Toggle newest / oldest creation date |
| `u` | Toggle repository grouping; flat lists sort globally |
| `t` | Toggle the repository sidebar (repository picker remains available when hidden) |
| `p` | Toggle details; on narrow terminals switch between list and inspector |
| `[` / `]` | Shrink / grow the PR list; resize the sidebar when repositories are focused |
| `h` | Team queue only: hide PRs you already voted on |
| `c` | Team queue only: hide PRs with satisfied review requirements |
| `d` | Toggle hiding drafts (independent preference in My PRs) |
| `b` | Toggle hiding bot-authored PRs (independent preference in My PRs) |
| `r` | Refresh now |
| `s` | Open settings |
| `?` | Show all shortcuts (Escape closes) |
| `q` | Quit |

The footer exposes the shortcuts and their current state. Click a row to select it,
drag either divider to resize the panes, or use the mouse wheel to navigate. Mouse
reporting can be disabled in settings; every action has a keyboard alternative.
Very small terminals prioritize the list and shorten the footer; `?` exposes the full
controls. Panes adapt to available character cells without overwriting saved widths.

Layout, grouping, sorting, and filter shortcuts are saved to config. New configurations
hide reviewed and review-complete PRs from Team queue by default. Other scopes remain
unaffected by these two filters. An explicitly saved legacy `ui.hideReviewed` preference
is carried into the new queue preference. Team queue, Assigned, and All open share
draft/bot filters. **My PRs has separate saved filters and shows your drafts by default.**
Pressing `d` or `b` in My PRs changes only that tab; settings exposes both under *My PRs*.

The scopes are not mutually exclusive and their totals do not add up:

| Scope | Included PRs |
| --- | --- |
| Team queue | Your configured team is a reviewer, excluding PRs you authored; applies the reviewed/required-complete filters |
| Assigned to me | You are individually listed as a reviewer, excluding your own PRs |
| My PRs | Authored by you, using its own draft/bot filters |
| All open | Every open PR in your configured projects/repos, not just your team's; uses the shared draft/bot filters |

Tab badges show each scope's total before search or repository-picker narrowing. The
status line distinguishes the visible count from that scope total. My PRs may include
drafts that All open currently hides. The team deduplication setting can also exclude
assignments that match only you from Team queue.

PRs show their age, identity, author, review action, and requirement summary; ungrouped
rows retain their project/repository label. Authors are prefixed with `@` (`@you` for
your own PRs); the generic "Team review" label is omitted because the scope already
provides that context. The inspector shows descriptions, branches,
reviewers, and review requirements. The selected PR's full description loads separately
because Azure DevOps truncates descriptions in list responses. Text is sanitized so PR
content cannot issue terminal control sequences.

Review completion uses Azure DevOps review-policy evaluations and required reviewers,
not the old team-participation ratio. Build checks and merge readiness are separate.
**Unknown requirements never cause automatic hiding.** Missing policy access or failed
requests are visible in the inspector, and hidden counts do not double-count a PR
you have reviewed whose requirements are also satisfied.

Refresh publishes the PR list and its review requirements together, so filtered PRs
do not briefly reappear while policies are loading. The previous snapshot stays visible
with a refreshing indicator until that update is ready. Requests use bounded concurrency;
unavailable requirements are reported as Unknown, not treated as complete.
File counts and full descriptions load afterward. File counts are limited to 80 PRs per
refresh. Auto-refresh uses `ui.refreshSeconds`; failed list refreshes retain the last
snapshot with a stale-data warning. Selection is tracked by PR identity, not list position.

The dashboard runs fullscreen in the terminal's alternate screen buffer; scrollback is
untouched on exit. The header and footer stay fixed, while panes scroll independently.

Settings: `j`/`k` move between fields, `enter` edits or toggles, `tab` jumps to the next
group, `ctrl+s` validates and saves, `esc` goes back.
Saving or cancelling settings restores the current tab, search, repository filter,
selected PR, pane focus, and scroll position. Changing the connection resets that
navigation context. Long searches scroll horizontally with the cursor instead of
wrapping into the PR panels; Home/End and Ctrl+A/Ctrl+E move within the search.

**To Review stays empty until the team is set up.** In settings, either switch Team mode to
`group` and press `enter` on *reviewer group* to pick from the groups already reviewing your
PRs, or stay in `manual` mode and list your teammates' emails. Manual mode matches those
strings against the reviewers' `uniqueName`, so they have to be exact — `fpr > prs.json`
dumps each PR's reviewer entries if you need to see what Azure DevOps returns.

### Configuration

Stored at `%APPDATA%\fancy-pr-dashboard\config.json` (`~/.config/fancy-pr-dashboard/config.json`
on macOS and Linux). Written by the settings screen — you should not need to edit it
by hand.

`projects` is a list, so one dashboard can span several Azure DevOps projects. `repos`
is `["all"]` or a list of repository names, matched across every configured project.

Draft PRs and PRs from bot authors are hidden by default (`ui.hideDrafts`, `ui.hideBots`).
`ui.botAuthors` lists the author names that count as bots — matched as a case-insensitive
substring, so `Build Bot` also catches `Build Bot (CI)`. My PRs instead uses
`ui.workspace.hideMyDrafts` (default false) and `ui.workspace.hideMyBots` (default true).
Legacy non-TTY JSON sections continue using the shared `ui.hideDrafts`/`ui.hideBots` filters.

### Auth

Two modes, chosen by `auth.mode` on the settings screen.

**`pat`** — a Personal Access Token with the **Code: Read** scope. Set `FPR_PAT` in
your environment to keep the token out of the config file; when it is set, it wins over
the stored one and the settings screen shows the PAT field as read-only. Otherwise the
token lives in the config file, which is written `0600`.

**`az-cli`** — your existing `az login`. No token to paste and nothing secret on disk:
`fpr` asks the az CLI for a short-lived Azure DevOps access token (`az account
get-access-token`) and refreshes it a few minutes before it expires. Needs the az CLI on
your `PATH` and a login that can read code in the organization; if the login has expired,
`fpr` says so and `az login` fixes it. In this mode the PAT field disappears and `FPR_PAT`
is ignored — a stored PAT is kept, untouched, in case you switch back.

`auth.tenant` is optional and almost always stays empty: az issues the token for whichever
Entra tenant your active subscription belongs to, which is the right one. Set it when the
organization is backed by a *different* tenant than that default — a guest or consultant
account — where az otherwise returns a perfectly valid token that Azure DevOps answers
with a 401. `az account list --query "[].{name:name, tenant:tenantId}" -o table` lists the
ones you are signed in to.

The resource id `fpr` asks for a token against is Azure DevOps' first-party application in
Entra ID. It is a fixed, Microsoft-owned GUID, identical in every tenant — the az CLI's own
`azure-devops` extension hardcodes the same one — so it is a constant, not a setting.

### Piping

When stdout is not a TTY, the dashboard skips the UI and dumps JSON instead, so
`fpr | jq ...` works.

## Development

Requires [Bun](https://bun.sh) 1.3.11+. Bun runs the TypeScript directly, so there is no
build step in the dev loop.

```sh
bun install
bun run dev        # run the app
bun test           # unit tests
bun run typecheck  # tsc --noEmit
```

### Layout

```
src/index.tsx      entry point: workspace, settings, or JSON when not a TTY
src/App.tsx        refresh, data enrichment, saved preferences, screen routing
src/Workspace.tsx  terminal workspace, pane focus, keyboard and mouse interaction
src/workspace.ts   filtering, ordering, layout geometry, safe terminal text
src/terminalMouse.ts mouse decoding and terminal mode lifecycle
src/reviews.ts     conservative review-policy completion
src/config.ts      config load/save (atomic, 0600, FPR_PAT override)
src/api.ts         Azure DevOps REST calls over fetch
src/azcli.ts       az CLI access tokens for `auth.mode: az-cli` (cached until expiry)
src/errors.ts      ApiError, shared by the client and the auth backends
src/classify.ts    reviewer classification and section split (pure, unit-tested)
src/Settings.tsx   settings screen
src/Dashboard.tsx  legacy section renderer and shared formatting/colour tokens
stubs/             local stub packages (see below)
```

### Testing the UI

`ink-testing-library` renders components and lets tests write keystrokes to a fake
stdin, so keyboard behaviour is testable without a real terminal (and therefore in
CI). Anything touching raw mode or terminal resize still needs a real terminal — run
`bun run dev` for that.

### V1 UI design studies

Open [`design/index.html`](design/index.html) directly in a browser. The default
**Review Workspace** combines Workbench's repository rail and compact queue with
Focus Inbox's description-first inspector, following team feedback. The original
**Workbench**, **Repo Radar**, and **Focus Inbox** studies remain for comparison.
No server, install, or network access is needed; all study data is fictional.
The gallery remains a standalone browser reference for the implemented terminal workspace.

Display toggles and filters live in the compact, clickable footer alongside the
keyboard hints. Their labels show the current state; only search, repository selection,
sorting, and the hidden-count summary remain above the panes.

In Review Workspace, press `t` or use **Settings** (`s`) to toggle repositories.
When the sidebar is hidden, a dropdown preserves the same repository filter and its
space goes to details. Drag either divider, use `[` / `]` to resize the PR list, or
focus a divider and use Left/Right (Home/End select its limits). Sidebar visibility
and preferred pane sizes persist in browser storage; settings includes a layout reset.
Narrow previews temporarily hide the sidebar without changing that preference; at
80 columns, `p` switches between queue and details. These browser interactions
prototype the intended terminal UX, not production mouse handling or config changes.

Press `u` (or use settings) to disable repository grouping in the PR list. Newest/oldest
then sorts by creation date across repositories; every row keeps its project/repo label.
The grouping preference applies to every tab in Review Workspace and is saved.

**Team queue** has two independent, saved filters, enabled by default: `h` hides PRs
you have reviewed (approval, changes requested, or waiting for the author), and `c`
hides PRs whose known, nonzero required reviewer entries are all approved. Missing
requirements and no required entries are not treated as completed. These filters do
not affect Assigned to me, My PRs, or All open. Hidden counts are shown without double
counting overlapping reasons. These controls are also in settings; Reset layout only
resets pane geometry, while Reset study restores all defaults.

The gallery includes repository and scope filters, keyboard selection, required-reviewer
counts, PR descriptions, width presets, and empty/loading/stale-data scenarios.
Each direction explains its UX tradeoffs and how it would adapt to a real terminal.
Required-reviewer completion is a proposed data surface, not a relabeling of the current
team-review progress; the gallery documents that distinction and the implementation gaps.

### The `react-devtools-core` stub

`stubs/react-devtools-core` is a deliberate three-line fake, not a mistake. Ink lists
`react-devtools-core` as an *optional* peer dependency and imports it behind a
`process.env.DEV === 'true'` guard, but Bun's bundler resolves the specifier anyway.
Without the stub, `bun build --compile` fails with
`Could not resolve: "react-devtools-core"`; marking it `--external` only moves the
crash to binary startup. Do not remove it, and do not install the real package — it
would add weight for a feature this app never uses.

### Preparing a release

Use Bun **1.3.11**, matching CI. The checks deliberately target source and release
scripts rather than generated output such as `brag-output/`.

```sh
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run release:build
bun run scripts/smoke-release.ts
```

`release:build` writes `dist/fpr-v1.0.0-linux-x64`,
`dist/fpr-v1.0.0-windows-x64.exe`, and `dist/SHA256SUMS`. The smoke test runs only the
host platform's binary with an isolated empty config and no inherited credentials.
CI builds and runs this startup check natively on Linux and Windows.

After the release PR has passed CI and been merged into `master`, perform an interactive
Windows Terminal smoke test: settings, tab/search restoration, resizing, optional mouse
dragging, opening a PR, and clean terminal restoration on exit. Review the notes in
[`CHANGELOG.md`](CHANGELOG.md). Then create and push `v1.0.0` on the merged commit.
The release workflow requires the tag to match `package.json` and its commit to be on
`master`; it builds both binaries, attaches checksums, and creates a **draft release**.
Review the draft and publish it manually. Preparing this branch does not tag or publish.

## Roadmap

1. ~~Config load/save, `api.ts` fetch wrapper with PAT auth~~
2. ~~Settings screen (the only way to configure the app)~~
3. ~~Data layer: fetch PRs, reviewer classification, identity resolution~~
4. ~~Render the three sections~~
5. ~~Keyboard navigation, filters, open-in-browser, fullscreen frame~~
6. ~~Reviewer group picker in settings~~
7. ~~Non-TTY JSON output~~
8. ~~`az` CLI auth mode~~
9. ~~Auto-refresh on `ui.refreshSeconds`~~
10. ~~Versioned Linux/Windows artifacts and draft-release automation~~
11. Publish the reviewed `1.0.0` draft after merging and completing platform smoke checks

## License

MIT — see [LICENSE](LICENSE).
