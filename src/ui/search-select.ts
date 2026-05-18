import pc from "picocolors";
import { GoBackSignal } from "./go-back";

const K = {
  UP: "\x1b[A",
  DOWN: "\x1b[B",
  ENTER: "\r",
  ESC: "\x1b",
  BACKSPACE: "\x7f",
  CTRL_C: "\x03",
  SPACE: " ",
} as const;

const MAX_VISIBLE = 8;

type Opt<T> = { value: T; label: string; hints?: string[] };

function applyFilter<T>(options: Opt<T>[], query: string): Opt<T>[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) =>
    o.label.toLowerCase().includes(q) ||
    (o.hints?.some((h) => h.toLowerCase().includes(q)) ?? false)
  );
}

function highlightMatch(label: string, query: string, isCursor: boolean): string {
  if (!query) return isCursor ? pc.bold(pc.white(label)) : pc.dim(label);
  const lower = label.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return pc.dim(label);
  const pre = label.slice(0, idx);
  const match = label.slice(idx, idx + query.length);
  const post = label.slice(idx + query.length);
  return isCursor
    ? pc.dim(pre) + pc.bold(pc.white(match)) + pc.dim(post)
    : pc.dim(pre) + pc.white(match) + pc.dim(post);
}

function visibleWindow<T>(
  filtered: Opt<T>[],
  cursor: number
): { start: number; end: number } {
  const half = Math.floor(MAX_VISIBLE / 2);
  const start = Math.max(0, Math.min(cursor - half, filtered.length - MAX_VISIBLE));
  const end = Math.min(filtered.length, start + MAX_VISIBLE);
  return { start, end };
}

function buildSelectLines<T>(
  message: string,
  query: string,
  options: Opt<T>[],
  cursor: number,
  searchPool?: Opt<T>[]
): string[] {
  const pool = query.trim() && searchPool ? [...options, ...searchPool] : options;
  const f = applyFilter(pool, query);
  const clamped = Math.min(cursor, Math.max(0, f.length - 1));
  const { start, end } = visibleWindow(f, clamped);
  const lines: string[] = [];

  lines.push(`${pc.cyan("◆")}  ${pc.bold(message)}`);

  const searchBar = query
    ? `${pc.gray("/")} ${pc.white(query)}${pc.dim("_")}`
    : `${pc.gray("/")} ${pc.dim("type to filter...")}`;
  lines.push(`${pc.cyan("│")}  ${searchBar}`);
  lines.push(`${pc.cyan("│")}`);

  if (f.length === 0) {
    lines.push(`${pc.cyan("│")}  ${pc.dim("No matches")}`);
  } else {
    if (start > 0) lines.push(`${pc.cyan("│")}     ${pc.dim(`↑ ${start} more`)}`);

    for (let i = start; i < end; i++) {
      const isCursor = i === clamped;
      const text = highlightMatch(f[i].label, query, isCursor);
      lines.push(
        isCursor
          ? `${pc.cyan("│")}  ${pc.cyan("❯")} ${text}`
          : `${pc.cyan("│")}    ${text}`
      );
    }

    const below = f.length - end;
    if (below > 0) lines.push(`${pc.cyan("│")}     ${pc.dim(`↓ ${below} more`)}`);
  }

  lines.push(`${pc.cyan("│")}`);
  lines.push(`${pc.cyan("└")}  ${pc.dim("↑↓ navigate  ·  Enter select  ·  Esc cancel")}`);

  return lines;
}

function buildMultiSelectLines<T>(
  message: string,
  query: string,
  options: Opt<T>[],
  cursor: number,
  checked: Set<T>
): string[] {
  const f = applyFilter(options, query);
  const clamped = Math.min(cursor, Math.max(0, f.length - 1));
  const { start, end } = visibleWindow(f, clamped);
  const lines: string[] = [];

  const countHint = checked.size > 0 ? pc.green(`  ${checked.size} selected`) : "";
  lines.push(`${pc.cyan("◆")}  ${pc.bold(message)}${countHint}`);

  const searchBar = query
    ? `${pc.gray("/")} ${pc.white(query)}${pc.dim("_")}`
    : `${pc.gray("/")} ${pc.dim("type to filter...")}`;
  lines.push(`${pc.cyan("│")}  ${searchBar}`);
  lines.push(`${pc.cyan("│")}`);

  if (f.length === 0) {
    lines.push(`${pc.cyan("│")}  ${pc.dim("No matches")}`);
  } else {
    if (start > 0) lines.push(`${pc.cyan("│")}     ${pc.dim(`↑ ${start} more`)}`);

    for (let i = start; i < end; i++) {
      const opt = f[i];
      const isCursor = i === clamped;
      const isChecked = checked.has(opt.value);
      const checkbox = isChecked ? pc.green("◼") : pc.dim("◻");
      const text = highlightMatch(opt.label, query, isCursor);
      const prefix = isCursor ? pc.cyan("❯") : " ";
      lines.push(`${pc.cyan("│")}  ${prefix} ${checkbox} ${text}`);
    }

    const below = f.length - end;
    if (below > 0) lines.push(`${pc.cyan("│")}     ${pc.dim(`↓ ${below} more`)}`);
  }

  lines.push(`${pc.cyan("│")}`);
  lines.push(`${pc.cyan("└")}  ${pc.dim("Space toggle  ·  ↑↓ navigate  ·  Enter confirm  ·  Esc cancel")}`);

  return lines;
}

