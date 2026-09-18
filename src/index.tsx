#!/usr/bin/env bun
import React from 'react';
import {render} from 'ink';
import App, {fetchPullRequests, message} from './App.tsx';
import {splitSections} from './classify.ts';
import {loadConfig} from './config.ts';
import {popTitle, pushTitle} from './title.ts';

const {config, valid, error} = await loadConfig();

if (process.stdout.isTTY) {
  pushTitle();
  try {
    const app = render(<App initialConfig={config} startInSettings={!valid} />, {alternateScreen: true, exitOnCtrlC: false});
    await app.waitUntilExit();
  } finally {
    popTitle();
  }
} else {
  if (!valid) {
    console.error(error ?? 'no usable config — run fpr in a terminal to set it up');
    process.exit(1);
  }
  try {
    const {me, prs} = await fetchPullRequests(config);
    const sections = splitSections(prs, config, me);
    console.log(JSON.stringify({org: config.org, projects: config.projects, refreshedAt: new Date().toISOString(), ...sections}, null, 2));
  } catch (failure) {
    console.error(message(failure));
    process.exit(1);
  }
}
