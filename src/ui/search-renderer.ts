import { matchingOptions, type SearchOption, type SearchState } from "./search-state";
import { terminalText } from "./terminal-text";
import { theme } from "./theme";

const graphemes = new Intl.Segmenter();

export function searchLines<T>(state: SearchState<T>, width: number, height: number): string[] {
  const options = matchingOptions(state);
  const pageSize = Math.min(8, Math.max(1, height - 7));
  const start = Math.max(
    0,
    Math.min(state.cursor - Math.floor(pageSize / 2), options.length - pageSize),
  );
  const end = Math.min(start + pageSize, options.length);
  const count = state.multiple ? ` · ${state.checked.size} selected` : "";
  const hint = state.multiple
    ? "Tab toggle · ↑↓ navigate · Enter confirm · Esc cancel"
    : "↑↓ navigate · Enter select · Esc cancel";
  const lines = [
    theme.bold(fit(`◆  ${state.message}${count}`, width)),
    theme.muted(fit(`│  / ${terminalText(state.query, true) || "type to filter..."}`, width)),
  ];
  if (start > 0) lines.push(theme.dim(fit(`│     ↑ ${start} more`, width)));
  if (options.length === 0) lines.push(theme.dim(fit("│  No matches", width)));
  for (const [offset, option] of options.slice(start, end).entries()) {
    lines.push(renderOption(state, option, start + offset === state.cursor, width));
  }
  if (end < options.length)
    lines.push(theme.dim(fit(`│     ↓ ${options.length - end} more`, width)));
  lines.push(theme.muted(fit(`└  ${hint}`, width)));
  return lines;
}

function renderOption<T>(
  state: SearchState<T>,
  option: SearchOption<T>,
  active: boolean,
  width: number,
): string {
  const position = active ? "❯ " : "  ";
  const check = state.multiple ? (state.checked.has(option.value) ? "◼ " : "◻ ") : "";
  const text = fit(`│  ${position}${check}${option.label}`, width);
  return active ? theme.bold(theme.bright(text)) : theme.dim(text);
}

export function fit(text: string, width: number): string {
  if (Bun.stringWidth(text) <= width) return text;
  if (width <= 0) return "";
  let result = "";
  let used = 1;
  for (const { segment } of graphemes.segment(text)) {
    used += Bun.stringWidth(segment);
    if (used > width) break;
    result += segment;
  }
  return `${result}…`;
}
