import { type EventEmitter } from 'node:events';
import { writeSync } from 'node:fs';
import { useEffect, useEffectEvent } from 'react';
import { useStdin, useStdout } from 'ink';

export interface TerminalMouseEvent {
  x: number;
  y: number;
  /** SGR button without modifier/motion bits: 0=left, 1=middle, 2=right, 64/65=wheel. */
  button: number;
  kind: 'press' | 'move' | 'release' | 'wheel';
  direction?: 'up' | 'down';
}

export type TerminalMouseToken =
  | { type: 'mouse'; event: TerminalMouseEvent }
  | { type: 'input'; input: string };

const prefix = '\u001b[<';
const enableMouse = '\u001b[?1002h\u001b[?1006h';
const disableMouse = '\u001b[?1006l\u001b[?1002l';
const maximumReportLength = 128;
const isCsiBody = (character: string) => character >= ' ' && character <= '?';

function decodeReport(report: string): TerminalMouseEvent | undefined {
  const match = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(report);
  if (!match) return undefined;
  const code = Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  if (
    !Number.isSafeInteger(code) || code > 255 ||
    !Number.isSafeInteger(x) || x < 1 ||
    !Number.isSafeInteger(y) || y < 1
  ) return undefined;

  const button = code & ~(4 | 8 | 16 | 32);
  const kind = match[4] === 'm'
    ? 'release'
    : code & 64
      ? 'wheel'
      : code & 32
        ? 'move'
        : button === 3 ? 'release' : 'press';
  const event: TerminalMouseEvent = { x: x - 1, y: y - 1, button, kind };
  if (kind === 'wheel' && (button & 3) < 2) {
    event.direction = button & 1 ? 'down' : 'up';
  }
  return event;
}

/** Stateful only within the returned parser; never reads or writes terminal streams. */
export function createTerminalMouseParser() {
  let pending = '';
  let discarding = false;

  return {
    push(chunk: string): TerminalMouseToken[] {
      const input = pending + chunk;
      pending = '';
      const tokens: TerminalMouseToken[] = [];
      let keyboard = '';
      const flushKeyboard = () => {
        if (keyboard) tokens.push({ type: 'input', input: keyboard });
        keyboard = '';
      };
      let index = 0;
      while (index < input.length) {
        if (discarding) {
          while (index < input.length && isCsiBody(input[index]!)) index++;
          if (index === input.length) break;
          discarding = false;
          if (input[index] !== '\u001b') index++;
          continue;
        }
        if (input[index] !== '\u001b') {
          keyboard += input[index++];
          continue;
        }
        const remaining = input.slice(index);
        if (prefix.startsWith(remaining)) {
          pending = remaining;
          break;
        }
        if (!remaining.startsWith(prefix)) {
          keyboard += input[index++];
          continue;
        }
        flushKeyboard();
        let end = index + prefix.length;
        while (end < input.length && isCsiBody(input[end]!)) end++;
        if (end === input.length) {
          if (end - index > maximumReportLength) discarding = true;
          else pending = remaining;
          break;
        }
        if (end - index <= maximumReportLength) {
          const event = decodeReport(input.slice(index, end + 1));
          if (event) tokens.push({ type: 'mouse', event });
        }
        // A malformed mouse CSI is still terminal protocol, not a keyboard shortcut.
        index = input[end] === '\u001b' ? end : end + 1;
      }
      flushKeyboard();
      return tokens;
    },
    hasPendingEscape(): boolean {
      return pending === '\u001b' || pending === '\u001b[';
    },
    flush(): TerminalMouseToken[] {
      const tokens: TerminalMouseToken[] = this.hasPendingEscape()
        ? [{ type: 'input', input: pending }]
        : [];
      pending = '';
      discarding = false;
      return tokens;
    },
    reset(): void {
      pending = '';
      discarding = false;
    },
  };
}

