import { theme } from "./theme";

const DEFAULT_MAX_LINES = 40;

export function renderDiff(diff: string, maxLines = DEFAULT_MAX_LINES): string {
  const lines = diff.split("\n");
  const visible = lines.slice(0, maxLines);
  const remaining = lines.length - maxLines;

  const colored = visible
    .map((line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) return theme.diffAdd(line);
      if (line.startsWith("-") && !line.startsWith("---")) return theme.diffRemove(line);
      return theme.muted(line);
    })
    .join("\n");

  return remaining > 0
    ? `${colored}\n${theme.muted(`...and ${remaining} more lines`)}`
    : colored;
}
