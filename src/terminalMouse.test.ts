import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { createElement } from 'react';
import { useInput } from 'ink';
import { render } from 'ink-testing-library';
import {
  attachTerminalMouse,
  createTerminalMouseParser,
  isMouseInput,
  useTerminalMouse,
  type TerminalMouseEvent,
  type TerminalMouseToken,
} from './terminalMouse';

const report = (code = 0, x = 1, y = 1, final = 'M') => `\u001b[<${code};${x};${y}${final}`;
const mouse = (
  button: number,
  kind: TerminalMouseEvent['kind'],
  extra: Partial<TerminalMouseEvent> = {},
): TerminalMouseToken => ({
  type: 'mouse',
  event: { x: 0, y: 0, button, kind, ...extra },
});
const keyboard = (input: string): TerminalMouseToken => ({ type: 'input', input });

describe('terminal mouse parser', () => {
  test('converts terminal cells to zero-based coordinates without clipping', () => {
    expect(createTerminalMouseParser().push(report(0, 302, 105)))
      .toEqual([mouse(0, 'press', { x: 301, y: 104 })]);
  });

  test('classifies buttons, SGR release and legacy no-button release', () => {
    const parser = createTerminalMouseParser();
    expect(parser.push([0, 1, 2].map(code => report(code)).join('')))
      .toEqual([mouse(0, 'press'), mouse(1, 'press'), mouse(2, 'press')]);
    expect(parser.push([0, 1, 2].map(code => report(code, 1, 1, 'm')).join('')))
      .toEqual([mouse(0, 'release'), mouse(1, 'release'), mouse(2, 'release')]);
    expect(parser.push(report(3))).toEqual([mouse(3, 'release')]);
  });

  test('decodes motion without confusing modifiers with buttons', () => {
    const parser = createTerminalMouseParser();
    for (const modifiers of [0, 4, 8, 16, 4 | 8 | 16]) {
      expect(parser.push(report(2 | modifiers))).toEqual([mouse(2, 'press')]);
      expect(parser.push(report(1 | 32 | modifiers))).toEqual([mouse(1, 'move')]);
      expect(parser.push(report(0 | 32 | modifiers, 1, 1, 'm')))
        .toEqual([mouse(0, 'release')]);
    }
    expect(parser.push(report(35))).toEqual([mouse(3, 'move')]);
    expect(parser.push(report(128 | 4))).toEqual([mouse(128, 'press')]);
  });

  test('distinguishes wheel directions and does not treat horizontal scroll as vertical', () => {
    const parser = createTerminalMouseParser();
    expect(parser.push(report(64 | 4) + report(65 | 16) + report(66) + report(67)))
      .toEqual([
        mouse(64, 'wheel', { direction: 'up' }),
        mouse(65, 'wheel', { direction: 'down' }),
        mouse(66, 'wheel'),
        mouse(67, 'wheel'),
      ]);
  });

  test('preserves interleaved keyboard input and mouse event ordering', () => {
    const parser = createTerminalMouseParser();
    expect(parser.push('j' + report() + '\u001b[A' + report(2) + '\tq'))
      .toEqual([
        keyboard('j'), mouse(0, 'press'), keyboard('\u001b[A'),
        mouse(2, 'press'), keyboard('\tq'),
      ]);
  });

  test('assembles reports fragmented at every possible boundary', () => {
    const sequence = report(32 | 4, 97, 24);
    for (let split = 1; split < sequence.length; split++) {
      const parser = createTerminalMouseParser();
      expect(parser.push(sequence.slice(0, split))).toEqual([]);
      expect(parser.push(sequence.slice(split)))
        .toEqual([mouse(0, 'move', { x: 96, y: 23 })]);
    }
    const parser = createTerminalMouseParser();
    const tokens = [...sequence].flatMap(character => parser.push(character));
    expect(tokens).toEqual([mouse(0, 'move', { x: 96, y: 23 })]);
  });

  test('handles partial reports alongside coalesced input', () => {
    const parser = createTerminalMouseParser();
    expect(parser.push('hello' + report() + '\u001b[<65;'))
      .toEqual([keyboard('hello'), mouse(0, 'press')]);
    expect(parser.push('14;20M' + report(1) + 'world'))
      .toEqual([
        mouse(65, 'wheel', { x: 13, y: 19, direction: 'down' }),
        mouse(1, 'press'), keyboard('world'),
      ]);
  });

  test('flushes standalone Escape but never exposes confirmed mouse fragments', () => {
    const parser = createTerminalMouseParser();
    expect(parser.push('\u001b')).toEqual([]);
    expect(parser.hasPendingEscape()).toBe(true);
    expect(parser.flush()).toEqual([keyboard('\u001b')]);
    parser.push('\u001b[');
    expect(parser.flush()).toEqual([keyboard('\u001b[')]);
    parser.push('\u001b[<0;1');
    expect(parser.hasPendingEscape()).toBe(false);
    expect(parser.flush()).toEqual([]);
    expect(parser.push('q')).toEqual([keyboard('q')]);
  });

  test('preserves normal keys, ANSI keyboard sequences and Unicode', () => {
    const parser = createTerminalMouseParser();
    for (const input of ['q', 'm', '1', 'hello world', 'é🚀', '\u0003', '\u001b[A', '\u001b[1;5D', '\u001b[97;1u']) {
      expect(parser.push(input)).toEqual([keyboard(input)]);
    }
    parser.push('\u001b');
    expect(parser.push('[A')).toEqual([keyboard('\u001b[A')]);
    parser.push('\u001b[');
    expect(parser.push('1;5D')).toEqual([keyboard('\u001b[1;5D')]);
  });

  test('drops malformed and unsafe reports rather than emitting phantom clicks or shortcuts', () => {
    const parser = createTerminalMouseParser();
    for (const invalid of [
      report(0, 0, 1), report(0, 1, 0), report(256),
      '\u001b[<;1;1M', '\u001b[<0;1M', '\u001b[<0;1;1;1M',
      '\u001b[<0;9007199254740992;1M', '\u001b[<0;1;1q',
      report(-1), report(0, -1, 1), report(0, 1.5, 1),
    ]) {
      expect(parser.push(invalid)).toEqual([]);
    }
    expect(parser.push('\u001b[<0;1;' + report(2) + 'j'))
      .toEqual([mouse(2, 'press'), keyboard('j')]);
  });

  test('bounds incomplete report storage and suppresses oversized report tails', () => {
    const parser = createTerminalMouseParser();
    expect(parser.push('\u001b[<' + '9'.repeat(1000))).toEqual([]);
    expect(parser.push('9'.repeat(1000))).toEqual([]);
    expect(parser.push(';1;1M' + report() + 'q'))
      .toEqual([mouse(0, 'press'), keyboard('q')]);
    expect(parser.push('\u001b[<' + '9'.repeat(1000) + ';1;1M')).toEqual([]);
    parser.push('\u001b[<0;');
    parser.reset();
    expect(parser.push('m')).toEqual([keyboard('m')]);
  });
});

