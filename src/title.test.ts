import {expect, test} from 'bun:test';
import {formatTitle, popTitle, pushTitle, setTitle} from './title.ts';
import type {Row, Sections} from './classify.ts';

const row = (id: number) => ({id}) as Row;

function sections(toReview: number, assigned: number, mine: number): Sections {
  const rows = (n: number) => Array.from({length: n}, (_, i) => row(i));
  return {
    toReview: rows(toReview),
    assignedToYou: rows(assigned),
    createdByYou: rows(mine),
    filtered: {drafts: 0, bots: 0, reviewed: 0},
  };
}

/** Collects what would go to the terminal, pretending to be a TTY. */
function fakeTty(isTTY = true) {
  const written: string[] = [];
  return {
    written,
    stream: {isTTY, write: (chunk: string) => written.push(chunk)} as unknown as NodeJS.WriteStream,
  };
}

test('the title counts assigned rows with the team ones', () => {
  expect(formatTitle(sections(3, 2, 1))).toBe('fpr · 5 to review · 1 mine');
  expect(formatTitle(sections(0, 0, 0))).toBe('fpr · 0 to review · 0 mine');
});

test('setTitle emits OSC 2 terminated by BEL', () => {
  const {written, stream} = fakeTty();
  setTitle('fpr · 1 to review · 0 mine', stream);
  expect(written).toEqual(['\u001b]2;fpr · 1 to review · 0 mine\u0007']);
});

test('control characters are stripped so a title cannot break out of the escape', () => {
  const {written, stream} = fakeTty();
  setTitle('evil\u0007\u001b]0;pwned\u0007\ntitle', stream);
  expect(written[0]).toBe('\u001b]2;evil]0;pwnedtitle\u0007');
});

test('push and pop use the XTWINOPS title stack', () => {
  const {written, stream} = fakeTty();
  pushTitle(stream);
  popTitle(stream);
  expect(written).toEqual(['\u001b[22;2t', '\u001b[23;2t']);
});

test('nothing is written when stdout is not a terminal', () => {
  const {written, stream} = fakeTty(false);
  pushTitle(stream);
  setTitle('fpr', stream);
  popTitle(stream);
  expect(written).toEqual([]);
});
