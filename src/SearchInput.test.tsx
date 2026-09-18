import React from 'react';
import {expect, test} from 'bun:test';
import {render} from 'ink-testing-library';
import SearchInput, {searchViewport} from './SearchInput.tsx';

const settle = () => Bun.sleep(30);
const textOf = (view: ReturnType<typeof searchViewport>) => view.before + view.cursor + view.after;

test('search viewport scrolls to the cursor and reserves one visible cursor cell', () => {
  expect(searchViewport('0123456789', 10, 6)).toEqual({before: '56789', cursor: ' ', after: ''});
  expect(searchViewport('0123456789', 0, 6)).toEqual({before: '', cursor: '0', after: '12345'});
  expect(searchViewport('0123456789', 4, 6)).toEqual({before: '0123', cursor: '4', after: '5'});
  expect(searchViewport('', 0, 6)).toEqual({before: '', cursor: ' ', after: ''});
});

test('viewport stays in cells and keeps Unicode graphemes intact', () => {
  const value = 'a界e\u0301👩‍💻xyz';
  for (let position = 0; position <= 7; position++) {
    for (const width of [1, 2, 4, 10]) {
      const view = searchViewport(value, position, width);
      expect(Bun.stringWidth(textOf(view))).toBeLessThanOrEqual(width);
      expect(textOf(view)).not.toContain('\ufffd');
    }
  }
  expect(searchViewport(value, 3, 6).cursor).toBe('👩‍💻');
  expect(searchViewport(value, 2, 6).cursor).toBe('e\u0301');
});

test('editor pastes long input, scrolls to edits and supports home/end/backspace/delete', async () => {
  let value = '';
  let submitted = false;
  const instance = render(<SearchInput initialValue="" width={16} onChange={next => { value = next; }} onSubmit={() => { submitted = true; }} />);
  try {
    await settle();
    instance.stdin.write('needle'.repeat(45) + 'TAIL');
    await settle();
    expect(value).toBe('needle'.repeat(45) + 'TAIL');
    expect(instance.lastFrame()).toContain('TAIL');
    expect(Bun.stringWidth(instance.lastFrame() ?? '')).toBeLessThanOrEqual(16);
    instance.stdin.write('\x1b[H');
    await settle();
    instance.stdin.write('START');
    await settle();
    expect(value.startsWith('STARTneedle')).toBe(true);
    expect(instance.lastFrame()).toContain('START');
    instance.stdin.write('\x1b[3~');
    await settle();
    expect(value.startsWith('STARTeedle')).toBe(true);
    instance.stdin.write('\x7f');
    await settle();
    expect(value.startsWith('STAReedle')).toBe(true);
    instance.stdin.write('\x1b[F');
    await settle();
    instance.stdin.write('END');
    await settle();
    expect(value.endsWith('TAILEND')).toBe(true);
    expect(instance.lastFrame()).toContain('TAILEND');
    instance.rerender(<SearchInput initialValue="" width={8} onChange={next => { value = next; }} onSubmit={() => { submitted = true; }} />);
    await settle();
    expect(instance.lastFrame()).toContain('TAILEND');
    expect(Bun.stringWidth(instance.lastFrame() ?? '')).toBeLessThanOrEqual(8);
    instance.stdin.write('\r');
    await settle();
    expect(submitted).toBe(true);
  } finally {
    instance.unmount();
    instance.cleanup();
  }
});

test('Unicode cursor movement and deletion operate on graphemes, not UTF-16 halves', async () => {
  let value = '';
  const instance = render(<SearchInput initialValue="" width={8} onChange={next => { value = next; }} onSubmit={() => {}} />);
  try {
    await settle();
    instance.stdin.write('a👩‍💻e\u0301界');
    await settle();
    instance.stdin.write('\x1b[D');
    await settle();
    instance.stdin.write('\x7f');
    await settle();
    expect(value).toBe('a👩‍💻界');
    instance.stdin.write('\x7f');
    await settle();
    expect(value).toBe('a界');
    instance.stdin.write('\x1b[3~');
    await settle();
    expect(value).toBe('a');
  } finally {
    instance.unmount();
    instance.cleanup();
  }
});
