import React from 'react';
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {render} from 'ink-testing-library';
import Settings, {type ValidationFailure} from './Settings.tsx';
import {defaultConfig, type Config} from './config.ts';

const ENTER = '\r';
const TAB = '\t';
const CTRL_S = '\u0013';
const ESC = '\u001b';

const savedEnvPat = process.env.FPR_PAT;

beforeEach(() => {
  delete process.env.FPR_PAT;
});

afterEach(() => {
  if (savedEnvPat === undefined) delete process.env.FPR_PAT;
  else process.env.FPR_PAT = savedEnvPat;
});

function usableConfig(): Config {
  const config = defaultConfig();
  config.org = 'myorg';
  config.projects = ['platform'];
  config.auth.pat = 'stored-token';
  config.team.members = ['me@co.com'];
  return config;
}

/** Lets the pending validate/save promises settle before asserting. */
const settle = () => Bun.sleep(20);

test('j/k move the cursor and enter flips a toggle', async () => {
  const {lastFrame, stdin, unmount} = render(
    <Settings config={usableConfig()} onSave={() => {}} validate={async () => null} save={async () => {}} />,
  );

  expect(lastFrame()).toContain('› organization');

  stdin.write('j');
  stdin.write('j');
  stdin.write('j'); // Connection ×3 → Auth mode
  await settle();
  expect(lastFrame()).toContain('› mode');
  expect(lastFrame()).toContain('pat | az-cli');

  stdin.write(ENTER);
  await settle();
  expect(lastFrame()).toContain('az-cli');

  stdin.write('k');
  await settle();
  expect(lastFrame()).toContain('› repos');

  unmount();
});

test('tab jumps to the next group', async () => {
  const {lastFrame, stdin, unmount} = render(
    <Settings config={usableConfig()} onSave={() => {}} validate={async () => null} save={async () => {}} />,
  );

  stdin.write(TAB);
  await settle();
  const frame = lastFrame() ?? '';
  // First field of the Auth group is selected, the Connection fields are not.
  expect(frame).toContain('› mode');
  expect(frame).not.toContain('› organization');

  unmount();
});

test('typing into a text field does not move the cursor', async () => {
  let saved: Config | undefined;
  const {lastFrame, stdin, unmount} = render(
    <Settings
      config={usableConfig()}
      onSave={config => {
        saved = config;
      }}
      validate={async () => null}
      save={async () => {}}
    />,
  );

  stdin.write(ENTER); // edit organization
  await settle();
  stdin.write('jkl'); // j/k must be typed, not treated as navigation
  await settle();
  expect(lastFrame()).toContain('myorgjkl'); // editing starts from the current value

  stdin.write(ENTER); // commit
  await settle();
  expect(lastFrame()).toContain('› organization');

  stdin.write(CTRL_S);
  await settle();
  expect(saved?.org).toBe('myorgjkl');

  unmount();
});

test('s saves too — some terminals (classic Windows consoles) eat ctrl+s as a pause signal', async () => {
  let saved: Config | undefined;
  const {stdin, unmount} = render(
    <Settings
      config={usableConfig()}
      onSave={next => {
        saved = next;
      }}
      validate={async () => null}
      save={async next => {
        saved = next;
      }}
    />,
  );

  stdin.write('s');
  await settle();
  expect(saved?.org).toBe('myorg');

  unmount();
});

test('a validation failure blocks the save and renders next to the field', async () => {
  const failure: ValidationFailure = {field: 'auth.pat', message: 'authentication rejected — check the PAT'};
  let saveCalls = 0;
  let savedCalls = 0;

  const {lastFrame, stdin, unmount} = render(
    <Settings
      config={usableConfig()}
      onSave={() => {
        savedCalls += 1;
      }}
      validate={async () => failure}
      save={async () => {
        saveCalls += 1;
      }}
    />,
  );

  stdin.write(CTRL_S);
  await settle();

  expect(lastFrame()).toContain('authentication rejected');
  expect(saveCalls).toBe(0);
  expect(savedCalls).toBe(0);

  unmount();
});