/** Ink's useInput removes the first ESC, so accept both representations. */
export function isMouseInput(input: string): boolean {
  return /^(?:\u001b)?\[<(?:\d|;|$)/.test(input);
}

interface MouseOutput {
  write: (chunk: string) => unknown;
  fd?: number;
}

export interface TerminalMouseSessionOptions {
  input: EventEmitter;
  output: MouseOutput;
  setRawMode: (enabled: boolean) => void;
  onMouse: (event: TerminalMouseEvent) => void;
  /** Inject an emitter for tests; production uses the process exit event. */
  exitEvents?: Pick<EventEmitter, 'on' | 'removeListener'>;
}

/**
 * Ink 7.1.1 consumes stdin with read() and broadcasts parsed strings on this emitter.
 * Filtering here, rather than reading stdin or adding an input listener, keeps mouse
 * bytes (including fragments flushed by Ink's 20ms timer) out of every useInput hook.
 */
export function attachTerminalMouse({
  input,
  output,
  setRawMode,
  onMouse,
  exitEvents = process,
}: TerminalMouseSessionOptions): () => void {
  const parser = createTerminalMouseParser();
  const originalEmit = input.emit;
  const hadOwnEmit = Object.hasOwn(input, 'emit');
  let escapeTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let rawModeEnabled = false;
  let modesRequested = false;

  const dispatch = (tokens: TerminalMouseToken[]) => {
    for (const token of tokens) {
      if (stopped) break;
      if (token.type === 'mouse') onMouse(token.event);
      else originalEmit.call(input, 'input', token.input);
    }
  };
  const filteredEmit: EventEmitter['emit'] = function (this: EventEmitter, name, ...args) {
    if (name !== 'input' || typeof args[0] !== 'string') {
      return originalEmit.call(this, name, ...args);
    }
    clearTimeout(escapeTimer);
    dispatch(parser.push(args[0]));
    if (!stopped && parser.hasPendingEscape()) {
      // Only an ambiguous ESC/CSI prefix times out. Known mouse fragments must not
      // expire into ordinary text ("m", digits, etc.) on slow remote connections.
      escapeTimer = setTimeout(() => dispatch(parser.flush()), 25);
      escapeTimer.unref();
    }
    return true;
  };

  const stop = (exiting: boolean) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(escapeTimer);
    parser.reset();
    exitEvents.removeListener('exit', onExit);
    if (input.emit === filteredEmit) {
      if (hadOwnEmit) input.emit = originalEmit;
      else Reflect.deleteProperty(input, 'emit');
    }
    try {
      if (modesRequested) {
        // Asynchronous stream writes cannot be relied upon during process.exit().
        if (exiting && typeof output.fd === 'number') writeSync(output.fd, disableMouse);
        else output.write(disableMouse);
      }
    } finally {
      if (rawModeEnabled) setRawMode(false);
    }
  };
  const onExit = () => stop(true);

  let initialized = false;
  try {
    input.emit = filteredEmit;
    exitEvents.on('exit', onExit);
    setRawMode(true);
    rawModeEnabled = true;
    modesRequested = true;
    output.write(enableMouse);
    initialized = true;
  } finally {
    if (!initialized) stop(false);
  }
  return () => stop(false);
}

export function useTerminalMouse(
  onMouse: (event: TerminalMouseEvent) => void,
  enabled: boolean,
): boolean {
  const stdinContext = useStdin();
  const { stdout } = useStdout();
  // Public useStdin omits the private emitter in its type, but Ink 7.1.1 returns
  // the entire context. Fail closed if a future Ink version removes that contract.
  const input = (stdinContext as typeof stdinContext & {
    internal_eventEmitter?: EventEmitter;
  }).internal_eventEmitter;
  const active = enabled &&
    stdinContext.stdin.isTTY === true &&
    stdout.isTTY === true &&
    stdinContext.isRawModeSupported &&
    process.env.TERM !== 'dumb' &&
    typeof input?.emit === 'function';
  const handleMouse = useEffectEvent(onMouse);
  const { setRawMode } = stdinContext;

  useEffect(() => {
    if (!active || !input) return;
    return attachTerminalMouse({ input, output: stdout, setRawMode, onMouse: handleMouse });
  }, [active, input, stdout, setRawMode]);

  return active;
}