describe('mouse keyboard guard', () => {
  test('recognizes raw and Ink-normalized mouse reports', () => {
    expect(isMouseInput(report())).toBe(true);
    expect(isMouseInput(report().slice(1))).toBe(true);
    expect(isMouseInput('[<0;')).toBe(true);
    expect(isMouseInput('\u001b[<')).toBe(true);
    for (const input of ['q', 'm', '1', '[', '<', '\u001b', '\u001b[A', '[<name', 'text[<0;1;1M']) {
      expect(isMouseInput(input)).toBe(false);
    }
  });
});

function fixture() {
  const input = new EventEmitter();
  const exitEvents = new EventEmitter();
  const output: string[] = [];
  const rawModes: boolean[] = [];
  const keys: string[] = [];
  const mouseEvents: TerminalMouseEvent[] = [];
  input.on('input', value => keys.push(value));
  const stop = attachTerminalMouse({
    input,
    exitEvents,
    output: { write: text => output.push(text) },
    setRawMode: enabled => rawModes.push(enabled),
    onMouse: event => mouseEvents.push(event),
  });
  return { input, exitEvents, output, rawModes, keys, mouseEvents, stop };
}

describe('mouse session lifecycle', () => {
  test('filters reports before all keyboard listeners and leaves other events untouched', () => {
    const session = fixture();
    try {
      const lateKeys: string[] = [];
      session.input.on('input', value => lateKeys.push(value));
      const pastes: string[] = [];
      session.input.on('paste', value => pastes.push(value));
      session.input.emit('input', 'j' + report() + '\u001b[A');
      session.input.emit('paste', report() + 'pasted text');
      expect(session.keys).toEqual(['j', '\u001b[A']);
      expect(lateKeys).toEqual(session.keys);
      expect(session.mouseEvents).toEqual([{ x: 0, y: 0, button: 0, kind: 'press' }]);
      expect(pastes).toEqual([report() + 'pasted text']);
    } finally {
      session.stop();
    }
  });

  test('buffers mouse fragments even beyond Ink escape-flush timeout', async () => {
    const session = fixture();
    try {
      session.input.emit('input', '\u001b[<0;1;');
      await Bun.sleep(40);
      session.input.emit('input', '1');
      await Bun.sleep(40);
      session.input.emit('input', 'm');
      session.input.emit('input', 'q');
      expect(session.keys).toEqual(['q']);
      expect(session.mouseEvents).toEqual([{ x: 0, y: 0, button: 0, kind: 'release' }]);
    } finally {
      session.stop();
    }
  });

  test('delivers Escape without waiting for the next key', async () => {
    const session = fixture();
    try {
      session.input.emit('input', '\u001b');
      await Bun.sleep(40);
      expect(session.keys).toEqual(['\u001b']);
      session.input.emit('input', 'q');
      expect(session.keys).toEqual(['\u001b', 'q']);
    } finally {
      session.stop();
    }
  });

  test('enables only button motion and SGR, restores raw mode and emitter exactly once', () => {
    const session = fixture();
    expect(session.output).toEqual(['\u001b[?1002h\u001b[?1006h']);
    expect(session.rawModes).toEqual([true]);
    expect(session.exitEvents.listenerCount('exit')).toBe(1);
    session.stop();
    session.stop();
    expect(session.output).toEqual([
      '\u001b[?1002h\u001b[?1006h', '\u001b[?1006l\u001b[?1002l',
    ]);
    expect(session.rawModes).toEqual([true, false]);
    expect(Object.hasOwn(session.input, 'emit')).toBe(false);
    expect(session.exitEvents.listenerCount('exit')).toBe(0);
    session.input.emit('input', 'm');
    expect(session.keys).toEqual(['m']);
  });

  test('restores modes on exit and cancels pending timers', async () => {
    const session = fixture();
    session.input.emit('input', '\u001b');
    session.exitEvents.emit('exit');
    session.stop();
    await Bun.sleep(40);
    expect(session.keys).toEqual([]);
    expect(session.rawModes).toEqual([true, false]);
    expect(session.output.at(-1)).toBe('\u001b[?1006l\u001b[?1002l');
    expect(session.exitEvents.listenerCount('exit')).toBe(0);
  });

  test('rolls back failed activation without reporting success or leaking listeners', () => {
    const input = new EventEmitter();
    const exitEvents = new EventEmitter();
    const rawModes: boolean[] = [];
    const writes: string[] = [];
    expect(() => attachTerminalMouse({
      input,
      exitEvents,
      output: {
        write(text) {
          writes.push(text);
          if (writes.length === 1) throw new Error('write failed');
        },
      },
      setRawMode: enabled => rawModes.push(enabled),
      onMouse: () => {},
    })).toThrow('write failed');
    expect(rawModes).toEqual([true, false]);
    expect(writes.at(-1)).toBe('\u001b[?1006l\u001b[?1002l');
    expect(exitEvents.listenerCount('exit')).toBe(0);
    expect(Object.hasOwn(input, 'emit')).toBe(false);
  });

  test('does not release raw mode ownership it never acquired', () => {
    const input = new EventEmitter();
    const exitEvents = new EventEmitter();
    const writes: string[] = [];
    expect(() => attachTerminalMouse({
      input,
      exitEvents,
      output: { write: text => writes.push(text) },
      setRawMode: () => { throw new Error('raw mode unavailable'); },
      onMouse: () => {},
    })).toThrow('raw mode unavailable');
    expect(writes).toEqual([]);
    expect(exitEvents.listenerCount('exit')).toBe(0);
    expect(Object.hasOwn(input, 'emit')).toBe(false);
  });
});

