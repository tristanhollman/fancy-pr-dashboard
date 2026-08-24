# FancyPRDashboard

A fullscreen terminal dashboard for open Azure DevOps pull requests. It answers one
question fast: *what needs my review right now?*

Three sections: **To Review** (PRs where your team is a reviewer), **Assigned to You**,
and **Created by You**.

> **Status: usable.** Config, the Azure DevOps client, reviewer classification, the
> settings screen, the three sections, keyboard navigation and the filters all work.
> Auto-refresh and `az` CLI auth do not yet — see [Roadmap](#roadmap).

## Install

Grab `fpr.exe` from a release and put it somewhere on your `PATH`. No runtime to
install — the Bun runtime is baked into the binary.

Building it yourself:

```sh
bun install
bun run build     # produces ./fpr.exe
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
| `j` / `k` | Move between rows (arrows work too) |
| `g` / `G` | Jump to the first / last row |
| `tab` | Jump to the next section |
| `enter` | Open the selected PR in your browser |
| click the PR id | Open that PR (terminals with OSC 8 link support) |
| `h` | Toggle hiding PRs you already voted on |
| `d` | Toggle hiding draft PRs |
| `b` | Toggle hiding PRs from bot authors |
| `r` | Refresh now |
| `s` | Open settings |
| `q` | Quit |

The three filter toggles are saved to the config file the moment you press them, so the
keys set your defaults too. The footer shows where each one currently stands, and the top
bar says how many rows a filter is hiding.

Each row shows age, PR id, title + repo, changed files, author, and vote pills. The
changed-file count (`12f`, amber at 8+, red at 20+) costs one request per PR, so it is
fetched after the list appears — rows show `·` until their count lands. Only visible rows
are counted, at most 80 per refresh.

The dashboard runs fullscreen in the terminal's alternate screen buffer, so it fills the
window whatever the content, and your scrollback is untouched when you quit. The top bar and
footer stay put; only the list scrolls, following the cursor. When the list is cut off the
footer says `↓ N more`.

Settings: `j`/`k` move between fields, `enter` edits or toggles, `tab` jumps to the next
group, `ctrl+s` validates and saves, `esc` goes back.

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
substring, so `Build Bot` also catches `Build Bot (CI)`. Both filters apply to
every section, including your own drafts.

Auth is either a Personal Access Token (needs **Code: Read** scope) or your existing
`az` CLI login. Set `FPR_PAT` in your environment to keep the token out of the config
file; when it is set, it wins and the settings screen shows the PAT field as read-only.

### Piping

When stdout is not a TTY, the dashboard skips the UI and dumps JSON instead, so
`fpr | jq ...` works.

## Development

Requires [Bun](https://bun.sh) 1.2+. Bun runs the TypeScript directly, so there is no
build step in the dev loop.

```sh
bun install
bun run dev        # run the app
bun test           # unit tests
bun run typecheck  # tsc --noEmit
```

### Layout

```
src/index.tsx      entry point: dashboard, settings, or JSON when not a TTY
src/config.ts      config load/save (atomic, 0600, FPR_PAT override)
src/api.ts         Azure DevOps REST calls over fetch
src/classify.ts    reviewer classification and section split (pure, unit-tested)
src/Settings.tsx   settings screen
src/Dashboard.tsx  the three sections, plus the colour tokens
stubs/             local stub packages (see below)
```

### Testing the UI

`ink-testing-library` renders components and lets tests write keystrokes to a fake
stdin, so keyboard behaviour is testable without a real terminal (and therefore in
CI). Anything touching raw mode or terminal resize still needs a real terminal — run
`bun run dev` for that.

### The `react-devtools-core` stub

`stubs/react-devtools-core` is a deliberate three-line fake, not a mistake. Ink lists
`react-devtools-core` as an *optional* peer dependency and imports it behind a
`process.env.DEV === 'true'` guard, but Bun's bundler resolves the specifier anyway.
Without the stub, `bun build --compile` fails with
`Could not resolve: "react-devtools-core"`; marking it `--external` only moves the
crash to binary startup. Do not remove it, and do not install the real package — it
would add weight for a feature this app never uses.

## Roadmap

1. ~~Config load/save, `api.ts` fetch wrapper with PAT auth~~
2. ~~Settings screen (the only way to configure the app)~~
3. ~~Data layer: fetch PRs, reviewer classification, identity resolution~~
4. ~~Render the three sections~~
5. ~~Keyboard navigation, filters, open-in-browser, fullscreen frame~~
6. ~~Reviewer group picker in settings~~
7. ~~Non-TTY JSON output~~
8. Auto-refresh on `ui.refreshSeconds`
9. `az` CLI auth mode
10. Packaging: publish a binary somewhere installable

## License

MIT — see [LICENSE](LICENSE).
