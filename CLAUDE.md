# CLAUDE.md

Terminal dashboard (Ink/React on Bun) for open Azure DevOps pull requests. Currently
scaffolding — `src/index.tsx` is a placeholder.

## Commands

```sh
bun install
bun run dev        # run the app
bun test           # unit tests
bun run typecheck  # tsc --noEmit
bun run build      # compile ./fpr.exe
```

Bun, never npm/node/npx. Bun runs the TypeScript directly — do not add a build step,
`tsc` emit, `tsx`, or `ts-node` to the dev loop. Use `bun test`, not vitest or jest.

## Rules

- **No CLI flags. Ever.** The app takes no arguments. Everything is configured from
  the in-app settings screen and persisted to the config file. If something needs to
  be configurable, it goes in the settings UI and the config JSON — not `process.argv`.
- **Do not delete `stubs/react-devtools-core`.** It is a deliberate fake standing in
  for Ink's optional peer dependency, without which `bun build --compile` cannot
  produce a binary. The reasoning is in the README; do not "clean it up" and do not
  install the real package.
- **No ADO SDK.** This talks to about four REST endpoints via `fetch`. Do not add
  `azure-devops-node-api` or a generated client.
- **Secrets stay out of the repo and out of logs.** The PAT lives in the config file
  (mode `0600`) or the `FPR_PAT` environment variable. Never log it, never commit a
  real one, never put one in a test fixture.
- Prefer Bun built-ins over dependencies: `Bun.file`/`Bun.write` for the config,
  `Bun.$` for shelling out to `az`, `Bun.secrets` if the PAT ever moves to the OS
  keychain. Do not add a dependency for something a few lines cover.

## Testing

`ink-testing-library` renders components and writes keystrokes to a fake stdin, so
keyboard behaviour is testable without a terminal. Reviewer-classification logic
should be pure functions over fixture PR payloads — that is the part with real edge
cases (container vs individual reviewers, manual vs group team mode), so test it
directly rather than through the UI.

Anything touching raw mode or terminal resize cannot be covered headlessly. Verify it
by hand with `bun run dev` in a real terminal.