describe('mouse hook', () => {
  test('does not enable mouse on non-TTY output and preserves keyboard handling', async () => {
    const states: boolean[] = [];
    const keys: string[] = [];
    function Example() {
      states.push(useTerminalMouse(() => { throw new Error('unexpected mouse event'); }, true));
      useInput(input => keys.push(input));
      return null;
    }
    const instance = render(createElement(Example));
    try {
      await Bun.sleep(30);
      instance.stdin.write('q');
      expect(states).not.toContain(true);
      expect(keys).toEqual(['q']);
      expect(instance.frames.join('')).not.toContain('\u001b[?1002h');
    } finally {
      instance.unmount();
      instance.cleanup();
    }
  });

  test('integrates with Ink stdin parsing, updates callbacks, and cleans up when disabled', async () => {
    const states: boolean[] = [];
    const keys: string[] = [];
    const events: TerminalMouseEvent[] = [];
    const updatedEvents: TerminalMouseEvent[] = [];
    function Example({ enabled, updated = false }: { enabled: boolean; updated?: boolean }) {
      states.push(useTerminalMouse(event => (updated ? updatedEvents : events).push(event), enabled));
      useInput(input => keys.push(input));
      return null;
    }
    const instance = render(createElement(Example, { enabled: false }));
    try {
      await Bun.sleep(30);
      Object.defineProperty(instance.stdout, 'isTTY', { value: true });
      instance.rerender(createElement(Example, { enabled: true }));
      await Bun.sleep(30);
      expect(states.at(-1)).toBe(true);
      instance.stdin.write('j' + report(0, 12, 8) + 'k');
      instance.stdin.write('\u001b[<65;');
      await Bun.sleep(40);
      instance.stdin.write('12;8M');
      expect(keys).toEqual(['j', 'k']);
      expect(events).toEqual([
        { x: 11, y: 7, button: 0, kind: 'press' },
        { x: 11, y: 7, button: 65, kind: 'wheel', direction: 'down' },
      ]);
      instance.rerender(createElement(Example, { enabled: true, updated: true }));
      await Bun.sleep(30);
      instance.stdin.write(report(1));
      expect(updatedEvents).toEqual([{ x: 0, y: 0, button: 1, kind: 'press' }]);
      instance.rerender(createElement(Example, { enabled: false }));
      await Bun.sleep(30);
      expect(states.at(-1)).toBe(false);
      expect(instance.frames.join('')).toContain('\u001b[?1006l\u001b[?1002l');
      instance.stdin.write('m');
      expect(keys).toEqual(['j', 'k', 'm']);
    } finally {
      instance.unmount();
      instance.cleanup();
    }
  });

  test('disabled settings, dumb terminals and non-TTY stdin do not request mouse modes', async () => {
    const previousTerm = process.env.TERM;
    const states: boolean[] = [];
    function Example({ enabled }: { enabled: boolean }) {
      states.push(useTerminalMouse(() => {}, enabled));
      return null;
    }
    const instance = render(createElement(Example, { enabled: false }));
    try {
      await Bun.sleep(30);
      Object.defineProperty(instance.stdout, 'isTTY', { value: true });
      instance.rerender(createElement(Example, { enabled: false }));
      await Bun.sleep(30);
      expect(states.at(-1)).toBe(false);
      process.env.TERM = 'dumb';
      instance.rerender(createElement(Example, { enabled: true }));
      await Bun.sleep(30);
      expect(states.at(-1)).toBe(false);
      process.env.TERM = 'xterm-256color';
      instance.stdin.isTTY = false;
      instance.rerender(createElement(Example, { enabled: true }));
      await Bun.sleep(30);
      expect(states.at(-1)).toBe(false);
      expect(instance.frames.join('')).not.toContain('\u001b[?1002h');
    } finally {
      if (previousTerm === undefined) delete process.env.TERM;
      else process.env.TERM = previousTerm;
      instance.unmount();
      instance.cleanup();
    }
  });
});