test('an incomplete config never reaches validation', async () => {
  let validateCalls = 0;
  const {lastFrame, stdin, unmount} = render(
    <Settings
      config={defaultConfig()}
      onSave={() => {}}
      validate={async () => {
        validateCalls += 1;
        return null;
      }}
      save={async () => {}}
    />,
  );

  stdin.write(CTRL_S);
  await settle();

  expect(validateCalls).toBe(0);
  expect(lastFrame()).toContain('at least one project');

  unmount();
});

test('a successful save persists a clamped refresh interval', async () => {
  const config = usableConfig();
  config.ui.refreshSeconds = 3;
  let written: Config | undefined;
  let handed: Config | undefined;

  const {stdin, unmount} = render(
    <Settings
      config={config}
      onSave={next => {
        handed = next;
      }}
      validate={async () => null}
      save={async next => {
        written = next;
      }}
    />,
  );

  stdin.write(CTRL_S);
  await settle();

  expect(written?.ui.refreshSeconds).toBe(15);
  expect(handed?.ui.refreshSeconds).toBe(15);

  unmount();
});

test('FPR_PAT makes the token field read-only', async () => {
  process.env.FPR_PAT = 'env-token';
  const {lastFrame, stdin, unmount} = render(
    <Settings config={usableConfig()} onSave={() => {}} validate={async () => null} save={async () => {}} />,
  );

  stdin.write('j');
  stdin.write('j');
  stdin.write('j');
  stdin.write('j'); // → personal access token
  await settle();

  const frame = lastFrame() ?? '';
  expect(frame).toContain('› personal access token');
  expect(frame).toContain('set from environment');
  expect(frame).not.toContain('env-token');

  stdin.write(ENTER); // read-only: must not enter edit mode
  await settle();
  expect(lastFrame()).toContain('set from environment');

  unmount();
});

test('esc cancels when there is somewhere to go back to', async () => {
  let cancels = 0;
  const {stdin, unmount} = render(
    <Settings config={usableConfig()} onSave={() => {}} onCancel={() => (cancels += 1)} validate={async () => null} save={async () => {}} />,
  );

  stdin.write(ESC);
  await settle();
  expect(cancels).toBe(1);

  unmount();
});

test('switching team mode swaps the members field for the reviewer group picker', async () => {
  const {lastFrame, stdin, unmount} = render(
    <Settings config={usableConfig()} onSave={() => {}} validate={async () => null} save={async () => {}} />,
  );

  expect(lastFrame()).toContain('members');

  stdin.write(TAB); // Auth
  stdin.write(TAB); // Team
  await settle();
  stdin.write(ENTER); // manual → group
  await settle();

  const frame = lastFrame() ?? '';
  expect(frame).toContain('reviewer group');
  expect(frame).not.toContain('members');

  unmount();
});

test('the reviewer group picker lists discovered groups and stores the chosen one', async () => {
  const config = usableConfig();
  config.team = {mode: 'group', groupDescriptor: null, groupDisplayName: null, members: []};
  let saved: Config | undefined;

  const {lastFrame, stdin, unmount} = render(
    <Settings
      config={config}
      onSave={next => {
        saved = next;
      }}
      validate={async () => null}
      save={async () => {}}
      findGroups={async () => [
        {descriptor: 'vssgp.alpha', displayName: 'Platform Infra', prCount: 4},
        {descriptor: 'vssgp.other', displayName: 'Other Team', prCount: 1},
      ]}
    />,
  );

  stdin.write(TAB); // Auth
  stdin.write(TAB); // Team
  await settle();
  stdin.write('j'); // team mode → reviewer group
  await settle();
  stdin.write(ENTER); // open the picker
  await settle();

  expect(lastFrame()).toContain('Platform Infra');
  expect(lastFrame()).toContain('reviewer on 4 open PRs');
  expect(lastFrame()).toContain('reviewer on 1 open PR');

  stdin.write('j'); // → Other Team
  await settle();
  stdin.write(ENTER); // pick it
  await settle();

  expect(lastFrame()).toContain('Other Team'); // shown as the field value now

  stdin.write(CTRL_S);
  await settle();
  expect(saved?.team.groupDescriptor).toBe('vssgp.other');
  expect(saved?.team.groupDisplayName).toBe('Other Team');

  unmount();
});

