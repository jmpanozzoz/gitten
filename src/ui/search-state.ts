import type { Key } from "node:readline";
import { terminalText } from "./terminal-text";

export interface SearchOption<T> {
  value: T;
  label: string;
  hints?: string[];
}

export interface SearchOptions<T> {
  message: string;
  options: SearchOption<T>[];
  pool?: SearchOption<T>[];
  multiple: boolean;
}

export interface SearchState<T> extends SearchOptions<T> {
  cursor: number;
  query: string;
  checked: Set<T>;
}

export function searchState<T>(options: SearchOptions<T>): SearchState<T> {
  return { ...options, cursor: 0, query: "", checked: new Set() };
}

export function matchingOptions<T>(state: SearchState<T>): SearchOption<T>[] {
  const query = searchText(terminalText(state.query, true).trim());
  if (!query) return state.options;
  return [...state.options, ...(state.pool ?? [])].filter(({ label, hints }) =>
    [label, ...(hints ?? [])].some((candidate) => searchText(candidate).includes(query)),
  );
}

function searchText(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

type Decision<T> = { kind: "cancel" } | { kind: "select"; options: SearchOption<T>[] };

export function searchKey<T>(
  state: SearchState<T>,
  character: string,
  key: Key,
): Decision<T> | undefined {
  if (key.name === "escape" || (key.ctrl && (key.name === "c" || key.name === "d")))
    return { kind: "cancel" };
  const matching = matchingOptions(state);
  if (key.name === "return" || key.name === "enter") return selected(state, matching);
  if (moveCursor(state, matching.length, key.name)) return;
  if (state.multiple && key.name === "tab") {
    toggleCurrent(state, matching[state.cursor]);
    return;
  }
  editQuery(state, character, key);
}

function selected<T>(state: SearchState<T>, matching: SearchOption<T>[]): Decision<T> | undefined {
  if (state.multiple) {
    return {
      kind: "select",
      options: state.options.filter(({ value }) => state.checked.has(value)),
    };
  }
  const option = matching[state.cursor];
  if (option) return { kind: "select", options: [option] };
}

function moveCursor<T>(state: SearchState<T>, count: number, name?: string): boolean {
  if (name === "up") state.cursor = Math.max(0, state.cursor - 1);
  else if (name === "down") state.cursor = Math.min(Math.max(0, count - 1), state.cursor + 1);
  else return false;
  return true;
}

function toggleCurrent<T>(state: SearchState<T>, option?: SearchOption<T>): void {
  if (!option) return;
  if (state.checked.has(option.value)) state.checked.delete(option.value);
  else state.checked.add(option.value);
}

const graphemes = new Intl.Segmenter();

function editQuery<T>(state: SearchState<T>, character: string, key: Key): void {
  if (key.name === "backspace") {
    const parts = Array.from(graphemes.segment(state.query));
    state.query = state.query.slice(0, parts.at(-1)?.index ?? 0);
  } else if (character && !key.ctrl && !key.meta && !/\p{Cc}/u.test(character)) {
    state.query += character;
  } else return;
  state.cursor = 0;
}