function redraw(lines: string[], lastCount: number): void {
  if (lastCount > 0) process.stdout.write(`\x1b[${lastCount}A\x1b[J`);
  process.stdout.write(lines.join("\n") + "\n");
}

function setupStdin(): void {
  process.stdout.write("\x1b[?25l");
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
  } catch {}
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
}

function teardownStdin(listener: (data: string) => void): void {
  process.stdin.removeListener("data", listener);
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {}
  process.stdin.pause();
  process.stdout.write("\x1b[?25h");
}

export async function searchSelect<T>(
  message: string,
  options: Opt<T>[],
  searchPool?: Opt<T>[]
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let query = "";
    let cursor = 0;
    let lastLineCount = 0;

    function draw(): void {
      const lines = buildSelectLines(message, query, options, cursor, searchPool);
      redraw(lines, lastLineCount);
      lastLineCount = lines.length;
    }

    function done(selected: Opt<T> | null): void {
      teardownStdin(onData);
      if (lastLineCount > 0) process.stdout.write(`\x1b[${lastLineCount}A\x1b[J`);
      if (selected) {
        process.stdout.write(`${pc.cyan("◇")}  ${pc.bold(message)}\n`);
        process.stdout.write(`${pc.cyan("│")}  ${pc.green(selected.label)}\n`);
        process.stdout.write(`${pc.cyan("│")}\n`);
        resolve(selected.value);
      } else {
        reject(new GoBackSignal());
      }
    }

    function onData(data: string): void {
      if (data === K.CTRL_C) {
        teardownStdin(onData);
        process.exit(0);
      }

      const pool = query.trim() && searchPool ? [...options, ...searchPool] : options;
      const f = applyFilter(pool, query);
      const maxCursor = Math.max(0, f.length - 1);

      if (data === K.UP) { if (cursor > 0) cursor--; draw(); return; }
      if (data === K.DOWN) { if (cursor < maxCursor) cursor++; draw(); return; }

      if (data === K.ENTER) {
        if (f.length > 0) done(f[Math.min(cursor, f.length - 1)]);
        return;
      }

      if (data === K.ESC) { done(null); return; }

      if (data === K.BACKSPACE) {
        if (query.length > 0) { query = query.slice(0, -1); cursor = 0; draw(); }
        return;
      }

      if (data.length === 1 && data >= " " && data.charCodeAt(0) < 127) {
        query += data;
        cursor = 0;
        draw();
      }
    }

    setupStdin();
    process.stdin.on("data", onData);
    draw();
  });
}

export async function searchMultiSelect<T>(
  message: string,
  options: Opt<T>[]
): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    let query = "";
    let cursor = 0;
    let lastLineCount = 0;
    const checked = new Set<T>();

    function draw(): void {
      const lines = buildMultiSelectLines(message, query, options, cursor, checked);
      redraw(lines, lastLineCount);
      lastLineCount = lines.length;
    }

    function done(confirmed: boolean): void {
      teardownStdin(onData);
      if (lastLineCount > 0) process.stdout.write(`\x1b[${lastLineCount}A\x1b[J`);
      if (confirmed) {
        const count = checked.size;
        process.stdout.write(`${pc.cyan("◇")}  ${pc.bold(message)}\n`);
        process.stdout.write(
          `${pc.cyan("│")}  ${count > 0 ? pc.green(`${count} item(s) selected`) : pc.dim("none selected")}\n`
        );
        process.stdout.write(`${pc.cyan("│")}\n`);
        resolve([...checked]);
      } else {
        reject(new GoBackSignal());
      }
    }

    function onData(data: string): void {
      if (data === K.CTRL_C) {
        teardownStdin(onData);
        process.exit(0);
      }

      const f = applyFilter(options, query);
      const maxCursor = Math.max(0, f.length - 1);
      const current = f[Math.min(cursor, f.length - 1)];

      if (data === K.UP) { if (cursor > 0) cursor--; draw(); return; }
      if (data === K.DOWN) { if (cursor < maxCursor) cursor++; draw(); return; }

      if (data === K.SPACE && current) {
        if (checked.has(current.value)) checked.delete(current.value);
        else checked.add(current.value);
        draw();
        return;
      }

      if (data === K.ENTER) { done(true); return; }
      if (data === K.ESC) { done(false); return; }

      if (data === K.BACKSPACE) {
        if (query.length > 0) { query = query.slice(0, -1); cursor = 0; draw(); }
        return;
      }

      if (data.length === 1 && data >= " " && data.charCodeAt(0) < 127) {
        query += data;
        cursor = 0;
        draw();
      }
    }

    setupStdin();
    process.stdin.on("data", onData);
    draw();
  });
}