test('the picker says so when no group reviews anything', async () => {
  const config = usableConfig();
  config.team = {mode: 'group', groupDescriptor: null, groupDisplayName: null, members: []};

  const {lastFrame, stdin, unmount} = render(
    <Settings config={config} onSave={() => {}} validate={async () => null} save={async () => {}} findGroups={async () => []} />,
  );

  stdin.write(TAB);
  stdin.write(TAB);
  await settle();
  stdin.write('j');
  await settle();
  stdin.write(ENTER);
  await settle();

  expect(lastFrame()).toContain('no group is a reviewer');

  stdin.write(ESC); // back to the field list, not out of settings
  await settle();
  expect(lastFrame()).toContain('CONNECTION');

  unmount();
});

test('switching to az-cli swaps the token field for the tenant field', async () => {
  const {lastFrame, stdin, unmount} = render(
    <Settings config={usableConfig()} onSave={() => {}} validate={async () => null} save={async () => {}} />,
  );

  expect(lastFrame()).toContain('personal access token');
  expect(lastFrame()).not.toContain('tenant');

  stdin.write(TAB); // Auth group → mode
  stdin.write(ENTER); // pat → az-cli
  await settle();

  const frame = lastFrame() ?? '';
  expect(frame).toContain('az-cli');
  expect(frame).toContain('tenant');
  expect(frame).not.toContain('personal access token');

  stdin.write(ENTER); // back to pat
  await settle();
  expect(lastFrame()).toContain('personal access token');
  expect(lastFrame()).not.toContain('tenant');

  unmount();
});

test('a tenant typed into settings is trimmed', async () => {
  let saved: Config | undefined;
  const config = usableConfig();
  config.auth.mode = 'az-cli';
  config.auth.pat = null;

  const {stdin, unmount} = render(
    <Settings
      config={config}
      onSave={next => {
        saved = next;
      }}
      validate={async () => null}
      save={async () => {}}
    />,
  );

  stdin.write(TAB); // Auth group → mode
  await settle();
  stdin.write('j'); // → tenant
  await settle();
  stdin.write(ENTER); // edit
  await settle();
  stdin.write('  contoso-tenant-id  ');
  await settle();
  stdin.write(ENTER); // commit
  await settle();
  stdin.write(CTRL_S);
  await settle();

  expect(saved?.auth.tenant).toBe('contoso-tenant-id');

  unmount();
});

test('an az-cli config saves without a PAT', async () => {
  let saved: Config | undefined;
  const config = usableConfig();
  config.auth.mode = 'az-cli';
  config.auth.pat = null;

  const {stdin, unmount} = render(
    <Settings
      config={config}
      onSave={next => {
        saved = next;
      }}
      validate={async () => null}
      save={async () => {}}
    />,
  );

  stdin.write(CTRL_S);
  await settle();

  expect(saved?.auth.mode).toBe('az-cli');
  expect(saved?.auth.pat).toBeNull();

  unmount();
});

test('an az failure is pinned to the auth mode field, not to the PAT', async () => {
  const failure: ValidationFailure = {field: 'auth.mode', message: 'not signed in to the az CLI — run `az login`, then try again'};
  const config = usableConfig();
  config.auth.mode = 'az-cli';

  const {lastFrame, stdin, unmount} = render(
    <Settings config={config} onSave={() => {}} validate={async () => failure} save={async () => {}} />,
  );

  stdin.write(CTRL_S);
  await settle();

  expect(lastFrame()).toContain('az login');

  unmount();
});
