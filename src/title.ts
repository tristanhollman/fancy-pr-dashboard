import type {Sections} from './classify.ts';

const ESC = '\u001b';
const BEL = '\u0007';

/**
 * Terminal window/tab title, via OSC 2. Windows Terminal, WezTerm, iTerm2, Kitty and xterm
 * all honour it; terminals that do not simply swallow the sequence, so there is nothing to
 * feature-detect.
 *
 * The push/pop pair is XTWINOPS (`CSI 22;2t` / `CSI 23;2t`), the same title stack vim uses to
 * hand the tab back looking as it found it. Unsupported terminals ignore both halves.
 */
const SET_TITLE = `${ESC}]2;`;
const PUSH_TITLE = `${ESC}[22;2t`;
const POP_TITLE = `${ESC}[23;2t`;

/**
 * What the tab says. Assigned-to-me rows are counted with the team's: from the tab's point of
 * view both mean "someone is waiting on my vote".
 */
export function formatTitle(sections: Sections): string {
  const review = sections.toReview.length + sections.assignedToYou.length;
  return `fpr · ${review} to review · ${sections.createdByYou.length} mine`;
}

/**
 * Control characters would end the escape early and leak the remainder onto the screen, so
 * anything below 0x20, plus DEL, is dropped rather than escaped. PR titles reach this string.
 */
function sanitize(title: string): string {
  return [...title].filter(char => char >= ' ' && char !== '\u007f').join('').slice(0, 200);
}

function writable(stream: NodeJS.WriteStream): boolean {
  return Boolean(stream.isTTY) && process.env.TERM !== 'dumb';
}

export function setTitle(title: string, stream: NodeJS.WriteStream = process.stdout): void {
  if (!writable(stream)) return;
  stream.write(`${SET_TITLE}${sanitize(title)}${BEL}`);
}

/** Save whatever the terminal had before fpr took the tab over. */
export function pushTitle(stream: NodeJS.WriteStream = process.stdout): void {
  if (!writable(stream)) return;
  stream.write(PUSH_TITLE);
}

/** Put it back. Safe to call twice — a pop on an empty stack is a no-op. */
export function popTitle(stream: NodeJS.WriteStream = process.stdout): void {
  if (!writable(stream)) return;
  stream.write(POP_TITLE);
}
