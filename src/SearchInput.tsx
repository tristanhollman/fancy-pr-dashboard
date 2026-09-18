import React, {useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {isMouseInput} from './terminalMouse.ts';
import {terminalText} from './workspace.ts';

const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
const graphemes = (value: string) => Array.from(segmenter.segment(value), item => item.segment);

export function searchViewport(value: string, cursor: number, width: number) {
  const characters = graphemes(terminalText(value));
  const position = Math.max(0, Math.min(characters.length, cursor));
  const columns = Math.max(1, width);
  const cursorText = characters[position] ?? ' ';
  const cursorWidth = Math.max(1, Bun.stringWidth(cursorText));
  let before = '';
  let start = position;
  while (start > 0 && Bun.stringWidth(characters[start - 1]! + before) + cursorWidth <= columns) {
    before = characters[--start] + before;
  }
  let after = '';
  let end = position + 1;
  while (end < characters.length && Bun.stringWidth(before + cursorText + after + characters[end]) <= columns) {
    after += characters[end++];
  }
  return {before, cursor: cursorWidth <= columns ? cursorText : ' ', after};
}

export default function SearchInput({initialValue, width, onChange, onSubmit}: {
  initialValue: string;
  width: number;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const initial = terminalText(initialValue);
  const editor = useRef({value: initial, cursor: graphemes(initial).length});
  const [state, setState] = useState(editor.current);
  const view = searchViewport(state.value, state.cursor, width);

  useInput((input, key) => {
    if (isMouseInput(input) || key.escape || key.tab || key.upArrow || key.downArrow || key.pageUp || key.pageDown) return;
    if (key.return) { onSubmit(); return; }
    const previous = editor.current;
    const characters = graphemes(previous.value);
    let cursor = previous.cursor;
    if (key.leftArrow) cursor = Math.max(0, cursor - 1);
    else if (key.rightArrow) cursor = Math.min(characters.length, cursor + 1);
    else if (key.home || (key.ctrl && input === 'a')) cursor = 0;
    else if (key.end || (key.ctrl && input === 'e')) cursor = characters.length;
    else if (key.backspace) {
      if (cursor > 0) characters.splice(--cursor, 1);
    } else if (key.delete) characters.splice(cursor, 1);
    else if (key.ctrl && input === 'u') { characters.splice(0, cursor); cursor = 0; }
    else if (key.ctrl || key.meta || key.super || key.hyper) return;
    else {
      const inserted = graphemes(terminalText(input));
      characters.splice(cursor, 0, ...inserted);
      cursor += inserted.length;
    }
    const next = {value: characters.join(''), cursor};
    editor.current = next;
    setState(next);
    if (next.value !== previous.value) onChange(next.value);
  });

  return <Box height={1} width={Math.max(1, width)} flexShrink={0} overflow="hidden">
    <Text wrap="truncate-end">{view.before}<Text inverse>{view.cursor}</Text>{view.after}</Text>
  </Box>;
}
